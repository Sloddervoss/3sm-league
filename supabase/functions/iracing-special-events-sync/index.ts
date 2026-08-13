import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createIRacingClient } from "../_shared/iracingClient.ts";
import { enrichSeedFromOfficialCalendar, normalizeSpecialEvent, type SpecialEventSeed } from "./normalize.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

type SeasonMapEntry = { seasonId: number; seriesId?: number; localClassIds: string[]; localCarMap?: Record<string, string>; seed: SpecialEventSeed };
type Counts = { events_seen: number; events_inserted: number; events_updated: number; slots_seen: number; slots_inserted: number; slots_updated: number };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const bearer = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
const cleanError = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
  .replace(/((?:cookie|password|token|authorization|code_verifier)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
  .replace(/([?&](?:token|key|code|password)=)[^&\s]+/gi, "$1[REDACTED]")
  .replace(/[A-Za-z0-9_-]{32,}/g, "[REDACTED]")
  .slice(0, 500);

const parseSeasonMap = (): SeasonMapEntry[] => {
  const raw = Deno.env.get("ENDURANCE_IRACING_SEASON_MAP_JSON") ?? "";
  if (!raw) throw new Error("ENDURANCE_IRACING_SEASON_MAP_JSON ontbreekt");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("ENDURANCE_IRACING_SEASON_MAP_JSON moet een array zijn");
  return parsed.map((entry) => {
    const value = entry as Partial<SeasonMapEntry>;
    if (!Number.isInteger(value.seasonId) || !Array.isArray(value.localClassIds) || !value.localClassIds.every((id) => typeof id === "string")
      || (value.localCarMap !== undefined && (typeof value.localCarMap !== "object" || Array.isArray(value.localCarMap)
        || !Object.entries(value.localCarMap).every(([sourceKey, localId]) => sourceKey.trim() && typeof localId === "string" && localId.trim())))
      || !value.seed?.sourceKey || !value.seed?.name) {
      throw new Error("Ongeldige seasonmapping");
    }
    return value as SeasonMapEntry;
  });
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const syncToken = Deno.env.get("ENDURANCE_IRACING_SYNC_TOKEN") ?? "";
  if (!supabaseUrl || !serviceKey || !anonKey || !syncToken) return json({ error: "server_configuration_missing" }, 503);

  const token = bearer(request);
  const scheduled = token.length >= 32 && token === syncToken;
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  if (!scheduled) {
    if (!token) return json({ error: "unauthorized" }, 401);
    const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "unauthorized" }, 401);
    const { data: roles, error: roleError } = await service.from("user_roles").select("role").eq("user_id", userData.user.id);
    if (roleError || !(roles ?? []).some((row: { role: string }) => row.role === "super_admin")) {
      return json({ error: "forbidden" }, 403);
    }
  }

  // Sluit een verlopen lease af. De partial unique index op status='running'
  // maakt de daaropvolgende insert atomair bij gelijktijdige requests.
  const leaseCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  await service.from("endurance_iracing_sync_runs").update({
    status: "failed", finished_at: new Date().toISOString(), error_summary: "sync_lease_expired",
  }).eq("status", "running").lt("started_at", leaseCutoff);

  const { data: run, error: runError } = await service.from("endurance_iracing_sync_runs")
    .insert({ status: "running" }).select("id").single();
  if (runError?.code === "23505") return json({ error: "sync_already_running" }, 409);
  if (runError || !run) return json({ error: "sync_run_start_failed" }, 500);

  const counts: Counts = { events_seen: 0, events_inserted: 0, events_updated: 0, slots_seen: 0, slots_inserted: 0, slots_updated: 0 };
  const errors: string[] = [];
  try {
    const mapping = parseSeasonMap();
    let calendarHtml = "";
    let calendarModifiedAt: string | null = null;
    try {
      const calendarResponse = await fetch("https://www.iracing.com/wp-json/wp/v2/pages/263677", {
        headers: { Accept: "application/json", "User-Agent": "3SM Endurance Sync/1.0" },
      });
      if (!calendarResponse.ok) throw new Error(`HTTP ${calendarResponse.status}`);
      const calendar = await calendarResponse.json();
      calendarHtml = String(calendar?.content?.rendered ?? "");
      calendarModifiedAt = calendar?.modified_gmt ? `${calendar.modified_gmt}Z` : null;
      if (!calendarHtml) throw new Error("lege officiële kalender");
    } catch (error) {
      errors.push(`official_calendar: ${cleanError(error)}`);
    }
    const client = await createIRacingClient();
    for (const entry of mapping) {
      try {
        const officialSeed = calendarHtml ? enrichSeedFromOfficialCalendar(entry.seed, calendarHtml) : entry.seed;
        const schedule = await client.fetchData(`/data/series/season_schedule?season_id=${entry.seasonId}`);
        const normalized = await normalizeSpecialEvent(officialSeed, schedule as never);
        const localCarMap = entry.localCarMap ?? {};
        const cars = normalized.cars.map((car) => ({ ...car, localCarId: localCarMap[car.sourceKey] ?? null }));
        const localCarIds = [...new Set(cars.flatMap((car) => car.localCarId ? [car.localCarId] : []))];
        counts.events_seen += 1;
        counts.slots_seen += normalized.slots.length;

        const { data: existing, error: existingError } = await service.from("endurance_iracing_events")
          .select("id,source_hash,source_payload").eq("source_key", normalized.sourceKey).maybeSingle();
        if (existingError) throw existingError;
        const eventPayload = {
          source_key: normalized.sourceKey,
          iracing_series_id: entry.seriesId ?? null,
          iracing_season_id: entry.seasonId,
          name: normalized.name,
          year: normalized.year,
          circuit: normalized.circuit,
          configuration: normalized.configuration,
          track_id: normalized.trackId,
          event_start_date: normalized.dateStart,
          event_end_date: normalized.dateEnd,
          duration_minutes: normalized.durationMinutes,
          class_ids: normalized.classIds,
          local_class_ids: entry.localClassIds,
          local_car_ids: localCarIds,
          cars,
          team_event: normalized.teamEvent,
          official_url: normalized.officialUrl,
          poster_url: normalized.posterUrl,
          source_payload: calendarHtml ? {
            provenance: "official iRacing Special Events page + authenticated Data API",
            calendar_page_id: 263677,
            calendar_modified_at: calendarModifiedAt,
            season_id: entry.seasonId,
          } : existing?.source_payload ?? {
            provenance: "authenticated iRacing Data API; calendar verification pending",
            season_id: entry.seasonId,
          },
          source_hash: normalized.sourceHash,
          availability_status: normalized.availabilityStatus,
          active: true,
          last_seen_at: new Date().toISOString(),
          source_updated_at: new Date().toISOString(),
        };
        const { data: event, error: eventError } = await service.from("endurance_iracing_events")
          .upsert(eventPayload, { onConflict: "source_key" }).select("id").single();
        if (eventError || !event) throw eventError ?? new Error("Event-upsert gaf geen id");
        if (!existing) counts.events_inserted += 1;
        else if (existing.source_hash !== normalized.sourceHash) counts.events_updated += 1;

        for (const slot of normalized.slots) {
          const { data: previous, error: previousError } = await service.from("endurance_iracing_event_slots")
            .select("id,session_start_at,estimated_race_start_at").eq("catalog_event_id", event.id)
            .eq("source_slot_key", slot.sourceSlotKey).maybeSingle();
          if (previousError) throw previousError;
          const slotPayload = {
            catalog_event_id: event.id,
            source_slot_key: slot.sourceSlotKey,
            session_start_at: slot.sessionStartAt,
            practice_start_at: slot.practiceStartAt,
            practice_duration_minutes: slot.practiceDurationMinutes,
            qualifying_start_at: slot.qualifyingStartAt,
            qualifying_duration_minutes: slot.qualifyingDurationMinutes,
            transition_duration_minutes: slot.transitionDurationMinutes,
            estimated_race_start_at: slot.estimatedRaceStartAt,
            race_duration_minutes: slot.raceDurationMinutes,
            race_lap_limit: slot.raceLapLimit,
            session_duration_minutes: slot.sessionDurationMinutes,
            session_timing_status: slot.sessionTimingStatus,
            label: slot.label,
            source: slot.source,
            active: true,
            missing_successful_syncs: 0,
            last_seen_at: new Date().toISOString(),
          };
          const { error: slotError } = await service.from("endurance_iracing_event_slots")
            .upsert(slotPayload, { onConflict: "catalog_event_id,source_slot_key" });
          if (slotError) throw slotError;
          if (!previous) counts.slots_inserted += 1;
          else if (previous.session_start_at !== slot.sessionStartAt || previous.estimated_race_start_at !== slot.estimatedRaceStartAt) counts.slots_updated += 1;
        }
        if (calendarHtml && normalized.availabilityStatus === "exact_slots" && normalized.slots.length > 0) {
          const currentKeys = normalized.slots.map((slot) => slot.sourceSlotKey);
          const { data: candidates, error: candidatesError } = await service.from("endurance_iracing_event_slots")
            .select("id,source_slot_key,missing_successful_syncs").eq("catalog_event_id", event.id).eq("active", true);
          if (candidatesError) throw candidatesError;
          for (const candidate of candidates ?? []) {
            if (currentKeys.includes(candidate.source_slot_key)) continue;
            const { data: linked, error: linkedError } = await service.from("endurance_events")
              .select("id").eq("iracing_catalog_slot_id", candidate.id).limit(1);
            if (linkedError) throw linkedError;
            if ((linked ?? []).length) continue;
            const misses = Number(candidate.missing_successful_syncs ?? 0) + 1;
            const { error: staleError } = await service.from("endurance_iracing_event_slots")
              .update({ missing_successful_syncs: misses, active: misses < 2 }).eq("id", candidate.id);
            if (staleError) throw staleError;
          }
        }
        // Deze teller wordt pas na een volledig geslaagde event+slotronde aangepast.
        // Partial failures verwijderen of deactiveren dus nooit oude goede slots.
      } catch (error) {
        errors.push(`${entry.seed.sourceKey}: ${cleanError(error)}`);
      }
    }
    const status = errors.length === 0 ? "success" : counts.events_seen > 0 ? "partial" : "failed";
    const finishedAt = new Date().toISOString();
    await service.from("endurance_iracing_sync_runs").update({
      status,
      finished_at: finishedAt,
      ...counts,
      error_summary: errors.length ? errors.join(" | ").slice(0, 1000) : null,
      source_modified_at: calendarModifiedAt,
    }).eq("id", run.id);
    return json({ status, ...counts, finished_at: finishedAt }, status === "failed" ? 502 : 200);
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await service.from("endurance_iracing_sync_runs").update({
      status: "failed", finished_at: finishedAt, ...counts, error_summary: cleanError(error),
    }).eq("id", run.id);
    return json({ status: "failed", ...counts, finished_at: finishedAt }, 502);
  }
});
