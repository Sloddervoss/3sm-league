import { describe, expect, it } from "vitest";
import { pitwallContextNotice, type PitwallContext } from "@/features/endurance/pitwall/pitwallHelpers";

const basis: PitwallContext = {
  status: "live",
  race_run_id: "run-1",
  event_status: "scheduled",
  telemetry_run_id: "run-1",
  telemetry_received_at: "2026-11-08T17:56:01.702743+00:00",
};

/**
 * Fase 1: zonder geldige racekoppeling moet de pitwall zeggen waarom de
 * racegebonden blokken leeg zijn. Deze teksten zijn door de eigenaar
 * goedgekeurd op 2026-11-08; wijzigen is een productbesluit, geen testfix.
 */
describe("pitwallContextNotice", () => {
  it("zwijgt bij een geldige, actieve race", () => {
    expect(pitwallContextNotice(basis)).toBeNull();
  });

  it("zwijgt als er nog helemaal geen telemetrie is", () => {
    expect(pitwallContextNotice({ ...basis, status: "no_telemetry" })).toBeNull();
  });

  it("zwijgt in de archiefweergave van een afgesloten race", () => {
    expect(
      pitwallContextNotice({ ...basis, status: "event_completed", view: "history" }),
    ).toBeNull();
  });

  it("zegt dat het event is afgesloten", () => {
    const notice = pitwallContextNotice({ ...basis, status: "event_completed" });
    expect(notice?.tone).toBe("warning");
    expect(notice?.message).toBe("Dit event is afgesloten. Er is geen live race meer om te tonen.");
  });

  it("noemt de ontvangsttijd bij verouderde telemetrie", () => {
    const notice = pitwallContextNotice({ ...basis, status: "stale_telemetry" });
    expect(notice?.tone).toBe("warning");
    expect(notice?.message.startsWith("De telemetrie is verouderd — laatst ontvangen om ")).toBe(true);
    expect(notice?.message.endsWith(".")).toBe(true);
  });

  it("valt terug op een korte zin zonder bruikbare tijd", () => {
    const notice = pitwallContextNotice({
      ...basis,
      status: "stale_telemetry",
      telemetry_received_at: null,
    });
    expect(notice?.message).toBe("De telemetrie is verouderd.");
  });

  it("zegt dat het apparaat nog niet gekoppeld is", () => {
    const notice = pitwallContextNotice({ ...basis, status: "unlinked_telemetry" });
    expect(notice?.tone).toBe("info");
    expect(notice?.message).toBe("Dit apparaat is nog niet aan een race gekoppeld.");
  });

  it("zegt dat er geen actieve race is", () => {
    const notice = pitwallContextNotice({ ...basis, status: "inactive_run" });
    expect(notice?.tone).toBe("info");
    expect(notice?.message).toBe(
      "Geen actieve race gevonden voor dit team. Je ziet alleen de live telemetrie.",
    );
  });

  it("legt niet zelf een status uit die de server nog niet kent", () => {
    expect(pitwallContextNotice({ ...basis, status: "iets_nieuws" })).toBeNull();
  });

  it("gaat goed om met een ontbrekend contextblok", () => {
    expect(pitwallContextNotice(null)).toBeNull();
    expect(pitwallContextNotice(undefined)).toBeNull();
  });
});
