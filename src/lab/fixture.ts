/**
 * Gedeelde data voor de tien pitwall-ontwerpen.
 *
 * Elke ontwerper bouwt een volledige pitwall op deze ene bron, zodat de
 * verschillen echt in het ontwerp zitten en niet in de cijfers.
 */

export type Corner = { wear: number; tempC: number };
export type Standing = {
  pos: number;
  classPos: number;
  cls: string;
  driver: string;
  car: string;
  gap: string;
  lastLap: string;
  bestLap: string;
  tyreAgeLaps: number;
  inPit: boolean;
  isSelf: boolean;
};

export type PitwallFixture = {
  event: { name: string; circuit: string; lap: number; totalLaps: number; timeLeft: string; flag: string };
  self: { driver: string; team: string; car: string; pos: number; classPos: number; cls: string };
  gaps: { ahead: string; behind: string; aheadName: string; behindName: string };
  telemetry: { speedKph: number; gear: number; rpm: number; s1: string; s2: string; s3: string; lastLap: string; bestLap: string };
  fuel: { litres: number; perLap: number; lapsLeft: number; tankLitres: number; toAddLitres: number; toFinishLitres: number };
  tyres: {
    fl: Corner; fr: Corner; rl: Corner; rr: Corner;
    setLaps: number; compound: string; grade: "A" | "B" | "C" | "D";
    wearRange: [number, number]; note: string;
  };
  pit: { windowInLaps: number; pitLossSeconds: number; recommendation: "STAY_OUT" | "PIT_SOON" | "PIT_NOW"; reason: string };
  standings: Standing[];
  pace: number[];
  rotation: { current: string; next: string; nextInMinutes: number; after: string; afterInMinutes: number };
  weather: { airC: number; trackC: number; rubber: string };
  trackMap: {
    viewBox: string;
    path: string;
    cars: { x: number; y: number; cls: string; self: boolean; label: string }[];
  };
};

export const fixture: PitwallFixture = {
  event: { name: "6 uur van Montreal", circuit: "Circuit Gilles Villeneuve", lap: 42, totalLaps: 120, timeLeft: "3:12:44", flag: "groen" },
  self: { driver: "Vincent de Vos", team: "Testteam Vincent", car: "Lamborghini Huracán GT3 EVO", pos: 3, classPos: 2, cls: "GT3" },
  gaps: { ahead: "+2.3", behind: "-11.8", aheadName: "S. Visser", behindName: "J. Peters" },
  telemetry: { speedKph: 214, gear: 5, rpm: 6820, s1: "30.104", s2: "34.812", s3: "31.507", lastLap: "1:36.423", bestLap: "1:35.311" },
  fuel: { litres: 42.6, perLap: 2.94, lapsLeft: 14, tankLitres: 104, toAddLitres: 35, toFinishLitres: 103.99 },
  tyres: {
    fl: { wear: 93.1, tempC: 88 }, fr: { wear: 94.8, tempC: 90 },
    rl: { wear: 94.6, tempC: 85 }, rr: { wear: 95.4, tempC: 86 },
    setLaps: 12, compound: "Slick medium", grade: "C", wearRange: [1.2, 2.4],
    note: "Meting bij de laatste stop; geen live waarde",
  },
  pit: { windowInLaps: 14, pitLossSeconds: 38, recommendation: "PIT_SOON", reason: "Tank is eerder leeg dan de banden" },
  standings: [
    { pos: 1, classPos: 1, cls: "GT3", driver: "M. de Boer", car: "Porsche 911 GT3 R", gap: "LEIDER", lastLap: "1:35.881", bestLap: "1:35.102", tyreAgeLaps: 18, inPit: false, isSelf: false },
    { pos: 2, classPos: 1, cls: "GT4", driver: "S. Visser", car: "McLaren 570S", gap: "+1.9", lastLap: "1:38.204", bestLap: "1:37.660", tyreAgeLaps: 22, inPit: false, isSelf: false },
    { pos: 3, classPos: 2, cls: "GT3", driver: "Vincent de Vos", car: "Lamborghini Huracán GT3 EVO", gap: "+4.2", lastLap: "1:36.423", bestLap: "1:35.311", tyreAgeLaps: 12, inPit: false, isSelf: true },
    { pos: 4, classPos: 3, cls: "GT3", driver: "D. Koster", car: "BMW M4 GT3", gap: "+16.0", lastLap: "1:36.902", bestLap: "1:35.774", tyreAgeLaps: 9, inPit: false, isSelf: false },
    { pos: 5, classPos: 2, cls: "GT4", driver: "L. Meijer", car: "Aston Martin Vantage GT4", gap: "+28.4", lastLap: "1:39.011", bestLap: "1:38.120", tyreAgeLaps: 15, inPit: false, isSelf: false },
    { pos: 6, classPos: 4, cls: "GT3", driver: "R. Godefrooij", car: "Ferrari 296 GT3", gap: "+41.7", lastLap: "1:37.554", bestLap: "1:36.201", tyreAgeLaps: 20, inPit: false, isSelf: false },
    { pos: 7, classPos: 5, cls: "GT3", driver: "K. Bakker", car: "Mercedes-AMG GT3", gap: "+58.2", lastLap: "1:37.118", bestLap: "1:36.044", tyreAgeLaps: 4, inPit: true, isSelf: false },
    { pos: 8, classPos: 3, cls: "GT4", driver: "T. Smit", car: "Porsche 718 Cayman GT4", gap: "+1:12.6", lastLap: "1:40.220", bestLap: "1:39.004", tyreAgeLaps: 26, inPit: false, isSelf: false },
  ],
  pace: [96.4, 96.1, 95.9, 96.3, 96.0, 95.7, 96.2, 96.6, 96.1, 95.8, 96.4, 96.9, 97.2, 96.5, 96.2, 96.0, 96.3, 96.7, 96.1, 96.4],
  rotation: { current: "Vincent de Vos", next: "Jaimy Peters", nextInMinutes: 34, after: "Bart Tonkes", afterInMinutes: 92 },
  weather: { airC: 18.7, trackC: 26.1, rubber: "moderately low usage" },
  trackMap: {
    viewBox: "0 0 420 190",
    path:
      "M28 118 L28 74 Q28 58 44 58 L96 58 Q112 58 112 74 L112 86 Q112 100 128 100 L196 100 " +
      "Q212 100 212 84 L212 52 Q212 36 228 36 L268 36 Q284 36 284 52 L284 92 Q284 108 300 108 " +
      "L348 108 Q368 108 372 128 L376 150 Q378 166 362 166 L96 166 Q78 166 74 150 L62 132 " +
      "Q58 122 44 122 Z",
    cars: [
      { x: 150, y: 100, cls: "GT3", self: false, label: "P1" },
      { x: 196, y: 100, cls: "GT4", self: false, label: "P2" },
      { x: 226, y: 88, cls: "GT3", self: true, label: "JIJ" },
      { x: 262, y: 60, cls: "GT3", self: false, label: "P4" },
      { x: 300, y: 108, cls: "GT4", self: false, label: "P5" },
      { x: 340, y: 150, cls: "GT3", self: false, label: "P6" },
      { x: 210, y: 166, cls: "GT3", self: false, label: "P7" },
      { x: 90, y: 150, cls: "GT4", self: false, label: "P8" },
    ],
  },
};
