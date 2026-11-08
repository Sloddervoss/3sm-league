import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { tyreObservationTiming } from "./tyreObservation.ts";

/**
 * Vastgelegd met de echte cijfers van de 4-uursrace op 2026-11-08: het
 * tyres-blok bleef op 14:44:29 hangen terwijl het frame allang verder liep.
 */
Deno.test("het frame bepaalt de ronde, niet het oude tyres-blok", () => {
  const uitkomst = tyreObservationTiming(
    { lap: 6, sessionTimeSeconds: 3199.5 },
    { timing: { completedLaps: 11 }, session: { sessionTimeSeconds: 5210.25 } },
  );
  assertEquals(uitkomst.lap, 11);
  assertEquals(uitkomst.sessionTimeSeconds, 5210.25);
  assertEquals(uitkomst.lapSource, "frame");
  assertEquals(uitkomst.sessionTimeSource, "frame");
});

Deno.test("zonder ronde in het frame valt hij terug op het tyres-blok", () => {
  const uitkomst = tyreObservationTiming(
    { lap: 6, sessionTimeSeconds: 3199.5 },
    { timing: {}, session: {} },
  );
  assertEquals(uitkomst.lap, 6);
  assertEquals(uitkomst.sessionTimeSeconds, 3199.5);
  assertEquals(uitkomst.lapSource, "tyres");
});

Deno.test("nul rondes is een geldige waarde en telt als framebron", () => {
  const uitkomst = tyreObservationTiming(
    { lap: 6, sessionTimeSeconds: 3199.5 },
    { timing: { completedLaps: 0 }, session: { sessionTimeSeconds: 0 } },
  );
  assertEquals(uitkomst.lap, 0);
  assertEquals(uitkomst.sessionTimeSeconds, 0);
  assertEquals(uitkomst.lapSource, "frame");
});

Deno.test("zonder enige bron blijft het leeg, geen verzonnen nul", () => {
  const uitkomst = tyreObservationTiming({}, null);
  assertEquals(uitkomst.lap, null);
  assertEquals(uitkomst.sessionTimeSeconds, null);
  assertEquals(uitkomst.lapSource, null);
});

Deno.test("NaN en oneindig gelden niet als meting", () => {
  const uitkomst = tyreObservationTiming(
    { lap: 4, sessionTimeSeconds: 10 },
    { timing: { completedLaps: Number.NaN }, session: { sessionTimeSeconds: Number.POSITIVE_INFINITY } },
  );
  assertEquals(uitkomst.lap, 4);
  assertEquals(uitkomst.sessionTimeSeconds, 10);
});
