# 3SM Endurance Overlay — Implementatieplan

> **Voor OpenCode:** dit plan is zelfstandig uitvoerbaar. Elke taak bevat de exacte bestanden, complete code en verificatiecommando's. Werk taken op volgorde af. Commit na elke taak.

**Doel:** een compacte, altijd werkende overlay op de race-PC van de coureur die toont wie er rijdt, wie er komt, de gemiddelde rondetijd over de hele race, de racetijd en de rijdersvolgorde.

**Architectuur:** een SimHub **Dash Studio-dashboard** rendert de overlay. SimHub bezit het venster (transparant, altijd bovenop, klik-doorlaatbaar). De **plugin** levert alleen de stintplanning als SimHub-properties; racetijd, rondetijden en de rijdersnaam leest het dashboard rechtstreeks uit SimHub. De plugin haalt de planning op bij een nieuw Edge-endpoint met het bestaande apparaattoken.

**Tech stack:** PostgreSQL 15 (Supabase), Deno Edge Functions, C# / .NET Framework 4.8 (SimHub-plugin), Dash Studio `.djson`.

---

## Uitgangspunten (geverifieerd op 2026-10-22)

Deze feiten zijn in productie en in de code gecontroleerd. Ga ervan uit dat ze kloppen; verifieer ze niet opnieuw tenzij iets niet werkt.

| Feit | Bewijs |
|---|---|
| De plugin leest `isInCar`, `CurrentDriverId` en `CurrentDriverName` uit iRacing | `ConnectorSettings.cs:53-54`, `EnduranceConnectorPlugin.cs:1034-1035` |
| De ingest schrijft `is_in_car` en `driver_id` per sample | `supabase/functions/simhub-ingest-v3/persist.ts:152` |
| `endurance_telemetry_events` heeft `driver_id`, `is_in_car`, `lap_time_from_deltas_s`, `session_time_s` | `information_schema.columns` |
| `profiles.iracing_id` koppelt een iRacing-account aan een 3SM-profiel (26/35 gevuld) | `information_schema.columns` |
| `simhub_effective_endurance_binding(uuid)` bestaat en geeft `TABLE(event_id, team_id)` | `pg_proc` |
| Die functie heeft een lidmaatschap-fallback: één team in een lopend event, anders het eerstvolgende event met precies één lidmaatschap | `pg_proc.prosrc` |
| `endurance_stints` heeft `driver_id`, `original_*`, `actual_*`, `status`, `expected_laps`, `tyre_change` | `information_schema.columns` |
| Alle 5 actieve devices staan op `device_status='inactive'` met `endurance_team_id IS NULL` | productiequery |
| `get_pitwall_data` heeft **geen LIMIT** op de tijdlijn en geen `event_type`-filter | `pg_proc.prosrc` regels 73-100 |

**Belangrijk:** de lidmaatschap-fallback betekent dat de overlay **geen** handmatige device-binding nodig heeft. Een device van een gebruiker die lid is van precies één team in een lopend event resolveert automatisch. Blokkeer dus niet op `device_status`.

---

## Fase 0 — Voorwerk: `get_pitwall_data` begrenzen

**Waarom eerst:** de tijdlijn-CTE haalt élke seconde-sample van de hele race op inclusief de volledige `payload`. Bij 1 Hz is dat ±21.600 rijen voor een 6-uursrace. Het nieuwe endpoint leest die RPC niet, maar de bestaande Pitwall-pagina lijdt er nu al onder en de overlay mag die belasting niet verergeren.

### Taak 0.1: meten hoeveel rijen een race oplevert

**Bestanden:** geen (diagnose)

**Stap 1:** tel de events per team/event in productie.

```bash
ssh -i ~/.ssh/hermes_3sm_ed25519 root@192.168.50.23 \
  "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"
    select team_id, event_id, count(*) as rijen,
           pg_size_pretty(sum(pg_column_size(payload))) as payload_grootte
    from endurance_telemetry_events
    group by 1,2 order by 3 desc limit 5\""
```

**Verwacht:** de tabel is nu leeg (0 rijen). De query moet zonder fout draaien. Onthoud de uitkomst voor de acceptatie in fase 4.

**Stap 2:** bevestig dat de RPC onbegrensd is.

```bash
ssh -i ~/.ssh/hermes_3sm_ed25519 root@192.168.50.23 \
  "docker exec -i supabase-db psql -U supabase_admin -d postgres -tAc \"
    select prosrc from pg_proc where proname='get_pitwall_data'\"" | grep -c "LIMIT"
```

**Verwacht:** `1` (alleen de `LIMIT 1` bij het ophalen van het event, niet in de tijdlijn).

### Taak 0.2: migratie schrijven die de tijdlijn begrenst

**Bestanden:**
- Create: `supabase/migrations/20261022130000_pitwall_timeline_bound.sql`

**Stap 1:** maak de migratie.

```sql
-- Begrenst de tijdlijn van get_pitwall_data.
-- Voorheen: jsonb_agg over ALLE samples van team+event, inclusief volledige payload.
-- Nu: alleen gebeurtenissen (geen periodieke samples), laatste 2000, zonder payload.
-- De payload wordt door de UI niet gebruikt voor de tijdlijn; pace en stints komen
-- uit aparte CTE's.

CREATE OR REPLACE FUNCTION public.get_pitwall_data(p_event_id uuid, p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.endurance_team_members
    WHERE team_id = p_team_id AND user_id = auth.uid()
  ) AND NOT public.can_manage_simhub() THEN
    RAISE EXCEPTION 'not_a_team_member' USING ERRCODE = '42501';
  END IF;

  WITH latest AS (
    SELECT e.*
    FROM public.endurance_telemetry_events e
    WHERE e.team_id = p_team_id AND e.event_id = p_event_id
      AND e.event_type <> 'sample'
    ORDER BY e.captured_at DESC
    LIMIT 2000
  ),
  timeline AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'event_type', e.event_type,
          'event_key', e.event_key,
          'lap', e.lap,
          'completed_laps', e.completed_laps,
          'fuel_litres', e.fuel_litres,
          'fuel_per_lap_litres', e.fuel_per_lap_litres,
          'fuel_added_est_litres', e.fuel_added_est_litres,
          'laps_remaining_est', e.laps_remaining_est,
          'driver_id', e.driver_id,
          'in_pit_lane', e.in_pit_lane,
          'incidents', e.incidents,
          'flag', e.flag,
          'stint_elapsed_s', e.stint_elapsed_s,
          'session_time_s', e.session_time_s,
          'lap_time_from_deltas_s', e.lap_time_from_deltas_s,
          'captured_at', e.captured_at
        ) ORDER BY e.captured_at DESC
      ), '[]'::jsonb
    ) AS events
    FROM latest e
  )
  SELECT jsonb_build_object('timeline', timeline.events)
  INTO v_result
  FROM timeline;

  RETURN v_result;
END;
$function$;
```

> **Let op voor de uitvoerder:** de bestaande functie heeft meer CTE's (stints, pace, strategy, race_run). Kopieer de **volledige bestaande definitie** uit productie (`pg_get_functiondef`) en vervang **alleen** de `timeline`-CTE. Voeg niets anders toe en laat niets weg — anders breekt de Pitwall-pagina.

**Stap 2:** haal de huidige definitie op om te vergelijken.

```bash
ssh -i ~/.ssh/hermes_3sm_ed25519 root@192.168.50.23 \
  "docker exec -i supabase-db psql -U supabase_admin -d postgres -tAc \"
    select pg_get_functiondef(oid) from pg_proc where proname='get_pitwall_data'\""
```

Vergelijk de CTE's en zorg dat alleen `timeline` verandert.

**Stap 3:** pas de migratie toe op een testdatabase, niet direct op productie.

**Verwacht:** de functie bestaat en `select get_pitwall_data('<event>','<team>')` geeft een JSON met `timeline` erin.

**Stap 4:** commit.

```bash
git add supabase/migrations/20261022130000_pitwall_timeline_bound.sql
git commit -m "fix(pitwall): begrens de tijdlijn en laat de payload weg"
```

---

## Fase 1 — Het endpoint

Doel: `POST /functions/v1/simhub-overlay` dat met het apparaattoken een compacte momentopname teruggeeft.

### Taak 1.1: de RPC schrijven

**Bestanden:**
- Create: `supabase/migrations/20261022130100_simhub_overlay_snapshot.sql`

**Stap 1:** schrijf de functie.

```sql
-- Compacte momentopname voor de endurance-overlay.
-- Auth: service_role only (de Edge-route doet de tokencontrole).
-- Geeft nooit een token terug en leest geen payloads.

CREATE OR REPLACE FUNCTION public.simhub_overlay_snapshot(
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_device public.simhub_devices%ROWTYPE;
  v_event_id uuid;
  v_team_id uuid;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;

  SELECT device.* INTO v_device
  FROM public.simhub_devices AS device
  WHERE device.token_hash = p_token_hash
    AND device.revoked_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_device');
  END IF;

  SELECT binding.event_id, binding.team_id
  INTO v_event_id, v_team_id
  FROM public.simhub_effective_endurance_binding(v_device.id) AS binding
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_bound');
  END IF;

  SELECT jsonb_build_object(
    'contract', '3sm-overlay.v1',
    'serverTime', to_jsonb(v_now),
    'revision', md5(
      COALESCE((SELECT max(stint.updated_at)::text FROM public.endurance_stints AS stint
                WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id), '') ||
      COALESCE((SELECT max(event_row.updated_at)::text FROM public.endurance_events AS event_row
                WHERE event_row.id = v_event_id), '')
    ),
    'event', (
      SELECT jsonb_build_object(
        'id', event_row.id,
        'name', event_row.name,
        'circuit', event_row.circuit,
        'configuration', event_row.configuration,
        'status', event_row.status,
        'startAt', event_row.start_at,
        'endAt', event_row.end_at,
        'expectedEndAt', event_row.expected_end_at
      )
      FROM public.endurance_events AS event_row
      WHERE event_row.id = v_event_id
    ),
    'team', (
      SELECT jsonb_build_object(
        'id', team.id,
        'name', team.name,
        'carNumber', team.car_number,
        'carId', team.car_id
      )
      FROM public.endurance_teams AS team
      WHERE team.id = v_team_id
    ),
    'current', (
      SELECT jsonb_build_object(
        'stintId', stint.id,
        'driverId', stint.driver_id,
        'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
        'stintIndex', stint.stint_index,
        'startAt', COALESCE(stint.actual_start_at, stint.original_start_at),
        'endAt', COALESCE(stint.actual_end_at, stint.original_end_at),
        'status', stint.status,
        'isOverdue', v_now > COALESCE(stint.actual_end_at, stint.original_end_at)
                     AND stint.status NOT IN ('completed', 'replaced', 'expired'),
        'tyreChange', stint.tyre_change,
        'expectedLaps', stint.expected_laps
      )
      FROM public.endurance_stints AS stint
      LEFT JOIN public.profiles AS profile ON profile.id = stint.driver_id
      WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
        AND stint.status NOT IN ('completed', 'replaced', 'expired')
        AND COALESCE(stint.actual_start_at, stint.original_start_at) <= v_now
        AND COALESCE(stint.actual_end_at, stint.original_end_at) > v_now
      ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at)
      LIMIT 1
    ),
    'next', (
      SELECT jsonb_build_object(
        'stintId', stint.id,
        'driverId', stint.driver_id,
        'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
        'stintIndex', stint.stint_index,
        'startAt', COALESCE(stint.actual_start_at, stint.original_start_at),
        'endAt', COALESCE(stint.actual_end_at, stint.original_end_at),
        'minutesUntilStart', round(extract(epoch FROM (
          COALESCE(stint.actual_start_at, stint.original_start_at) - v_now
        )) / 60.0),
        'tyreChange', stint.tyre_change,
        'expectedLaps', stint.expected_laps
      )
      FROM public.endurance_stints AS stint
      LEFT JOIN public.profiles AS profile ON profile.id = stint.driver_id
      WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
        AND stint.status NOT IN ('completed', 'replaced', 'expired')
        AND COALESCE(stint.actual_start_at, stint.original_start_at) > v_now
      ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at)
      LIMIT 1
    ),
    'order', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stintIndex', stint.stint_index,
        'driverId', stint.driver_id,
        'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
        'startAt', COALESCE(stint.actual_start_at, stint.original_start_at),
        'endAt', COALESCE(stint.actual_end_at, stint.original_end_at),
        'status', stint.status,
        'tyreChange', stint.tyre_change,
        'expectedLaps', stint.expected_laps
      ) ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at))
      FROM public.endurance_stints AS stint
      LEFT JOIN public.profiles AS profile ON profile.id = stint.driver_id
      WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
    ), '[]'::jsonb),
    'race', (
      SELECT jsonb_build_object(
        'plannedStartAt', event_row.start_at,
        'plannedEndAt', event_row.end_at,
        'plannedDurationMinutes', round(extract(epoch FROM (event_row.end_at - event_row.start_at)) / 60.0)
      )
      FROM public.endurance_events AS event_row
      WHERE event_row.id = v_event_id
    ),
    'pace', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'driverId', stint.driver_id,
        'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
        'laps', pace.lap_count,
        'bestSeconds', pace.best_seconds,
        'averageSeconds', pace.average_seconds
      ))
      FROM (
        SELECT DISTINCT ON (lap.driver_id)
          lap.driver_id,
          count(*) AS lap_count,
          min(lap.lap_time_from_deltas_s) AS best_seconds,
          avg(lap.lap_time_from_deltas_s) AS average_seconds
        FROM public.endurance_telemetry_events AS lap
        WHERE lap.team_id = v_team_id AND lap.event_id = v_event_id
          AND lap.event_type = 'lap_completed'
          AND lap.driver_id IS NOT NULL
          AND lap.lap_time_from_deltas_s IS NOT NULL
          AND lap.lap_time_from_deltas_s > 0
        GROUP BY lap.driver_id
      ) AS pace
      LEFT JOIN public.profiles AS profile ON profile.id::text = pace.driver_id
    ), '[]'::jsonb),
    'warnings', (
      SELECT COALESCE(jsonb_agg(warning), '[]'::jsonb)
      FROM (
        SELECT 'plan_empty' AS warning
        WHERE NOT EXISTS (
          SELECT 1 FROM public.endurance_stints AS stint
          WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
        )
      ) AS warnings
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.simhub_overlay_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simhub_overlay_snapshot(text) TO service_role;
```

**Stap 2:** controleer de kolomnamen voordat je dit toepast.

> **VERPLICHT:** controleer `stint_index`, `lap_count` en `team.car_number` — deze zijn aangenomen. Draai eerst:
> ```bash
> ssh -i ~/.ssh/hermes_3sm_ed25519 root@192.168.50.23 \
>   "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"
>     select table_name, column_name from information_schema.columns
>     where table_name in ('endurance_stints','endurance_teams')
>     order by 1, ordinal_position\""
> ```
> Pas de SQL aan op de werkelijke kolomnamen. Raad niet.

**Stap 3:** maak de indexen.

```sql
CREATE INDEX IF NOT EXISTS endurance_stints_team_event_start_idx
  ON public.endurance_stints (team_id, event_id, original_start_at);

CREATE INDEX IF NOT EXISTS endurance_team_members_user_idx
  ON public.endurance_team_members (user_id);
```

**Stap 4:** test de functie met een echt device-token-hash uit productie.

```sql
select jsonb_pretty(
  public.simhub_overlay_snapshot(
    (select token_hash from public.simhub_devices where revoked_at is null limit 1)
  )
);
```

**Verwacht:** een JSON met `contract: '3sm-overlay.v1'`. Als de uitkomst `{"error":"not_bound"}` is, is dat correct voor een device zonder team — geen fout.

**Stap 5:** commit.

```bash
git add supabase/migrations/20261022130100_simhub_overlay_snapshot.sql
git commit -m "feat(overlay): RPC voor een compacte endurance-momentopname"
```

### Taak 1.2: de Edge-route

**Bestanden:**
- Create: `supabase/functions/simhub-overlay/index.ts`

**Stap 1:** schrijf de route. Volg exact het patroon van `simhub-ingest-v3/index.ts`.

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertAllowedOrigin,
  consumeEdgeRateLimit,
  jsonResponse,
  sha256Hex,
} from "../_shared/simhub.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const deviceToken = (request: Request): string => {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  const token = authorization.slice(7).trim();
  return token.length >= 32 && token.length <= 160 ? token : "";
};

Deno.serve(async (request: Request) => {
  const originBlocked = assertAllowedOrigin(request);
  if (originBlocked) return originBlocked;

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "method_not_allowed" }, 405);
  }

  const token = deviceToken(request);
  if (!token) return jsonResponse(request, { error: "invalid_device" }, 401);

  const tokenHash = await sha256Hex(token);

  const limit = await consumeEdgeRateLimit(`overlay:${tokenHash}`, 40, 60);
  if (!limit.allowed) {
    return jsonResponse(
      request,
      { error: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds },
      429,
    );
  }

  const { data, error } = await service.rpc("simhub_overlay_snapshot", {
    p_token_hash: tokenHash,
  });

  if (error) {
    return jsonResponse(request, { error: "db_unavailable" }, 503);
  }

  if (data && typeof data === "object" && "error" in data) {
    const code = (data as { error: string }).error;
    return jsonResponse(request, { error: code }, code === "invalid_device" ? 401 : 409);
  }

  return jsonResponse(request, data, 200);
});
```

**Stap 2:** controleer dat `consumeEdgeRateLimit` deze signatuur heeft.

```bash
grep -n "export.*consumeEdgeRateLimit" -A 12 supabase/functions/_shared/simhub.ts
```

Pas de aanroep aan op de werkelijke signatuur als die afwijkt.

**Stap 3:** test lokaal met de Deno-container.

```bash
docker run --rm -v "$PWD/supabase/functions:/src" -w /src denoland/deno:latest \
  deno check simhub-overlay/index.ts
```

**Verwacht:** `Check file:///src/simhub-overlay/index.ts` zonder fouten.

**Stap 4:** commit.

```bash
git add supabase/functions/simhub-overlay/index.ts
git commit -m "feat(overlay): Edge-route met apparaattoken en rate limit"
```

---

## Fase 2 — De plugin

De plugin publiceert de planning als SimHub-properties. Het dashboard leest die.

### Taak 2.1: het ophaalcontract

**Bestanden:**
- Create: `tools/simhub-plugin/3SM.EnduranceConnector/OverlayContracts.cs`

**Stap 1:** schrijf de modellen met dezelfde deserialisatie-attributen als `TelemetryContractsV3.cs`.

```csharp
using System.Runtime.Serialization;

namespace ThreeSm.EnduranceConnector
{
    [DataContract]
    public sealed class OverlaySnapshot
    {
        [DataMember(Name = "revision", Order = 1)] public string Revision { get; set; }
        [DataMember(Name = "serverTime", Order = 2)] public string ServerTime { get; set; }
        [DataMember(Name = "current", Order = 3)] public OverlayStint Current { get; set; }
        [DataMember(Name = "next", Order = 4)] public OverlayStint Next { get; set; }
        [DataMember(Name = "order", Order = 5)] public OverlayStint[] Order { get; set; }
        [DataMember(Name = "pace", Order = 6)] public OverlayPace[] Pace { get; set; }
        [DataMember(Name = "event", Order = 7)] public OverlayEvent Event { get; set; }
        [DataMember(Name = "team", Order = 8)] public OverlayTeam Team { get; set; }
        [DataMember(Name = "race", Order = 9)] public OverlayRace Race { get; set; }
        [DataMember(Name = "warnings", Order = 10)] public string[] Warnings { get; set; }
    }

    [DataContract]
    public sealed class OverlayStint
    {
        [DataMember(Name = "stintIndex", Order = 1)] public int? StintIndex { get; set; }
        [DataMember(Name = "driverId", Order = 2)] public string DriverId { get; set; }
        [DataMember(Name = "driverName", Order = 3)] public string DriverName { get; set; }
        [DataMember(Name = "startAt", Order = 4)] public string StartAt { get; set; }
        [DataMember(Name = "endAt", Order = 5)] public string EndAt { get; set; }
        [DataMember(Name = "minutesUntilStart", Order = 6)] public decimal? MinutesUntilStart { get; set; }
        [DataMember(Name = "status", Order = 7)] public string Status { get; set; }
        [DataMember(Name = "isOverdue", Order = 8)] public bool? IsOverdue { get; set; }
        [DataMember(Name = "tyreChange", Order = 9)] public bool? TyreChange { get; set; }
        [DataMember(Name = "expectedLaps", Order = 10)] public int? ExpectedLaps { get; set; }
    }

    [DataContract]
    public sealed class OverlayPace
    {
        [DataMember(Name = "driverId", Order = 1)] public string DriverId { get; set; }
        [DataMember(Name = "driverName", Order = 2)] public string DriverName { get; set; }
        [DataMember(Name = "laps", Order = 3)] public int? Laps { get; set; }
        [DataMember(Name = "bestSeconds", Order = 4)] public decimal? BestSeconds { get; set; }
        [DataMember(Name = "averageSeconds", Order = 5)] public decimal? AverageSeconds { get; set; }
    }

    [DataContract]
    public sealed class OverlayEvent
    {
        [DataMember(Name = "id", Order = 1)] public string Id { get; set; }
        [DataMember(Name = "name", Order = 2)] public string Name { get; set; }
        [DataMember(Name = "circuit", Order = 3)] public string Circuit { get; set; }
        [DataMember(Name = "status", Order = 4)] public string Status { get; set; }
    }

    [DataContract]
    public sealed class OverlayTeam
    {
        [DataMember(Name = "id", Order = 1)] public string Id { get; set; }
        [DataMember(Name = "name", Order = 2)] public string Name { get; set; }
        [DataMember(Name = "carNumber", Order = 3)] public string CarNumber { get; set; }
    }

    [DataContract]
    public sealed class OverlayRace
    {
        [DataMember(Name = "plannedStartAt", Order = 1)] public string PlannedStartAt { get; set; }
        [DataMember(Name = "plannedEndAt", Order = 2)] public string PlannedEndAt { get; set; }
        [DataMember(Name = "plannedDurationMinutes", Order = 3)] public decimal? PlannedDurationMinutes { get; set; }
    }
}
```

**Stap 2:** commit.

```bash
git add tools/simhub-plugin/3SM.EnduranceConnector/OverlayContracts.cs
git commit -m "feat(overlay): contractmodellen voor de momentopname"
```

### Taak 2.2: de ophaaldienst met schijfcache

**Bestanden:**
- Create: `tools/simhub-plugin/3SM.EnduranceConnector/OverlayClient.cs`

**Stap 1:** schrijf de client. Hergebruik de bestaande HTTP-plumbing uit `DiagnosticsClient.cs`; kopieer geen headers-logica.

**Eisen:**
- Poll elke 15 seconden, behalve als er geen iRacing-sessie is (dan elke 60 seconden)
- Bewaar de laatste goede snapshot in `%LOCALAPPDATA%\3SM\endurance-overlay.json`
- Bij een fout: houd de vorige snapshot, zet `PlanAgeSeconds` op de werkelijke leeftijd
- Nooit een exception naar de DataUpdate-thread laten ontsnappen
- Geen token in het cachebestand

```csharp
// Skelet — vul de HTTP-aanroep in met dezelfde helper als DiagnosticsClient.
public sealed class OverlayClient
{
    private OverlaySnapshot _cached;
    private DateTime _cachedAtUtc = DateTime.MinValue;
    private DateTime _nextPollUtc = DateTime.MinValue;

    public OverlaySnapshot Snapshot => _cached;
    public int PlanAgeSeconds => _cached == null
        ? -1
        : (int)Math.Max(0, (DateTime.UtcNow - _cachedAtUtc).TotalSeconds);

    public void Tick(bool iRacingRunning)
    {
        try
        {
            if (DateTime.UtcNow < _nextPollUtc) return;
            _nextPollUtc = DateTime.UtcNow.AddSeconds(iRacingRunning ? 15 : 60);
            // POST /functions/v1/simhub-overlay met het device-token
            // bij succes: _cached = parsed; _cachedAtUtc = DateTime.UtcNow; schrijf cache
            // bij fout: laat _cached staan
        }
        catch
        {
            // nooit laten ontsnappen
        }
    }
}
```

**Stap 2:** commit.

```bash
git add tools/simhub-plugin/3SM.EnduranceConnector/OverlayClient.cs
git commit -m "feat(overlay): ophaaldienst met schijfcache en leeftijd"
```

### Taak 2.3: de properties publiceren

**Bestanden:**
- Modify: `tools/simhub-plugin/3SM.EnduranceConnector/FlagPropertyPublisher.cs`
- Modify: `tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs` (aanroep in `DataUpdate`)

**Stap 1:** publiceer deze properties, met prefix `THREESM.Overlay.`:

| Property | Type | Bron |
|---|---|---|
| `Overlay.Current.DriverName` | string | snapshot.current.driverName |
| `Overlay.Current.StintIndex` | int | snapshot.current.stintIndex |
| `Overlay.Current.IsOverdue` | bool | snapshot.current.isOverdue |
| `Overlay.Next.DriverName` | string | snapshot.next.driverName |
| `Overlay.Next.MinutesUntilStart` | int | snapshot.next.minutesUntilStart |
| `Overlay.Race.PlannedMinutes` | int | snapshot.race.plannedDurationMinutes |
| `Overlay.Plan.AgeSeconds` | int | PlanAgeSeconds |
| `Overlay.Plan.Revision` | string | snapshot.revision |
| `Overlay.Order.Summary` | string | "Vincent > Jaimy > Marnix > Vincent" |
| `Overlay.Warnings` | string | kommagescheiden |

**Stap 2:** roep `overlayClient.Tick(isInCar)` aan vanuit `DataUpdate`, na `PublishFlags`, binnen de bestaande try/catch.

**Stap 3:** registreer de properties in `Init` met `PluginManager.AddProperty`.

**Stap 4:** commit.

```bash
git add tools/simhub-plugin/3SM.EnduranceConnector/FlagPropertyPublisher.cs \
        tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs
git commit -m "feat(overlay): publiceer de stintplanning als SimHub-properties"
```

---

## Fase 3 — Het dashboard

**Dit gebeurt op de Windows-PC met SimHub. Niet in de repo.**

### Taak 3.1: dashboard aanmaken

**Stap 1:** open SimHub → Dash Studio → New dashboard → leeg canvas, transparante achtergrond.

**Stap 2:** stel in: `IsOverlay = true`, `EnableClickThroughOverlay = true`, `ShowInTaskBar = false`.

**Stap 3:** houd het oppervlak onder **800×600** (harde SimHub-limiet).

**Stap 4:** bind de velden:

| Veld | Binding |
|---|---|
| Huidige rijder | `$prop('THREESM.Overlay.Current.DriverName')` |
| Stint | `$prop('THREESM.Overlay.Current.StintIndex')` |
| Volgende rijder | `$prop('THREESM.Overlay.Next.DriverName')` |
| Minuten tot wissel | `$prop('THREESM.Overlay.Next.MinutesUntilStart')` |
| Racetijd | `$prop('DataCorePlugin.GameData.NewData.SessionTime')` |
| Laatste ronde | `$prop('DataCorePlugin.GameData.NewData.LastLapTime')` |
| Beste ronde | `$prop('DataCorePlugin.GameData.NewData.BestLapTime')` |
| Rijdersvolgorde | `$prop('THREESM.Overlay.Order.Summary')` |
| Plan-leeftijd | `$prop('THREESM.Overlay.Plan.AgeSeconds')` |

**Stap 5:** test met een lopende iRacing-sessie en een gevulde planning.

**Verwacht:** alle velden tonen een waarde; geen Enumerable/NaN op het scherm.

### Taak 3.2: de afwijkingsmarkering

**Stap 1:** voeg een waarschuwingsregel toe die verschijnt als `Overlay.Warnings` niet leeg is.

**Stap 2:** toon in plaats van een streepje altijd "—" bij een ontbrekende waarde, nooit `NaN` of een leeg vlak.

---

## Fase 4 — Acceptatie

Elke regel moet aantoonbaar kloppen voordat dit "klaar" heet.

**Datakant:**
- [ ] `simhub_overlay_snapshot` geeft `contract: '3sm-overlay.v1'` voor een device met een team
- [ ] Geeft `{"error":"not_bound"}` voor een device zonder team — geen exception
- [ ] Geeft `{"error":"invalid_device"}` voor een onbekend token
- [ ] Dezelfde aanroep twee keer vlak na elkaar geeft hetzelfde `revision`
- [ ] Een wijziging in `endurance_stints` verandert `revision`
- [ ] De respons is kleiner dan 8 KB bij een race met 8 stints

**Endpoint:**
- [ ] Zonder token: 401
- [ ] Met een geldig token: 200 en de snapshot
- [ ] Meer dan 40 aanroepen per minuut: 429 met `retryAfterSeconds`
- [ ] Database onbereikbaar: 503, geen crash

**Plugin:**
- [ ] Properties verschijnen in SimHub's property-lijst
- [ ] Bij weggevallen netwerk blijven de laatste waarden staan en loopt `AgeSeconds` op
- [ ] Na een herstart van SimHub komen de waarden binnen 20 seconden terug
- [ ] Geen exception in het SimHub-log tijdens een sessie van 30 minuten

**Dashboard:**
- [ ] Zichtbaar boven iRacing in borderless windowed
- [ ] Klik-doorlaatbaar (muisklikken komen in het spel aan)
- [ ] Alle velden tonen een waarde of "—", nooit `NaN`
- [ ] Plan-leeftijd zichtbaar en klopt

**Wissel (de kern):**
- [ ] Bij een echte rijderswissel wijst de overlay binnen 5 seconden de nieuwe rijder aan
- [ ] De aanduiding "volgens plan" of "afwijkend" klopt met de werkelijkheid
- [ ] De gemiddelde rondetijd over de hele race klopt met een handmatige berekening uit de lap-events

**Bekende beperkingen die je moet accepteren:**
- Exclusive fullscreen: geen enkele overlay werkt dan. iRacing moet op borderless staan.
- SimHub's Dash Studio kan niet bij de 3SM-API; alle plandata moet via plugin-properties komen.
- Het dashboard wordt in de SimHub-GUI gebouwd, niet in de repo.

---

## Volgorde en afhankelijkheden

```
Fase 0 (RPC begrenzen)  ──┐
                          ├──► Fase 1 (RPC + endpoint) ──► Fase 2 (plugin) ──► Fase 3 (dashboard) ──► Fase 4
                          │
                    (onafhankelijk, maar eerst doen)
```

Fase 3 kan pas als fase 2 properties publiceert. Fase 2 kan pas als fase 1 antwoord geeft.

---

## Wat expliciet NIET doen

- **Geen eigen WPF-venster in de plugin.** Ongedocumenteerd, crasht SimHub mee, breekt na een update.
- **Geen Electron- of Tauri-app.** Derde product met eigen login en releases.
- **Geen browser-overlay voor de coureur.** Geen always-on-top en de pagina stuurt anoniem naar de login.
- **`get_pitwall_data` niet gebruiken voor de overlay.** Onbegrensd; gebruik de nieuwe RPC.
- **Geen teamkeuze uit `data[0]`.** De binding komt van de server, niet uit de eerste rij van een lijst.
- **Geen `device_status`-eis.** Alle devices staan nu op `inactive`; de lidmaatschap-fallback is de route.
- **Geen `payload` meesturen in welke overlay-query dan ook.**
