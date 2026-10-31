// Deno-tests voor het signed-gatcontract van de tegenstanderlijst.
//
// Aanleiding: gapToPlayerSeconds liep door `num()` met min: 0 en sentinel -1.
// Een auto die vóór de speler zit heeft een negatief gat, dus dat veld werd
// leeg — de helft van het veld verdween — en een echt gat van -1 seconde werd
// als "onbekend" gelezen. Sinds 2026-10-31 is een gat signed: -86400..86400,
// geen sentinel, en alleen ontbreken of een niet-numerieke waarde wordt null.
import { parseOpponents } from "./opponents.ts";

declare const Deno: {
  test(name: string, test: () => void | Promise<void>): void;
};

const tegenstander = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "9001",
  carNumber: "77",
  driverName: "R. Godefrooij",
  teamName: "Naober Racing",
  carClass: "GT3",
  carClassId: "17",
  position: 2,
  classPosition: 1,
  lap: 42,
  lapDistancePct: 0.31,
  gapToPlayerSeconds: 12.3,
  gapToLeaderSeconds: 1.8,
  lastLapSeconds: 121.8,
  bestLapSeconds: 120.4,
  inPit: false,
  speedKph: 212.4,
  connected: true,
  isPlayer: false,
  ...overrides,
});

const eerste = (overrides: Record<string, unknown> = {}) => {
  const parsed = parseOpponents([tegenstander(overrides)]);
  if (!parsed || parsed.length !== 1) throw new Error("tegenstander is niet geparsed");
  return parsed[0];
};

Deno.test("een negatief gat naar de speler blijft negatief", () => {
  // -2 is een auto die twee seconden vóór ons zit, geen fout.
  if (eerste({ gapToPlayerSeconds: -2 }).gapToPlayerSeconds !== -2) throw new Error("-2 werd niet bewaard");
  if (eerste({ gapToPlayerSeconds: -42.8 }).gapToPlayerSeconds !== -42.8) throw new Error("-42.8 werd niet bewaard");
  if (eerste({ gapToPlayerSeconds: -86400 }).gapToPlayerSeconds !== -86400) throw new Error("ondergrens werd niet bewaard");
});

Deno.test("nul blijft nul en min één blijft min één", () => {
  const nul = eerste({ gapToPlayerSeconds: 0, gapToLeaderSeconds: 0 });
  if (nul.gapToPlayerSeconds !== 0 || nul.gapToLeaderSeconds !== 0) throw new Error("0 werd niet als meting bewaard");
  // -1 was een sentinel; het is een echt gat van één seconde.
  const minEen = eerste({ gapToPlayerSeconds: -1, gapToLeaderSeconds: -1 });
  if (minEen.gapToPlayerSeconds !== -1) throw new Error("-1 werd als onbekend gelezen");
  if (minEen.gapToLeaderSeconds !== -1) throw new Error("-1 werd als onbekend gelezen (leider)");
});

Deno.test("een ontbrekend gat wordt null en kost de rij niet", () => {
  const zonderSpeler = eerste({ gapToPlayerSeconds: undefined });
  if (zonderSpeler.gapToPlayerSeconds !== null) throw new Error("ontbrekend gat is niet null");
  if (zonderSpeler.id !== "9001") throw new Error("rij is niet blijven staan");
  const explicietNull = eerste({ gapToLeaderSeconds: null });
  if (explicietNull.gapToLeaderSeconds !== null) throw new Error("null werd geen null");
});

Deno.test("een niet-numeriek gat wordt null, de rest blijft", () => {
  const parsed = eerste({ gapToPlayerSeconds: "3.2", gapToLeaderSeconds: true });
  if (parsed.gapToPlayerSeconds !== null) throw new Error("string werd geaccepteerd");
  if (parsed.gapToLeaderSeconds !== null) throw new Error("boolean werd geaccepteerd");
  if (parsed.position !== 2 || parsed.lap !== 42) throw new Error("de rij is beschadigd");
});

Deno.test("buiten ±86400 is geen gat: dat veld wordt leeg, de rij blijft", () => {
  const teGroot = eerste({ gapToPlayerSeconds: 86401 });
  if (teGroot.gapToPlayerSeconds !== null) throw new Error("86401 werd geaccepteerd");
  if (teGroot.gapToLeaderSeconds !== 1.8) throw new Error("ander gat is meegesleurd");
  const teKlein = eerste({ gapToPlayerSeconds: -86401 });
  if (teKlein.gapToPlayerSeconds !== null) throw new Error("-86401 werd geaccepteerd");
  const oneindig = eerste({ gapToPlayerSeconds: Number.NEGATIVE_INFINITY });
  if (oneindig.gapToPlayerSeconds !== null) throw new Error("oneindig werd geaccepteerd");
});

Deno.test("positie, ronde en percentage houden hun eigen ondergrens", () => {
  // Die velden zijn geen verschillen: negatief blijft ongeldig en wordt leeg.
  const parsed = eerste({ position: -1, lap: -1, lapDistancePct: -0.2, speedKph: -5, lastLapSeconds: -1 });
  if (parsed.position !== null) throw new Error("negatieve positie werd geaccepteerd");
  if (parsed.lap !== null) throw new Error("negatieve ronde werd geaccepteerd");
  if (parsed.lapDistancePct !== null) throw new Error("negatief percentage werd geaccepteerd");
  if (parsed.speedKph !== null) throw new Error("negatieve snelheid werd geaccepteerd");
  if (parsed.lastLapSeconds !== null) throw new Error("negatieve rondetijd werd geaccepteerd");
  if (parsed.gapToPlayerSeconds !== 12.3) throw new Error("gat is onterecht aangetast");
});

Deno.test("een frame met een negatief gat wordt geaccepteerd in plaats van geleegd", () => {
  const parsed = parseOpponents([
    tegenstander({ id: "p1", position: 1, gapToPlayerSeconds: -42.8, gapToLeaderSeconds: 0 }),
    tegenstander({ id: "p6", position: 6, gapToPlayerSeconds: 0, gapToLeaderSeconds: 12.3 }),
    tegenstander({ id: "p7", position: 7, gapToPlayerSeconds: 2.1, gapToLeaderSeconds: 15 }),
  ]);
  if (!parsed) throw new Error("lijst werd niet geparsed");
  const gaten = parsed.map((o) => o.gapToPlayerSeconds);
  if (JSON.stringify(gaten) !== JSON.stringify([-42.8, 0, 2.1])) throw new Error(`gaten zijn aangetast: ${JSON.stringify(gaten)}`);
});
