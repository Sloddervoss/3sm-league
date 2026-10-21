import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("supabase/functions/iracing-special-events-sync/index.ts", "utf8");
const normalizer = readFileSync("supabase/functions/iracing-special-events-sync/normalize.ts", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");

describe("iRacing Special Events sync security contract", () => {
  it("gebruikt dedicated scheduler-token of een geverifieerde super_admin", () => {
    expect(source).toContain('Deno.env.get("ENDURANCE_IRACING_SYNC_TOKEN")');
    expect(source).toContain('row.role === "super_admin"');
    expect(source).toContain("auth.auth.getUser(token)");
    expect(source).not.toMatch(/token\s*===\s*serviceKey/);
    expect(config).toMatch(/\[functions\.iracing-special-events-sync\]\s+verify_jwt = false/);
  });

  it("hergebruikt uitsluitend de gedeelde server-side iRacing-client", () => {
    expect(source).toContain('from "../_shared/iracingClient.ts"');
    expect(source).toContain("createIRacingClient()");
    expect(source).not.toContain("IRACING_PASSWORD");
  });

  it("maakt zichtbare runstatussen en behoudt oude slots bij partial failures", () => {
    for (const status of ["running", "success", "partial", "failed"]) expect(source).toContain(`"${status}"`);
    expect(source).toContain("Partial failures verwijderen of deactiveren dus nooit oude goede slots");
    expect(source).toContain("active: misses < 2");
    expect(source).toContain('calendarHtml && normalized.availabilityStatus === "exact_slots"');
    expect(source).toContain("existing?.source_payload");
    expect(source).toContain('eq("iracing_catalog_slot_id", candidate.id)');
    expect(source).not.toMatch(/\.delete\(\).*endurance_iracing_event_slots/s);
    expect(source).toContain('runError?.code === "23505"');
  });

  it("upsert idempotent op source_key en catalog_event_id/source_slot_key", () => {
    expect(source).toContain('onConflict: "source_key"');
    expect(source).toContain('onConflict: "catalog_event_id,source_slot_key"');
    expect(normalizer).toContain("sourceSlotKey:");
    expect(normalizer).toContain("sourceHash:");
  });

  it("redigeert secrets en retourneert alleen status/tellingen/tijd", () => {
    expect(source).toContain("[REDACTED]");
    expect(source).toContain("events_seen");
    expect(source).toContain("finished_at");
    expect(source).not.toMatch(/json\(\{[^}]*error_summary/s);
  });

  it("ontdekt alle officiële Upcoming Events maar haalt slots alleen voor expliciete mappings", () => {
    expect(source).toContain("discoverUpcomingSpecialEvents(calendarHtml)");
    expect(source).toContain("mappingBySourceKey");
    expect(source).toMatch(/await \(await dataClient\(\)\)\.fetchData\(`\/data\/series\/season_schedule/);
    expect(source).toContain("clientPromise ??= createIRacingClient()");
    expect(source).toContain("clientPromise = null");
    expect(source).toContain("let clientPromise: ReturnType<typeof createIRacingClient> | null = null;");
    expect(source).toContain("local_class_ids: entry?.localClassIds ?? []");
    expect(source).toContain("exact times pending explicit season mapping");
    expect(source).toContain("ENDURANCE_IRACING_SEASON_MAP_JSON");
    expect(source).toContain("https://www.iracing.com/special-events/");
    // runtime mag niet meer de dode WP page-id API oproepen (alleen een comment noemt die URL)
    expect(source).not.toMatch(/fetch\("https:\/\/www\.iracing\.com\/wp-json\/wp\/v2\/pages\/263677"\)/);
    expect(source).not.toContain('"wp-json/wp/v2/pages/263677"');
    expect(normalizer).toContain("Officiële Upcoming/Completed-eventgrenzen ontbreken");
    expect(source).toContain("season_schedule?season_id=");
  });

  it("verwerkt gewone endurance-series per individuele race via discoverSeriesRaces", () => {
    expect(source).toContain('entry.kind === "series"');
    expect(source).toContain("discoverSeriesRaces");
    expect(source).toContain("seriesName:");
    expect(normalizer).toContain("discoverSeriesRaces");
    expect(normalizer).toContain("Ongeldige serieseason-id");
    expect(normalizer).toContain("sourceSlug(row.track.track_name)");
    expect(normalizer).toContain("dateEnd");
  });

  it("combineert een series met combined:true tot één event met per-week slots", () => {
    expect(source).toContain("combined");
    expect(source).toContain("discoverCombinedSeriesEvent");
    expect(source).toContain("seriesSeed.combined");
    expect(normalizer).toContain("discoverCombinedSeriesEvent");
    expect(normalizer).toContain("formatWeekLabel");
  });

  it("importeert alleen gemapte, bekende of expliciet goedgekeurde events", () => {
    // De oorspronkelijke regel (`if (!entry && !known) continue;`) sloeg elk nieuw
    // seizoen over, omdat de eventsleutel het jaartal bevat. Sinds de reparatie is
    // er één expliciete uitzondering: de endurance-lijst in allowlist.ts.
    expect(source).not.toContain("if (!entry && !known) continue;");
    expect(source).toContain("findApprovedSpecialEvent(discoveredSeed)");
    expect(source).toContain("shouldImportSpecialEvent({ mapped: Boolean(entry), known: Boolean(known), approved: Boolean(approved) })");
    expect(source).toContain("findPublishedSpecialSeason(discoveredSeed, publishedSeasons)");
    expect(source).toContain("allowlist.ts");
  });

  it("legt een nieuw goedgekeurd event zonder gepubliceerde tijden vast als datum-event", () => {
    // Zelfde, al bewezen functies als de andere events: geen nieuwe insert-logica.
    expect(source).toContain("await upsertEventAndSlots(await normalizeSpecialEvent(discoveredSeed, null), undefined);");
    expect(source).toContain("known?.local_class_ids ?? []");
    // De bestaande verversingsroute voor bekende events blijft ongewijzigd bestaan.
    expect(source).toContain("gepubliceerde season ontbreekt; oude slots behouden");
    expect(source).toContain('}).eq("id", known.id);');
  });

  it("meldt een verouderde seizoenskoppeling en een lege aankomende kalender", () => {
    // Deze twee signalen bestaan omdat de kalender eerder stil leegliep.
    expect(source).toContain("geen lopend seizoen gevonden");
    expect(source).toContain("geen aankomend endurance-event in de catalogus");
    expect(source).toContain("upcoming_events: upcomingEvents");
    // Het signaal hangt aan het SEIZOEN, niet aan het kalenderjaar: een seizoen
    // loopt over de jaarwisseling heen, dus vergelijken met new Date() zou in
    // januari onterecht alarm slaan terwijl de import gewoon werkt.
    expect(source).toContain("followsSeason");
    expect(source).toContain("seasonYear: seasonYearById.get(effective) ?? null");
    expect(source).toContain("notFollowed.length === seriesSeasonYears.length");
    expect(source).not.toContain("new Date().getUTCFullYear()");
    expect(source).not.toContain("mappingYears");
    expect(source).not.toContain('sourceKey.split(":")[1]');
    // De waarschuwing over een lege kalender telt alleen wat deze ronde zou
    // importeren: de pagina staat vol events die 3SM bewust niet volgt, en die
    // mogen het signaal niet muisstil maken.
    expect(source).toContain("const upcomingImportable = countAdmittedUpcomingEvents(");
    expect(source).toContain("upcomingEvents === 0 && upcomingImportable === 0");
  });

  it("beschermt een gekoppelde catalogusrij tegen stil overschrijven bij een seizoenswissel", () => {
    // De eventsleutel bevat week en circuit, niet het seizoen. Zonder deze controle
    // zou een nieuwe race de rij van een bestaande 3SM-inschrijving overschrijven.
    expect(source).toContain('eq("iracing_catalog_event_id", existing.id)');
    expect(source).toContain("seizoenswissel niet doorgevoerd");
    // Een bewust overgeslagen rij mag de run niet als mislukt laten eindigen.
    expect(source).toContain("warnings.push(");
    expect(source).toContain("rij is gekoppeld aan 3SM-event");
  });

  it("laat serie-buckets niet als losse actieve kaart verschijnen naast hun week-rijen", () => {
    // De special-events-loop mag geen `kind === "series"`-entry importeren: de
    // series-loop maakt al de week-rijen (niet-combined) of één combined-event.
    // Anders verschijnt de bucket als nog een losse kaart naast zijn eigen weeks
    // (de "duplicate events"-klacht).
    expect(source).toContain('if (entry.kind === "series") continue;');
  });
});
