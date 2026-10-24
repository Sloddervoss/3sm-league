/**
 * Delta-protocol (v4).
 *
 * Het probleem: een volledig telemetriepakket is ongeveer 2,3 kB en gaat tien
 * keer per seconde de deur uit, ook als er niets veranderd is. Bij veertig
 * tegenstanders groeit dat voorbij de limiet van de relay (24.576 byte), dus
 * dan komen er 413's binnen.
 *
 * De oplossing is niet comprimeren maar zwijgen: één volledig pakket (keyframe)
 * en daarna alleen de velden die echt veranderd zijn. Deze module doet beide
 * kanten — de plugin maakt de delta's, de server zet ze terug.
 *
 * Twee regels die het protocol dragen:
 *
 * 1. **Een keyframe is heilig.** Elk pakket dat geen keyframe volgt op een
 *    eerder keyframe van dezelfde sessie is onbruikbaar; dan is er geen basis om
 *    bij op te tellen en moet de plugin er een sturen.
 * 2. **Paden zijn dom.** `timing.completedLaps`, `opponents.12.gapSeconds`.
 *    Geen schema, geen versienummer per veld: een onbekend pad is een fout in de
 *    zender, geen reden om te gokken.
 */

export type JsonValue = unknown;

/** Eén wijziging: pad in puntnotatie en de nieuwe waarde. */
export type DeltaOp = [path: string, value: JsonValue];

export interface KeyframeFrame {
  kind: "keyframe";
  /** Volgnummer binnen de sessie; de server weigert alles wat terugspringt. */
  seq: number;
  data: Record<string, JsonValue>;
}

export interface DeltaFrame {
  kind: "delta";
  seq: number;
  /** Alleen de gewijzigde paden. Een leeg array betekent: niets veranderd. */
  ops: DeltaOp[];
}

export type TelemetryFrame = KeyframeFrame | DeltaFrame;

const MAX_DEPTH = 6;

/**
 * Vergelijkt twee momentopnames en levert de paden op die verschillen.
 * Arrays worden per index vergeleken; een kortere array levert geen `delete`,
 * want de server vervangt het veld dan in zijn geheel via `set`.
 */
export function diffFrames(
  before: Record<string, JsonValue>,
  after: Record<string, JsonValue>,
): DeltaOp[] {
  const ops: DeltaOp[] = [];
  walk(before, after, "", ops, 0);
  return ops;
}

function walk(
  before: JsonValue,
  after: JsonValue,
  prefix: string,
  ops: DeltaOp[],
  depth: number,
): void {
  if (Object.is(before, after)) return;

  const beidenArray = Array.isArray(before) && Array.isArray(after) && depth < MAX_DEPTH;
  if (beidenArray) {
    const a = before as JsonValue[];
    const b = after as JsonValue[];
    // Lengteverschil: het veld in zijn geheel, anders klopt de index niet meer.
    if (a.length !== b.length) {
      ops.push([prefix, after]);
      return;
    }
    for (let i = 0; i < b.length; i += 1) {
      walk(a[i], b[i], `${prefix}.${i}`, ops, depth + 1);
    }
    return;
  }

  const beidenObject =
    isPlainObject(before) && isPlainObject(after) && depth < MAX_DEPTH;

  if (!beidenObject) {
    if (!deepEqual(before, after)) ops.push([prefix, after]);
    return;
  }

  const a = before as Record<string, JsonValue>;
  const b = after as Record<string, JsonValue>;

  for (const key of Object.keys(b)) {
    const pad = prefix ? `${prefix}.${key}` : key;
    if (!(key in a)) {
      // Nieuw veld: in één keer, anders wordt het een rij losse bladeren.
      ops.push([pad, b[key]]);
      continue;
    }
    walk(a[key], b[key], pad, ops, depth + 1);
  }

  for (const key of Object.keys(a)) {
    if (!(key in b)) {
      const pad = prefix ? `${prefix}.${key}` : key;
      // Verwijderen is zeldzaam; één op voor het hele veld.
      ops.push([pad, null]);
    }
  }
}

/**
 * Past een delta toe op een momentopname en levert een nieuwe op.
 * De invoer wordt niet gemuteerd: de server bewaart hem per sessie en een
 * halve toepassing mag die nooit beschadigen.
 */
export function applyDeltaFrame(
  base: Record<string, JsonValue>,
  ops: DeltaOp[],
): Record<string, JsonValue> {
  const kopie = structuredClone(base) as Record<string, JsonValue>;

  for (const [path, value] of ops) {
    if (!path) throw new Error("delta: leeg pad");
    const delen = path.split(".");
    let doel: Record<string, JsonValue> = kopie;

    for (let i = 0; i < delen.length - 1; i += 1) {
      const sleutel = delen[i];
      const volgende = doel[sleutel];
      if (!isPlainObject(volgende) && !Array.isArray(volgende)) {
        // Het pad bestaat niet (meer). Stil doorgaan zou de delta op de
        // verkeerde plek toepassen; dat is erger dan weigeren.
        throw new Error(`delta: pad ${path} bestaat niet`);
      }
      doel = volgende as Record<string, JsonValue>;
    }

    doel[delen[delen.length - 1]] = value;
  }

  return kopie;
}

/**
 * Bouwt het volgende frame: een keyframe als er nog geen basis is, anders een
 * delta. `forceKeyframe` is er voor de zender: na een herverbinding of een
 * nieuwe sessie is de basis aan de serverkant weg.
 */
export function nextFrame(
  previous: Record<string, JsonValue> | null,
  current: Record<string, JsonValue>,
  seq: number,
  forceKeyframe = false,
): TelemetryFrame {
  if (forceKeyframe || previous === null) {
    return { kind: "keyframe", seq, data: current };
  }
  return { kind: "delta", seq, ops: diffFrames(previous, current) };
}

function isPlainObject(value: JsonValue): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const x = a as JsonValue[];
    const y = b as JsonValue[];
    if (x.length !== y.length) return false;
    return x.every((v, i) => deepEqual(v, y[i]));
  }
  const x = a as Record<string, JsonValue>;
  const y = b as Record<string, JsonValue>;
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  if (kx.length !== ky.length) return false;
  return kx.every((k) => k in y && deepEqual(x[k], y[k]));
}

/** Grootte van een frame zoals hij over de lijn gaat. */
export function frameSize(frame: TelemetryFrame): number {
  return new TextEncoder().encode(JSON.stringify(frame)).length;
}
