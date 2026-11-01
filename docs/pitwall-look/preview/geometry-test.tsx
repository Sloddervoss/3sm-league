import { loadTrackProjection } from '../../../src/lib/pitwallTrackGeometry';

const uit = document.getElementById('uit')!;
const controller = new AbortController();

async function run() {
  const regels: string[] = [];
  for (const [naam, config, id] of [
    ['suzuka grandprix', 'Grand Prix', 168],
    ['circuit de spa-francorchamps', 'Grand Prix Pits - 2010', 5],
    ['virginia 2022 full', 'Full Course', 465],
  ] as Array<[string, string, number]>) {
    try {
      const geo = await loadTrackProjection(naam, config, controller.signal, id);
      if (!geo) {
        regels.push(`${naam} (${id}): GEEN geometrie`);
        continue;
      }
      const xs = geo.points.map((p) => p.x);
      const ys = geo.points.map((p) => p.y);
      regels.push(
        `${naam} (${id}): ${geo.points.length} punten, map=${geo.mapPath}, x ${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)}, y ${Math.min(...ys).toFixed(0)}–${Math.max(...ys).toFixed(0)}, reden=${geo.unavailableReason ?? '-'}`,
      );
    } catch (fout) {
      regels.push(`${naam} (${id}): FOUT ${String(fout)}`);
    }
  }
  uit.textContent = regels.join(' | ');
}

void run();
