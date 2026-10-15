import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regressietests voor de sitemap-<lastmod> van de dynamische routes.
 *
 * Een <lastmod> die altijd 'nu' is, is een leugen: Google ziet het element bij
 * elke build verschuiven zonder dat de pagina verandert en gaat het negeren.
 * Deze tests leggen vast dat de datum uit de rij zelf komt (races.updated_at,
 * leagues.updated_at, teams.updated_at, team_memberships.created_at) en dat de
 * klok er niets aan verandert — de systeemtijd staat in de tests bewust op de
 * bouwdag (2026-10-15) terwijl de rijdata uit 2025/2026 komt.
 */

const sitemapLastmod = () => import("../../scripts/sitemap-lastmod.mjs");

const BOOTDAG = "2026-10-15T20:30:00Z";

const fakeKlokOp = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

afterEach(() => {
  vi.useRealTimers();
});

describe("sitemap-lastmod: de datum komt uit de rij, niet uit de klok", () => {
  it("gebruikt races.updated_at als wijzigingstijd van een uitslagpagina", async () => {
    const { resultRouteLastmod } = await sitemapLastmod();
    fakeKlokOp(BOOTDAG);

    expect(resultRouteLastmod({
      id: "race-1",
      race_date: "2025-11-01T20:00:00+00:00",
      updated_at: "2026-01-05T18:30:00+00:00",
    })).toBe("2026-01-05");
  });

  it("verandert niet wanneer de klok een jaar doorschuift", async () => {
    const { resultRouteLastmod } = await sitemapLastmod();
    const race = { race_date: "2025-11-01T20:00:00+00:00", updated_at: "2026-01-05T18:30:00+00:00" };

    fakeKlokOp(BOOTDAG);
    const opBouwdag = resultRouteLastmod(race);

    vi.setSystemTime(new Date("2027-03-02T09:00:00Z"));
    const eenJaarLater = resultRouteLastmod(race);

    expect(opBouwdag).toBe("2026-01-05");
    expect(eenJaarLater).toBe(opBouwdag);
    expect(eenJaarLater).not.toBe("2026-10-15");
    expect(eenJaarLater).not.toBe("2027-03-02");
  });

  it("valt terug op race_date als de rij nog geen updated_at heeft", async () => {
    const { resultRouteLastmod } = await sitemapLastmod();
    fakeKlokOp(BOOTDAG);

    expect(resultRouteLastmod({ race_date: "2025-11-01T20:00:00+00:00", updated_at: null })).toBe("2025-11-01");
  });

  it("laat <lastmod> weg in plaats van de bouwdatum te verzinnen", async () => {
    const { lastmodXml, resultRouteLastmod, driverRouteLastmod } = await sitemapLastmod();
    fakeKlokOp(BOOTDAG);

    expect(resultRouteLastmod({})).toBeNull();
    expect(resultRouteLastmod(undefined)).toBeNull();
    expect(driverRouteLastmod([])).toBeNull();
    expect(lastmodXml({ path: "/drivers/zonder-race", lastmod: driverRouteLastmod([]) })).toBe("");
    expect(lastmodXml({ path: "/drivers/zonder-race" })).toBe("");
  });

  it("negeert onbruikbare tijdstempels", async () => {
    const { latestTimestamp, lastmodDate } = await sitemapLastmod();

    expect(lastmodDate("niet-een-datum", null, undefined, "", {})).toBeNull();
    expect(lastmodDate("2026-01-05", "onzin", "2025-12-31T23:00:00Z")).toBe("2026-01-05");
    expect(latestTimestamp(null, undefined)).toBeNull();
  });

  it("neemt voor een coureur de nieuwste race waarin hij voorkomt", async () => {
    const { driverRouteLastmod } = await sitemapLastmod();
    fakeKlokOp(BOOTDAG);

    expect(driverRouteLastmod([
      { race_date: "2026-02-01T19:00:00+00:00", updated_at: "2026-02-02T09:00:00+00:00" },
      { race_date: "2026-05-06T19:00:00+00:00", updated_at: null },
      { race_date: "2026-01-04T19:00:00+00:00", updated_at: "2026-01-05T09:00:00+00:00" },
    ])).toBe("2026-05-06");
  });

  it("neemt voor een team de teamrij, het lidmaatschap en de races van de leden samen", async () => {
    const { teamRouteLastmod } = await sitemapLastmod();
    fakeKlokOp(BOOTDAG);

    // Nieuw lid (lidmaatschapsrij) is hier de jongste echte wijziging.
    expect(teamRouteLastmod({
      updatedAt: "2026-02-01T10:00:00+00:00",
      membershipTimestamps: ["2026-03-04T08:00:00+00:00", null],
      memberRaces: [{ race_date: "2026-03-01T19:00:00+00:00", updated_at: null }],
    })).toBe("2026-03-04");

    // Een race van een lid is jonger dan de teamrij en het lidmaatschap.
    expect(teamRouteLastmod({
      updatedAt: "2026-02-01T10:00:00+00:00",
      membershipTimestamps: ["2026-01-15T08:00:00+00:00"],
      memberRaces: [{ race_date: "2026-05-06T19:00:00+00:00", updated_at: "2026-05-07T07:00:00+00:00" }],
    })).toBe("2026-05-07");

    // Zonder leden en zonder teamrij is er geen echte datum.
    expect(teamRouteLastmod({})).toBeNull();
  });

  it("negeert race_date voor een seizoen: het raceschema loopt vooruit", async () => {
    const { seasonRouteLastmod } = await sitemapLastmod();
    fakeKlokOp(BOOTDAG);

    expect(seasonRouteLastmod({
      updatedAt: "2026-01-02T10:00:00+00:00",
      races: [
        { race_date: "2026-06-07T19:00:00+00:00", updated_at: null },
        { race_date: "2026-02-02T19:00:00+00:00", updated_at: "2026-02-03T10:00:00+00:00" },
      ],
    })).toBe("2026-02-03");

    // Een nieuw ingeplande race verandert het "x van y verreden" op de pagina,
    // maar de wijzigingstijd is het moment van inplannen (updated_at) - niet de
    // (toekomstige) racedatum. race_date mag hier nooit winnen.
    expect(seasonRouteLastmod({
      updatedAt: "2026-01-02T10:00:00+00:00",
      races: [{ race_date: "2027-02-18T19:30:00+00:00", updated_at: "2026-08-01T12:00:00+00:00" }],
    })).toBe("2026-08-01");

    expect(seasonRouteLastmod({})).toBeNull();
  });

  it("een race met een toekomstdatum levert nooit een <lastmod> in de toekomst", async () => {
    const { lastmodXml, seasonRouteLastmod } = await sitemapLastmod();
    fakeKlokOp(BOOTDAG);

    // Exact het productiegeval: de eerstvolgende races staan op 2027-02-18
    // (3SM GT3 Free Track Challenge) en 2027-02-10 (GT Master Challenge Cup
    // 2026 s2), terwijl de race-rijen op 2026-09-04 zijn bijgewerkt.
    const lastmod = seasonRouteLastmod({
      updatedAt: "2026-08-20T09:00:00+00:00",
      races: [
        { race_date: "2027-02-18T19:30:00+00:00", updated_at: "2026-09-04T16:15:08+00:00" },
        { race_date: "2027-02-10T19:30:00+00:00", updated_at: "2026-09-04T18:06:42+00:00" },
      ],
    });

    expect(lastmod).toBe("2026-09-04");
    const xml = lastmodXml({ path: "/seasons/gt-master-challenge-cup-2026-s2", lastmod }, BOOTDAG);
    expect(xml).toBe("\n    <lastmod>2026-09-04</lastmod>");
    expect(xml).not.toContain("2027");
    expect(xml).not.toContain("2026-10-15");
  });

  it("zet de rijdatum in de sitemap-XML en nooit de bouwdatum", async () => {
    const { driverRouteLastmod, lastmodXml, resultRouteLastmod } = await sitemapLastmod();
    fakeKlokOp(BOOTDAG);

    const uitslag = { path: "/results/race-1", lastmod: resultRouteLastmod({ race_date: "2026-09-01T19:00:00+00:00", updated_at: "2026-09-08T10:00:00+00:00" }) };
    const coureur = { path: "/drivers/jan-jansen", lastmod: driverRouteLastmod([{ race_date: "2026-09-01T19:00:00+00:00", updated_at: null }]) };

    expect(lastmodXml(uitslag)).toBe("\n    <lastmod>2026-09-08</lastmod>");
    expect(lastmodXml(coureur)).toBe("\n    <lastmod>2026-09-01</lastmod>");
    expect(lastmodXml(uitslag)).not.toContain("2026-10-15");
    expect(lastmodXml(coureur)).not.toContain("2026-10-15");
  });
});

describe("generator: de dynamische lastmod komt uit de rijen", () => {
  const generator = readFileSync("scripts/generate-route-html.mjs", "utf8");

  it("haalt de vier routetypes uit de gedeelde helper", () => {
    expect(generator).toContain("from './sitemap-lastmod.mjs'");
    for (const resolver of ["resultRouteLastmod", "driverRouteLastmod", "teamRouteLastmod", "seasonRouteLastmod"]) {
      expect(generator, `${resolver} wordt niet gebruikt`).toContain(`${resolver}(`);
    }
  });

  it("leidt de lastmod niet meer af uit de bouwdatum", () => {
    expect(generator).not.toContain("lastmod: dateOnly(race.race_date)");
    expect(generator).not.toContain("lastmod: buildDate");
    expect(generator).not.toMatch(/lastmod:\s*new Date\(/);
  });

  it("vraagt de tijdstempelkolommen echt op", () => {
    // Zonder updated_at in de select kan de resolver alleen terugvallen op de
    // racedatum en dat is voor punten, overwinningen en podiums niet de
    // wijzigingstijd van de pagina.
    expect(generator).toMatch(/from\('races'\)\s*\n?\s*\.select\('[^']*updated_at/);
    expect(generator).toMatch(/from\('leagues'\)\s*\n?\s*\.select\('[^']*updated_at/);
    expect(generator).toMatch(/from\('teams'\)\s*\n?\s*\.select\('[^']*updated_at/);
    expect(generator).toMatch(/from\('team_memberships'\)\s*\n?\s*\.select\('[^']*created_at/);
  });
});
