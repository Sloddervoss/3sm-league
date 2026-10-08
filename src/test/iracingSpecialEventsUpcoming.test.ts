import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPublishedSpecialSeason } from "../../supabase/functions/iracing-special-events-sync/discovery";
import { discoverUpcomingSpecialEvents, normalizeSpecialEvent } from "../../supabase/functions/iracing-special-events-sync/normalize";
import { countAdmittedUpcomingEvents, findApprovedSpecialEvent, shouldImportSpecialEvent } from "../../supabase/functions/iracing-special-events-sync/allowlist";

const pagina = readFileSync(
  join(process.cwd(), "supabase/functions/iracing-special-events-sync/fixtures/special-events-page-2026-10-08.html"),
  "utf8",
);

/**
 * Deze tests draaien tegen de ECHTE iRacing-pagina (opgehaald 8 oktober 2026) en
 * niet tegen een zelfgemaakt voorbeeld. Ze leggen zowel het gedrag van vandaag
 * vast als het nieuwe gedrag zodra het volgende seizoen verschijnt.
 */
describe("discovery op de echte iRacing-pagina (fixture 8 oktober 2026)", () => {
  const seeds = discoverUpcomingSpecialEvents(pagina);

  it("leest de tien aankomende events en laat de afgelopen events liggen", () => {
    // De pagina bevat ook ruim twintig afgelopen events (Daytona 24, Sebring 12HR,
    // Petit Le Mans, …). Die mogen hier niet in voorkomen: er wordt uitsluitend
    // tussen de koppen Upcoming Events en Completed Events gekeken.
    expect(seeds.map((seed) => seed.sourceKey).sort()).toEqual([
      "iracing:2026:8-hours-of-indianapolis",
      "iracing:2026:992-endurance-cup",
      "iracing:2026:chili-bowl",
      "iracing:2026:dale-jr-charity-event",
      "iracing:2026:homestead-championship",
      "iracing:2026:iracing-ff1600-festival",
      "iracing:2026:scca-runoffs",
      "iracing:2026:sfl-mountain-showdown",
      "iracing:2026:the-production-car-challenge-vir",
      "iracing:2026:winter-derby",
    ].sort());
    expect(seeds.every((seed) => seed.sourceKey.startsWith("iracing:2026:"))).toBe(true);
  });

  it("neemt jaar, datums en klassen over zoals de pagina ze geeft", () => {
    const indianapolis = seeds.find((seed) => seed.sourceKey === "iracing:2026:8-hours-of-indianapolis");
    expect(indianapolis).toMatchObject({ year: 2026, dateStart: "2026-10-16", dateEnd: "2026-10-18", teamEvent: true });
    expect(indianapolis?.classIds).toEqual(["GT3"]);
    for (const seed of seeds) expect(Number.isInteger(seed.year), seed.sourceKey).toBe(true);
    // Eén event noemt nog geen datum en geen klassen. Dat mag er zo in (het wordt
    // tbd) — er mag nooit een datum verzonnen worden.
    expect(seeds.filter((seed) => !seed.dateStart).map((seed) => seed.sourceKey)).toEqual(["iracing:2026:dale-jr-charity-event"]);
  });

  it("laat vandaag alleen de 8 Hours of Indianapolis door de allowlist (verder niets)", () => {
    // Precies één van de tien aankomende events staat op de endurance-lijst, en
    // dat event bestaat al als rij in de catalogus. De uitkomst van de sync op de
    // huidige data verandert dus niet — de belangrijkste eis aan deze reparatie.
    expect(
      seeds.filter((seed) => findApprovedSpecialEvent(seed) !== null).map((seed) => findApprovedSpecialEvent(seed)?.name),
    ).toEqual(["8 Hours of Indianapolis"]);
    for (const seed of seeds.filter((candidate) => candidate.sourceKey !== "iracing:2026:8-hours-of-indianapolis")) {
      expect(findApprovedSpecialEvent(seed), seed.sourceKey).toBeNull();
    }
  });

  it("laat een goedgekeurd event wél toe zodra het in het nieuwe seizoen verschijnt", () => {
    // Zelfde pagina, maar met een endurance-naam op de plek van een aankomend
    // event: exact de situatie van volgend seizoen, waarin de sleutel een nieuw
    // jaartal krijgt en het event dus "onbekend" is.
    const gewijzigd = pagina.replace(/>\s*Winter Derby\s*</, ">Daytona 24<");
    const volgendeSeizoen = discoverUpcomingSpecialEvents(gewijzigd);
    const daytona = volgendeSeizoen.find((seed) => seed.sourceKey === "iracing:2026:daytona-24");
    expect(daytona, "het hernoemde event moet ontdekt worden").toBeTruthy();
    const goedgekeurd = findApprovedSpecialEvent(daytona!);
    expect(goedgekeurd?.name).toBe("Daytona 24");
    // De oude regel (alleen gekoppeld of bekend) sloeg hem over — dat is precies
    // de fout die de kalender liet leeglopen. De nieuwe regel laat hem door.
    expect(shouldImportSpecialEvent({ mapped: false, known: false, approved: false })).toBe(false);
    expect(shouldImportSpecialEvent({ mapped: false, known: false, approved: Boolean(goedgekeurd) })).toBe(true);
  });

  it("blijft een niet-goedgekeurd nieuw event overslaan", () => {
    // De waarborg tegen "dan maar alles importeren".
    const gewijzigd = pagina.replace(/>\s*Winter Derby\s*</, ">SCCA Runoffs<");
    const runoffs = discoverUpcomingSpecialEvents(gewijzigd).find((seed) => seed.sourceKey === "iracing:2026:scca-runoffs");
    expect(runoffs).toBeTruthy();
    expect(findApprovedSpecialEvent(runoffs!)).toBeNull();
    expect(shouldImportSpecialEvent({ mapped: false, known: false, approved: false })).toBe(false);
  });

  it("levert voor een nieuw goedgekeurd event zonder gepubliceerde tijden een datum-event op", async () => {
    // Dit is het pad dat volgend seizoen loopt zolang iRacing de tijdsloten nog
    // niet heeft gepubliceerd: alleen kalendergegevens, geen slots, geen tijden.
    const gewijzigd = pagina.replace(/>\s*Winter Derby\s*</, ">Daytona 24<");
    const daytona = discoverUpcomingSpecialEvents(gewijzigd).find((seed) => seed.sourceKey === "iracing:2026:daytona-24")!;
    const normalised = await normalizeSpecialEvent(daytona, null);
    expect(normalised.availabilityStatus).toBe("date_only");
    expect(normalised.slots).toEqual([]);
    expect(normalised.dateStart).toBe("2026-12-02");
    expect(normalised.dateEnd).toBe("2026-12-07");
    expect(normalised.sourceHash).toBeTruthy();
    // Twee keer normaliseren geeft exact dezelfde hash: de upsert is idempotent,
    // dus elke volgende syncronde werkt dezelfde rij bij in plaats van te dupliceren.
    const nogmaals = await normalizeSpecialEvent(daytona, null);
    expect(nogmaals.sourceHash).toBe(normalised.sourceHash);
  });

  it("telt voor het leegloop-signaal alleen importeerbare aankomende events", () => {
    // De pagina biedt tien aankomende events, waarvan er negen door 3SM bewust niet
    // gevolgd worden (Winter Derby, Chili Bowl, FF1600-festival). Zou het signaal
    // die meetellen, dan zwijgt het juist op het moment dat de endurance-kalender
    // leegloopt — dat was de fout in een eerdere poging.
    const vandaag = "2026-10-08";
    const leeg = new Set<string>();
    const allesAankomend = seeds.filter((seed) => (seed.dateEnd ?? seed.dateStart ?? "") >= vandaag).length;
    expect(allesAankomend).toBeGreaterThan(1);
    expect(countAdmittedUpcomingEvents(seeds, vandaag, leeg, leeg)).toBe(1);
  });

  it("telt niets mee als de pagina alleen events biedt die 3SM niet volgt", () => {
    // Zonder de Indianapolis-kaart blijft er op deze pagina niets over dat 3SM
    // volgt: een lege endurance-kalender is dan een echt signaal.
    const zonderIndianapolis = pagina.replace(/>\s*8 Hours of Indianapolis\s*</, ">Winter Derby<");
    const gewijzigd = discoverUpcomingSpecialEvents(zonderIndianapolis);
    expect(countAdmittedUpcomingEvents(gewijzigd, "2026-10-08", new Set(), new Set())).toBe(0);
  });

  it("telt een event dat al in de catalogus staat mee, ook zonder goedkeuring", () => {
    // Een bestaande rij wordt altijd bijgewerkt; zo'n event is dus geen leegloop.
    const vandaag = "2026-10-08";
    const bestaand = new Set(["iracing:2026:winter-derby"]);
    expect(countAdmittedUpcomingEvents(seeds, vandaag, new Set(), bestaand)).toBe(2);
  });

  it("neemt nooit de tijden van een ander jaar over", () => {
    // De tijdsloten van een event komen uit iRacings gepubliceerde seizoen van
    // datzelfde jaar. Een seizoen met dezelfde naam maar een ander jaar mag nooit
    // matchen: anders zouden de tijden van vorig jaar op de kaart van dit jaar
    // belanden. Deze controle zit op het jaar én op de naam.
    const seizoenen = [
      { season_id: 6310, season_year: 2026, season_name: "2026 Daytona 24" },
      { season_id: 7001, season_year: 2027, season_name: "2027 Bathurst 12" },
    ];
    const ditJaar = { sourceKey: "iracing:2027:daytona-24", year: 2027, name: "Daytona 24" };
    expect(findPublishedSpecialSeason(ditJaar, seizoenen)).toBeNull();
    const metEigenSeizoen = { sourceKey: "iracing:2027:bathurst-12", year: 2027, name: "Bathurst 12" };
    expect(findPublishedSpecialSeason(metEigenSeizoen, seizoenen)?.season_id).toBe(7001);
    // En de tijdsloten van een nieuw event worden opgehaald met het seizoen van
    // het event zelf — nooit met dat van een vorig jaar.
    const vorigJaar = { sourceKey: "iracing:2026:daytona-24", year: 2026, name: "Daytona 24" };
    expect(findPublishedSpecialSeason(vorigJaar, seizoenen)?.season_id).toBe(6310);
  });

  it("verandert niets aan events die al in de catalogus staan", () => {
    // De belangrijkste eigenschap van deze reparatie: voor een event dat al een
    // rij heeft (known) geeft de nieuwe regel exact hetzelfde antwoord als de oude.
    // Er kan dus geen bestaande kaart veranderen of verdwijnen.
    for (const seed of seeds) {
      const approved = Boolean(findApprovedSpecialEvent(seed));
      expect(shouldImportSpecialEvent({ mapped: false, known: true, approved }), seed.sourceKey).toBe(true);
    }
  });

  it("weigert een pagina zonder de officiële sectiekoppen in plaats van te gokken", () => {
    expect(() => discoverUpcomingSpecialEvents("<html><body>iets anders</body></html>")).toThrow();
  });
});
