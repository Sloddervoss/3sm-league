import {
  loadLayeredTrackRuntime,
  normalizeTrackName,
  resolveLayeredTrackMap,
  type LayeredTrackManifest,
} from '@/lib/layeredTrackMaps';
import { loadRoadProjection, ROAD_PROJECTION_IDS } from './pitwallRoadProjection';

export type TrackProjectionPoint = { x: number; y: number };

export interface TrackProjectionGeometry {
  mapPath: string;
  points: TrackProjectionPoint[];
  hasOfficialDirection: boolean;
  unavailableReason: string | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SAMPLE_COUNT = 1024;

export function resolvePitwallTrackPath(trackName: string, trackConfig: string, manifest: LayeredTrackManifest): string | null {
  const name = trackName.trim();
  const config = trackConfig.trim();
  // SimHub may send the SDK directory instead of the localized display name.
  // Compare complete identities only; never guess a layout from a circuit prefix.
  const sdkKey = (value: string) => normalizeTrackName(value).replace(/[\\/\s_-]+/g, ' ');
  const sdkMatches = manifest.tracks.filter(entry => {
    const directory = entry.trackDirpath ?? '';
    if (!directory) return false;
    const parts = directory.split(/[\\/]/);
    const layout = parts.length > 1 ? parts[parts.length - 1] : '';
    const identities = [directory, entry.configNameShort ?? ''].filter(Boolean).map(sdkKey);
    const complete = identities.includes(sdkKey(name));
    const combined = config && identities.includes(sdkKey(`${name} ${config}`));
    return (complete && (!config || sdkKey(config) === sdkKey(layout) || sdkKey(config) === sdkKey(entry.configName))) || combined;
  });
  if (sdkMatches.length === 1) return sdkMatches[0].path;
  const candidates = [
    config && !normalizeTrackName(name).endsWith(normalizeTrackName(config)) ? `${name} - ${config}` : '',
    name,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = resolveLayeredTrackMap(candidate, manifest);
    const entry = manifest.tracks.find(track => track.path === resolved);
    if (entry && (!config || normalizeTrackName(entry.configName) === normalizeTrackName(config))) return resolved;
  }
  if (!config) return null;
  const normalizedName = normalizeTrackName(name);
  const normalizedConfig = normalizeTrackName(config);
  const matches = manifest.tracks.filter(entry =>
    normalizeTrackName(entry.configName) === normalizedConfig &&
    normalizeTrackName(entry.name).startsWith(`${normalizedName} - `),
  );
  return matches.length === 1 ? matches[0].path : null;
}

export function orientProjectionPoints(
  points: TrackProjectionPoint[],
  start: TrackProjectionPoint | null,
  direction: TrackProjectionPoint | null,
  directionLocation: TrackProjectionPoint | null = start,
): TrackProjectionPoint[] {
  if (points.length === 0) return [];
  let startIndex = 0;
  if (start) {
    points.forEach((point, index) => {
      if (distanceSquared(point, start) < distanceSquared(points[startIndex], start)) startIndex = index;
    });
  }
  const rotated = Array.from({ length: points.length }, (_, index) => points[(startIndex + index) % points.length]);
  if (!direction || points.length < 5) return rotated;
  let directionIndex = 0;
  if (directionLocation) rotated.forEach((point, index) => {
    if (distanceSquared(point, directionLocation) < distanceSquared(rotated[directionIndex], directionLocation)) directionIndex = index;
  });
  const lookAhead = Math.max(2, Math.floor(points.length / 128));
  const forward = rotated[(directionIndex + lookAhead) % rotated.length];
  const backward = rotated[(directionIndex + rotated.length - lookAhead) % rotated.length];
  const forwardScore = (forward.x - rotated[directionIndex].x) * direction.x + (forward.y - rotated[directionIndex].y) * direction.y;
  const backwardScore = (backward.x - rotated[directionIndex].x) * direction.x + (backward.y - rotated[directionIndex].y) * direction.y;
  if (forwardScore >= backwardScore) return rotated;
  return [rotated[0], ...rotated.slice(1).reverse()];
}

/** Reads only the shipped official layered SVG selected by the authoritative manifest. */
export async function loadTrackProjection(trackName: string, trackConfig: string, signal: AbortSignal): Promise<TrackProjectionGeometry | null> {
  const manifest = await loadLayeredTrackRuntime();
  if (!manifest || signal.aborted) return null;
  const mapPath = resolvePitwallTrackPath(trackName, trackConfig, manifest);
  if (!mapPath) return null;
  const response = await fetch(mapPath, { signal });
  if (!response.ok) throw new Error('track unavailable');
  const mapSource = await response.text();
  const trackId = manifest.tracks.find(entry => entry.path === mapPath)?.trackId;
  if (trackId != null && ROAD_PROJECTION_IDS.some(id => id === trackId)) {
    try {
      const points = await loadRoadProjection(trackId, mapSource, signal);
      return { mapPath, points, hasOfficialDirection: true, unavailableReason: null };
    } catch {
      return { mapPath, points: [], hasOfficialDirection: false, unavailableReason: 'De gecontroleerde road-baanlijn is niet beschikbaar of past niet bij deze kaart.' };
    }
  }
  const outer = parseSvg(mapSource);
  const active = decodeLayer(outer, 'activeColor');
  if (!active) return null;
  const { start, direction, directionLocation } = readOfficialTrackReference(outer);
  const contours = Array.from(active.querySelectorAll('path')).filter(element => !element.closest('defs, clipPath, mask')).flatMap(element =>
    splitClosedSubpaths(element.getAttribute('d') ?? '').map(pathData => transformElementPoints(element, samplePath(pathData, SAMPLE_COUNT))),
  ).filter(points => points.length > 8 && contourLength(points) > 100);
  if (contours.length === 0) return { mapPath, points: [], hasOfficialDirection: false, unavailableReason: 'De bron bevat geen bruikbare gesloten baanlijn.' };
  const contour = chooseCourseContour(contours, start);
  const valid = contour.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1920 && point.y >= 0 && point.y <= 1080);
  const unavailableReason = !valid ? 'De brongeometrie kon niet veilig worden geprojecteerd.'
    : !start ? 'Start/finish is niet eenduidig beschikbaar.'
    : !direction ? 'De officiële bron bevat geen bruikbare rijrichtingspijl.'
    : contours.length === 1 || contours.length > 4 || active.querySelector('clipPath, mask') ? 'Deze bijzondere layout heeft aanvullende baankalibratie nodig.'
    : null;
  return { mapPath, points: unavailableReason ? [] : orientProjectionPoints(contour, start, direction, directionLocation), hasOfficialDirection: direction !== null, unavailableReason };
}

/** Also used by the offline road-centerline generator, keeping one reference parser. */
export function readOfficialTrackReference(source: string | Document) {
  const outer = typeof source === 'string' ? parseSvg(source) : source;
  const finish = decodeLayer(outer, 'finishColor');
  const finishShapes = finish ? extractShapePoints(finish) : [];
  const finishLine = chooseFinishLine(finishShapes);
  const arrow = chooseDirectionArrow(finishShapes, finishLine);
  const start = finishLine ? boundsCenter(finishLine.points) : null;
  const direction = arrow ? inferArrowDirection(arrow.points) : null;
  return { start, direction, directionLocation: arrow ? boundsCenter(arrow.points) : start };
}

function parseSvg(source: string): Document {
  return new DOMParser().parseFromString(source, 'image/svg+xml');
}

function decodeLayer(outer: Document, filterId: string): Document | null {
  const layer = Array.from(outer.querySelectorAll('image')).find(node => node.getAttribute('filter') === `url(#${filterId})`);
  const uri = layer?.getAttribute('href');
  if (!uri?.startsWith('data:image/svg+xml;base64,')) return null;
  try {
    const svg = parseSvg(atob(uri.slice(uri.indexOf(',') + 1)));
    expandSvgUses(svg);
    return svg;
  } catch { return null; }
}

function expandSvgUses(svg: Document): void {
  for (const use of Array.from(svg.querySelectorAll('use'))) {
    const href = use.getAttribute('href') ?? use.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href?.startsWith('#')) continue;
    const source = Array.from(svg.querySelectorAll('[id]')).find(node => node.id === href.slice(1));
    if (!source) continue;
    const group = svg.createElementNS(SVG_NS, 'g');
    let transform = `${use.getAttribute('transform') ?? ''} translate(${Number(use.getAttribute('x'))} ${Number(use.getAttribute('y'))})`;
    if (source.tagName.toLowerCase() === 'symbol') {
      const box = (source.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
      if (box.length === 4 && box[2] > 0 && box[3] > 0) {
        const width = Number(use.getAttribute('width')) || box[2];
        const height = Number(use.getAttribute('height')) || box[3];
        const scale = Math.min(width / box[2], height / box[3]);
        transform += ` translate(${(width - box[2] * scale) / 2} ${(height - box[3] * scale) / 2}) scale(${scale}) translate(${-box[0]} ${-box[1]})`;
      }
      for (const child of Array.from(source.children)) group.append(child.cloneNode(true));
    } else group.append(source.cloneNode(true));
    group.setAttribute('transform', transform);
    use.replaceWith(group);
  }
}

function splitClosedSubpaths(pathData: string): string[] {
  const starts = [...pathData.matchAll(/[Mm](?=\s*[-+.\d])/g)].map(match => match.index ?? 0);
  return starts.map((start, index) => {
    let part = pathData.slice(start, starts[index + 1] ?? pathData.length).trim();
    if (start > 0 && part.startsWith('m')) {
      // A relative moveto after closepath is relative to the PREVIOUS subpath's
      // start, not the document origin. Preserve that state when splitting rings.
      const prefix = document.createElementNS(SVG_NS, 'path');
      prefix.setAttribute('d', pathData.slice(0, start));
      const origin = prefix.getPointAtLength(prefix.getTotalLength());
      const first = /^m\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)[\s,]*([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)/i.exec(part);
      if (first) {
        const rest = part.slice(first[0].length);
        // Subsequent coordinate pairs after a relative moveto are relative
        // lineto commands, even after replacing its first pair with absolute M.
        const continuation = /^[\s,]*[-+.\d]/.test(rest) ? `l${rest.replace(/^[\s,]+/, '')}` : rest;
        part = `M${origin.x + Number(first[1])},${origin.y + Number(first[2])}${continuation}`;
      }
    }
    // Filled SVG subpaths are implicitly closed, including several official
    // oval inner boundaries which do not have a literal Z command.
    return /[zZ]\s*$/.test(part) ? part : `${part}Z`;
  });
}

function samplePath(pathData: string, count: number): TrackProjectionPoint[] {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathData);
  try {
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) return [];
    return Array.from({ length: count }, (_, index) => {
      const point = path.getPointAtLength((index / count) * length);
      return { x: point.x, y: point.y };
    });
  } catch { return []; }
}

interface ShapePoints { element: Element; points: TrackProjectionPoint[] }

function extractShapePoints(svg: Document): ShapePoints[] {
  return Array.from(svg.querySelectorAll('path, line, rect, polygon, polyline')).filter(element => !element.closest('defs, symbol, clipPath, mask')).flatMap(element => {
    if (element.tagName.toLowerCase() === 'path') {
      return splitClosedSubpaths(element.getAttribute('d') ?? '').map(pathData => ({ element, points: transformElementPoints(element, samplePath(pathData, 256)) }));
    }
    return [{ element, points: pointsForBasicShape(element) }];
  }).filter(shape => shape.points.length > 1);
}

function pointsForBasicShape(element: Element): TrackProjectionPoint[] {
  const number = (name: string) => Number(element.getAttribute(name));
  let points: TrackProjectionPoint[];
  switch (element.tagName.toLowerCase()) {
    case 'line': points = [{ x: number('x1'), y: number('y1') }, { x: number('x2'), y: number('y2') }]; break;
    case 'rect': {
      const x = number('x'); const y = number('y'); const width = number('width'); const height = number('height');
      points = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]; break;
    }
    case 'polygon':
    case 'polyline': points = parseSvgPointList(element.getAttribute('points') ?? ''); break;
    default: points = [];
  }
  return transformElementPoints(element, points);
}

function transformElementPoints(element: Element, points: TrackProjectionPoint[]): TrackProjectionPoint[] {
  for (let node: Element | null = element; node; node = node.parentElement) {
    points = applySvgTransform(points, node.getAttribute('transform') ?? '');
  }
  return points;
}

export function parseSvgPointList(value: string): TrackProjectionPoint[] {
  const numbers = (value.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  const points: TrackProjectionPoint[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index], y: numbers[index + 1] });
  return points;
}

type SvgMatrix = [number, number, number, number, number, number];

export function applySvgTransform(points: TrackProjectionPoint[], value: string): TrackProjectionPoint[] {
  let matrix: SvgMatrix = [1, 0, 0, 1, 0, 0];
  for (const match of value.matchAll(/(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi)) {
    const values = (match[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    let next: SvgMatrix | null = null;
    switch (match[1].toLowerCase()) {
      case 'matrix': if (values.length >= 6) next = values.slice(0, 6) as SvgMatrix; break;
      case 'translate': next = [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0]; break;
      case 'scale': next = [values[0] ?? 1, 0, 0, values[1] ?? values[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const radians = ((values[0] ?? 0) * Math.PI) / 180;
        const rotation: SvgMatrix = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
        if (values.length >= 3) {
          const [cx, cy] = values.slice(1);
          next = multiplyMatrix(multiplyMatrix([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy]);
        } else next = rotation;
        break;
      }
    }
    if (next) matrix = multiplyMatrix(matrix, next);
  }
  return points.map(point => ({ x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] }));
}

function multiplyMatrix(left: SvgMatrix, right: SvgMatrix): SvgMatrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function chooseFinishLine(shapes: ShapePoints[]): ShapePoints | null {
  return shapes.reduce<ShapePoints | null>((best, shape) => {
    const bounds = orientedBounds(shape.points);
    const long = Math.max(bounds.width, bounds.height);
    const score = long / Math.max(1, Math.min(bounds.width, bounds.height));
    if (long < 20 || score < 2.5) return best;
    if (!best) return shape;
    const bestBounds = orientedBounds(best.points);
    const bestScore = Math.max(bestBounds.width, bestBounds.height) / Math.max(1, Math.min(bestBounds.width, bestBounds.height));
    return score > bestScore ? shape : best;
  }, null);
}

function principalAxis(points: TrackProjectionPoint[]): TrackProjectionPoint {
  const center = averagePoint(points);
  let xx = 0; let yy = 0; let xy = 0;
  for (const point of points) {
    const x = point.x - center.x; const y = point.y - center.y;
    xx += x * x; yy += y * y; xy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function orientedBounds(points: TrackProjectionPoint[]) {
  const axis = principalAxis(points);
  return pointBounds(points.map(p => ({ x: p.x * axis.x + p.y * axis.y, y: -p.x * axis.y + p.y * axis.x })));
}

function chooseDirectionArrow(shapes: ShapePoints[], line: ShapePoints | null): ShapePoints | null {
  return shapes.filter(shape => shape !== line && shape.points.length >= 4).reduce<ShapePoints | null>((best, shape) => {
    const bounds = pointBounds(shape.points); const area = bounds.width * bounds.height;
    if (area < 100) return best;
    if (!best) return shape;
    const bestBounds = pointBounds(best.points);
    return area > bestBounds.width * bestBounds.height ? shape : best;
  }, null);
}

export function inferArrowDirection(points: TrackProjectionPoint[]): TrackProjectionPoint | null {
  if (points.length < 4) return null;
  // Both seven-corner arrows and modern concave chevrons occur in iRacing's
  // assets. The wider half is NOT necessarily the head. Locate the convex tip
  // on the symmetry axis instead; ignore the concave notch and straight edges.
  const vertices = convexHull(points);
  points = samplePolygon(points, 256);
  const center = averagePoint(points);
  const axis = principalAxis(points);
  const perpendicular = { x: -axis.y, y: axis.x };
  const projected = points.map(point => ({
    along: (point.x - center.x) * axis.x + (point.y - center.y) * axis.y,
    across: (point.x - center.x) * perpendicular.x + (point.y - center.y) * perpendicular.y,
  }));
  const min = Math.min(...projected.map(point => point.along)); const max = Math.max(...projected.map(point => point.along));
  if (!Number.isFinite(min) || max - min < 10) return null;
  const acrossWidth = Math.max(...projected.map(p => p.across)) - Math.min(...projected.map(p => p.across));
  const candidates = vertices.map(point => ({
    along: (point.x - center.x) * axis.x + (point.y - center.y) * axis.y,
    across: (point.x - center.x) * perpendicular.x + (point.y - center.y) * perpendicular.y,
  })).filter(p => Math.abs(p.across) < acrossWidth * 0.2 && Math.abs(p.along) > (max - min) * 0.2)
    .sort((a, b) => Math.abs(a.across / a.along) - Math.abs(b.across / b.along));
  if (!candidates.length) return null;
  const sign = Math.sign(candidates[0].along);
  return { x: axis.x * sign, y: axis.y * sign };
}

function convexHull(points: TrackProjectionPoint[]): TrackProjectionPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: TrackProjectionPoint, b: TrackProjectionPoint, c: TrackProjectionPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: TrackProjectionPoint[]) => {
    const result: TrackProjectionPoint[] = [];
    for (const point of list) {
      while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 0.1) result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function samplePolygon(points: TrackProjectionPoint[], count: number): TrackProjectionPoint[] {
  const lengths = points.map((point, i) => Math.sqrt(distanceSquared(point, points[(i + 1) % points.length])));
  const total = lengths.reduce((a, b) => a + b, 0);
  return Array.from({ length: count }, (_, i) => {
    let distance = total * i / count; let segment = 0;
    while (segment < lengths.length - 1 && distance > lengths[segment]) distance -= lengths[segment++];
    const ratio = lengths[segment] > 0 ? distance / lengths[segment] : 0;
    const a = points[segment]; const b = points[(segment + 1) % points.length];
    return { x: a.x + ratio * (b.x - a.x), y: a.y + ratio * (b.y - a.y) };
  });
}

function chooseCourseContour(contours: TrackProjectionPoint[][], start: TrackProjectionPoint | null): TrackProjectionPoint[] {
  if (!start) return contours.reduce((best, contour) => contourLength(contour) > contourLength(best) ? contour : best);
  const nearest = contours.map(contour => ({ contour, distance: Math.min(...contour.map(point => distanceSquared(point, start))), length: contourLength(contour) })).sort((a, b) => a.distance - b.distance);
  return nearest.filter(candidate => candidate.distance <= nearest[0].distance + 900).sort((a, b) => b.length - a.length)[0].contour;
}

function contourLength(points: TrackProjectionPoint[]): number {
  return points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + Math.hypot(next.x - point.x, next.y - point.y); }, 0);
}

function distanceSquared(a: TrackProjectionPoint, b: TrackProjectionPoint): number { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
function averagePoint(points: TrackProjectionPoint[]): TrackProjectionPoint { return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 }); }
function pointBounds(points: TrackProjectionPoint[]) {
  const xs = points.map(point => point.x); const ys = points.map(point => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}
function boundsCenter(points: TrackProjectionPoint[]): TrackProjectionPoint { const bounds = pointBounds(points); return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }; }
