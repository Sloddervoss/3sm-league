import { describe, expect, it } from "vitest";
import {
  APPROVED_ENDURANCE_SPECIAL_EVENTS,
  findApprovedSpecialEvent,
  shouldImportSpecialEvent,
  slugFromSourceKey,
} from "../../supabase/functions/iracing-special-events-sync/allowlist";

describe("endurance-allowlist voor iRacing special events", () => {
  it("noemt elk event één keer en deelt geen slug met een ander event", () => {
    const namen = APPROVED_ENDURANCE_SPECIAL_EVENTS.map((entry) => entry.name);
    expect(new Set(namen).size).toBe(namen.length);
    const slugs = APPROVED_ENDURANCE_SPECIAL_EVENTS.flatMap((entry) => [...entry.slugs]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("herkent de namen zoals iRacing ze werkelijk op de pagina zet", () => {
    // Deze namen zijn letterlijk overgenomen uit de opgehaalde pagina; de slug
    // erachter is wat de sync als sleutel gebruikt.
    const pagina: ReadonlyArray<readonly [string, string]> = [
      ["Daytona 24", "daytona-24"],
      ["Bathurst 12", "bathurst-12"],
      ["Sebring 12HR", "sebring-12hr"],
      ["Nürburgring 24h", "nurburgring-24h"],
      ["4 Hours at Thruxton", "4-hours-at-thruxton"],
      ["Watkins Glen 6 Hour", "watkins-glen-6-hour"],
      ["Spa 24HR", "spa-24hr"],
      ["6 Hours Of Road America", "6-hours-of-road-america"],
      ["Portimao 1000", "portimao-1000"],
      ["Suzuka 1000km", "suzuka-1000km"],
      ["Britcar 24HR", "britcar-24hr"],
      ["Petit Le Mans", "petit-le-mans"],
      ["Bathurst 1000", "bathurst-1000"],
      ["8 Hours of Indianapolis", "8-hours-of-indianapolis"],
      ["IMSA Classic 500", "imsa-classic-500"],
    ];
    for (const [naam, slug] of pagina) {
      const gevonden = findApprovedSpecialEvent({ name: naam, sourceKey: `iracing:2027:${slug}` });
      expect(gevonden, `${naam} hoort goedgekeurd te zijn`).not.toBeNull();
      expect(gevonden?.slugs).toContain(slug);
    }
  });

  it("herkent ook de naamvarianten die in de wandelgangen gebruikt worden", () => {
    // Vier races heten elders anders dan op de officiële pagina. Zonder deze
    // aliassen zouden ze stil buiten de catalogus blijven vallen.
    expect(findApprovedSpecialEvent({ name: "Sebring 12", sourceKey: "iracing:2027:sebring-12" })?.name).toBe("Sebring 12HR");
    expect(findApprovedSpecialEvent({ name: "Spa 24", sourceKey: "iracing:2027:spa-24" })?.name).toBe("Spa 24HR");
    expect(findApprovedSpecialEvent({ name: "Britcar 24", sourceKey: "iracing:2027:britcar-24" })?.name).toBe("Britcar 24HR");
    expect(findApprovedSpecialEvent({ name: "Portimão 1000km", sourceKey: "iracing:2027:portimao-1000km" })?.name).toBe("Portimao 1000");
  });

  it("laat alles buiten het endurance-programma met rust", () => {
    const nietGoedgekeurd = [
      "992 Endurance Cup",
      "THE Production Car Challenge @ViR",
      // Solo-race (geen "TEAM EVENT"-label op de pagina), dus geen team-endurance.
      "iRacing ROAR",
      "iRacing FF1600 Festival",
      "Homestead Championship",
      "SFL Mountain Showdown",
      "SCCA Runoffs",
      "Winter Derby",
      "Chili Bowl",
      "Daytona 500",
      "INDY 500",
      "World 600",
      "Firecracker 400",
      "Brickyard 400",
      "Knoxville Nationals",
      "Crandon Championship",
      "Southern 500",
      "Dale Jr Charity Event",
    ];
    for (const naam of nietGoedgekeurd) {
      expect(findApprovedSpecialEvent({ name: naam, sourceKey: "iracing:2027:onbekend" }), naam).toBeNull();
    }
  });

  it("dekt alle endurance-races die de eigenaar wil volgen", () => {
    // Besluit eigenaar, peildatum 8 oktober 2026: alleen TEAMEVENTS tellen mee
    // (de pagina zet bij zo'n event het label "TEAM EVENT"). Zes races stonden al
    // in de catalogus, tien ontbraken. Wat er bewust buiten blijft: iRacing ROAR
    // (solo-race, geen teamevent) en de éénklasse-races 992 Endurance Cup en THE
    // Production Car Challenge @ViR. Valt hier een naam weg, dan verdwijnt die
    // race stil uit de kalender; deze test is de plek waar dat opvalt.
    const gewenst = [
      "Daytona 24",
      "Bathurst 12",
      "Sebring 12HR",
      "Nürburgring 24h",
      "4 Hours at Thruxton",
      "Watkins Glen 6 Hour",
      "Spa 24HR",
      "6 Hours Of Road America",
      "Portimao 1000",
      "Suzuka 1000km",
      "Britcar 24HR",
      "Petit Le Mans",
      "Bathurst 1000",
      "8 Hours of Indianapolis",
      "IMSA Classic 500",
    ];
    const gedekt = new Set(APPROVED_ENDURANCE_SPECIAL_EVENTS.map((entry) => entry.name));
    for (const naam of gewenst) {
      expect(gedekt.has(naam), `${naam} ontbreekt in de goedkeurlijst`).toBe(true);
    }
    // En niets erbij dat er niet hoort: de lijst is exact deze set.
    expect([...gedekt].sort()).toEqual([...gewenst].sort());
  });

  it("negeert het jaartal in de sleutel, want dat wisselt elk seizoen", () => {
    for (const jaar of [2026, 2027, 2030]) {
      expect(findApprovedSpecialEvent({ name: "Daytona 24", sourceKey: `iracing:${jaar}:daytona-24` })).not.toBeNull();
    }
    expect(slugFromSourceKey("iracing:2027:8-hours-of-indianapolis")).toBe("8-hours-of-indianapolis");
    expect(slugFromSourceKey("zonder-kronkel")).toBe("zonder-kronkel");
  });

  it("importeert uitsluitend een gekoppeld, bekend of goedgekeurd event", () => {
    expect(shouldImportSpecialEvent({ mapped: false, known: false, approved: false })).toBe(false);
    expect(shouldImportSpecialEvent({ mapped: true, known: false, approved: false })).toBe(true);
    expect(shouldImportSpecialEvent({ mapped: false, known: true, approved: false })).toBe(true);
    expect(shouldImportSpecialEvent({ mapped: false, known: false, approved: true })).toBe(true);
    expect(shouldImportSpecialEvent({ mapped: true, known: true, approved: true })).toBe(true);
  });
});
