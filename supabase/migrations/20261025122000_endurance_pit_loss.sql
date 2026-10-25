-- 2026-10-25: pitverlies meten (punt 9 van "na de race").
--
-- pitLaneSeconds werd nooit gemeten, dus stond pitLoss in de pitwall op null.
-- Er is geen pit-event met een duur; er zijn alleen waarnemingen met een
-- in_pit_lane-vlag. Deze migratie leidt daar de stops uit af: een overgang
-- false -> true is pit-in, true -> false is pit-uit, en het verschil in
-- captured_at is de tijd in de pitlane.
--
-- Wat hier bewust NIET gebeurt:
--   * Geen schatting als de vlag ontbreekt. De race van 24-10 had 17 stops
--     (lap-samples met exclusion_reason 'pit_lane_during_lap') maar 0 van de
--     260 telemetrie-events had in_pit_lane gevuld. Voor die race levert deze
--     migratie dus nul stops en blijft pitLaneSeconds null. Dat is het juiste
--     antwoord, niet een fout.
--   * Geen pit-in zonder voorafgaande false-waarneming (baseline). Een stay die
--     al in de pit begint is niet te meten; die laten we vallen.
--   * Geen stop die bij het einde van de data nog open is: entry wordt
--     vastgelegd, pit_lane_seconds blijft null.
--   * Geen gemiddelde over meerdere pc's van hetzelfde team: één bron per team
--     (de bron met de meeste bruikbare stops), anders telt dezelfde stop dubbel.
--
-- De meting landt in endurance_pit_stops (vastgelegd), de pitwall leest hem via
-- pitwall_pit_loss_v1() uit get_pitwall_data. De mediaan gaat naar buiten; één
-- uitschieter (lange reparatie) verschuift het getal dan niet.

-- ---------------------------------------------------------------------------
-- 1. Vastlegging
-- ---------------------------------------------------------------------------

create table if not exists public.endurance_pit_stops (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.endurance_events(id) on delete cascade,
  team_id uuid not null references public.endurance_teams(id) on delete cascade,
  race_run_id uuid references public.endurance_race_runs(id) on delete set null,
  device_id uuid not null references public.simhub_devices(id) on delete cascade,
  session_id text not null,
  -- Herkomst van de meting. Alleen 'in_pit_lane_edges' bestaat; een andere
  -- waarde betekent dat iemand iets anders is gaan schatten en dat mag niet
  -- stilzwijgend als meting doorgaan.
  source text not null default 'in_pit_lane_edges',
  pit_entry_at timestamptz not null,
  pit_exit_at timestamptz,
  pit_lane_seconds numeric,
  laps_in_pit integer,
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint endurance_pit_stops_unique unique (device_id, session_id, pit_entry_at),
  constraint endurance_pit_stops_source_check check (source = 'in_pit_lane_edges'),
  constraint endurance_pit_stops_duration_check check (pit_lane_seconds is null or pit_lane_seconds > 0),
  constraint endurance_pit_stops_exit_check check (pit_exit_at is null or pit_exit_at > pit_entry_at)
);

comment on table public.endurance_pit_stops is
  'Gemeten pitstops per team, afgeleid uit in_pit_lane-overgangen in endurance_telemetry_events. pit_lane_seconds is null zolang de pit-uit ontbreekt.';
comment on column public.endurance_pit_stops.pit_lane_seconds is
  'Werkelijk gemeten tijd tussen pit-in en pit-uit in seconden. Geen schatting, geen vaste waarde.';

create index if not exists endurance_pit_stops_team_idx
  on public.endurance_pit_stops (event_id, team_id, pit_entry_at desc);

-- Alleen service_role leest of schrijft deze tabel; de pitwall komt er via
-- get_pitwall_data (SECURITY DEFINER) bij, net als bij de lap-samples.
alter table public.endurance_pit_stops enable row level security;

drop policy if exists endurance_pit_stops_service_role_all on public.endurance_pit_stops;
create policy endurance_pit_stops_service_role_all
  on public.endurance_pit_stops
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.endurance_pit_stops from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Afleiden uit de vlaggen
-- ---------------------------------------------------------------------------

create or replace function public.derive_pit_stops(p_event_id uuid)
returns table (
  o_team_id uuid,
  o_device_id uuid,
  o_session_id text,
  o_race_run_id uuid,
  o_pit_entry_at timestamptz,
  o_pit_exit_at timestamptz,
  o_pit_lane_seconds numeric,
  o_laps_in_pit integer
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  with flagged as (
    select e.team_id,
           e.device_id,
           e.session_id,
           e.race_run_id,
           e.captured_at,
           e.sequence,
           e.in_pit_lane,
           e.completed_laps,
           lag(e.in_pit_lane) over (
             partition by e.team_id, e.device_id, e.session_id
             order by e.captured_at, e.sequence
           ) as vorige_vlag
      from public.endurance_telemetry_events e
     where e.event_id = p_event_id
       and e.team_id is not null
       and e.device_id is not null
       and e.session_id is not null
       and e.in_pit_lane is not null
  ),
  edges as (
    select f.*,
           case when f.in_pit_lane and f.vorige_vlag is false then 1 else 0 end as is_entry,
           case when not f.in_pit_lane and f.vorige_vlag then 1 else 0 end as is_exit
      from flagged f
  ),
  genummerd as (
    select g.*,
           sum(g.is_entry) over (
             partition by g.team_id, g.device_id, g.session_id
             order by g.captured_at, g.sequence
             rows between unbounded preceding and current row
           ) as stop_nr
      from edges g
  ),
  per_stop as (
    select n.team_id,
           n.device_id,
           n.session_id,
           n.stop_nr,
           min(n.captured_at) filter (where n.is_entry = 1) as entry_at,
           min(n.captured_at) filter (where n.is_exit = 1) as exit_at,
           (array_agg(n.race_run_id) filter (where n.race_run_id is not null))[1] as race_run_id,
           max(n.completed_laps) - min(n.completed_laps) as laps_in_pit
      from genummerd n
     where n.stop_nr > 0
     group by n.team_id, n.device_id, n.session_id, n.stop_nr
  )
  select s.team_id,
         s.device_id,
         s.session_id,
         s.race_run_id,
         s.entry_at,
         s.exit_at,
         case
           when s.entry_at is not null and s.exit_at is not null
             then round(extract(epoch from (s.exit_at - s.entry_at))::numeric, 3)
         end,
         case when s.laps_in_pit is not null and s.laps_in_pit > 0 then s.laps_in_pit end
    from per_stop s
   where s.entry_at is not null;
$function$;

comment on function public.derive_pit_stops(uuid) is
  'Pit-in/pit-uit per team uit in_pit_lane-overgangen. Stops zonder exit (of zonder voorafgaande false) leveren geen duur.';

revoke all on function public.derive_pit_stops(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Vastleggen (idempotent: per event opnieuw opgebouwd uit de events)
-- ---------------------------------------------------------------------------

create or replace function public.refresh_endurance_pit_stops(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_aantal integer := 0;
begin
  -- De tabel is een afgeleide momentopname, geen geschiedenis: een stay die
  -- later alsnog een exit krijgt moet niet als losse rij blijven staan.
  delete from public.endurance_pit_stops where event_id = p_event_id;

  insert into public.endurance_pit_stops
    (event_id, team_id, device_id, session_id, race_run_id,
     pit_entry_at, pit_exit_at, pit_lane_seconds, laps_in_pit)
  select p_event_id,
         d.o_team_id,
         d.o_device_id,
         d.o_session_id,
         d.o_race_run_id,
         d.o_pit_entry_at,
         d.o_pit_exit_at,
         d.o_pit_lane_seconds,
         d.o_laps_in_pit
    from public.derive_pit_stops(p_event_id) d;

  get diagnostics v_aantal = row_count;
  return v_aantal;
end;
$function$;

comment on function public.refresh_endurance_pit_stops(uuid) is
  'Bouwt endurance_pit_stops voor één event opnieuw op uit de telemetrie-events.';

revoke all on function public.refresh_endurance_pit_stops(uuid) from public, anon, authenticated;

-- Draait elke minuut voor events die lopen of net afgelopen zijn. Buiten het
-- ingest-pad, zodat een sample niet op een volledige herberekening wacht.
create or replace function public.refresh_endurance_pit_stops_live()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_event record;
  v_events integer := 0;
begin
  for v_event in
    select e.id
      from public.endurance_events e
     where e.status = 'live'
        or (
          e.end_at is not null
          and now() between coalesce(e.start_at, e.end_at) - interval '30 minutes'
                        and e.end_at + interval '2 hours'
        )
  loop
    perform public.refresh_endurance_pit_stops(v_event.id);
    v_events := v_events + 1;
  end loop;

  return v_events;
end;
$function$;

revoke all on function public.refresh_endurance_pit_stops_live() from public, anon, authenticated;

select cron.unschedule('endurance-pit-stops')
 where exists (select 1 from cron.job where jobname = 'endurance-pit-stops');

select cron.schedule('endurance-pit-stops', '* * * * *', $cron$select public.refresh_endurance_pit_stops_live()$cron$);

-- Terugvullen of opnieuw meten van één race (handmatig, buiten de cron):
--   select public.refresh_endurance_pit_stops('<event_id>'::uuid);
-- Voor de race van 24-10 levert dat 0 stops op: in_pit_lane is daar nooit gevuld.

-- ---------------------------------------------------------------------------
-- 4. Wat de pitwall leest
-- ---------------------------------------------------------------------------

create or replace function public.pitwall_pit_loss_v1(p_event_id uuid, p_team_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  with per_bron as (
    select s.device_id,
           s.session_id,
           count(*) as stops,
           count(*) filter (
             where s.pit_lane_seconds is not null
               and s.pit_lane_seconds between 5 and 900
           ) as bruikbaar,
           max(s.pit_entry_at) as laatste
      from public.endurance_pit_stops s
     where s.event_id = p_event_id
       and s.team_id = p_team_id
     group by s.device_id, s.session_id
  ),
  bron as (
    select b.device_id, b.session_id
      from per_bron b
     order by b.bruikbaar desc, b.stops desc, b.laatste desc
     limit 1
  ),
  metingen as (
    select s.pit_lane_seconds,
           s.pit_exit_at
      from public.endurance_pit_stops s
      join bron b
        on b.device_id = s.device_id
       and b.session_id = s.session_id
     where s.event_id = p_event_id
       and s.team_id = p_team_id
       -- Onder de 5 s is geen pitstraat maar een flikkering; boven de 900 s is
       -- het een onderbreking (rode vlag, sessiewissel), geen stop.
       and s.pit_lane_seconds between 5 and 900
  )
  select jsonb_build_object(
    'pitLaneSeconds', (select round((percentile_cont(0.5) within group (order by m.pit_lane_seconds))::numeric, 1) from metingen m),
    'sampleCount', (select count(*) from metingen),
    'source', case when exists (select 1 from metingen) then 'measured' else 'none' end,
    'lastStopAt', (select max(m.pit_exit_at) from metingen m)
  );
$function$;

comment on function public.pitwall_pit_loss_v1(uuid, uuid) is
  'Gemeten pitlanetijd per team: mediaan van de bruikbare stops. pitLaneSeconds is null als er geen vlaggen zijn gemeten.';

revoke all on function public.pitwall_pit_loss_v1(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Aansluiting op de pitwall-data
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_pitwall_data(p_event_id uuid, p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_user_id        uuid;
    v_is_staff       boolean;
    v_is_team_member boolean;
    v_team_name      text;
    v_team_car       text;
    v_team_car_num   text;
    v_race_run_id    uuid;
    v_trends         jsonb;
    v_pit_loss       jsonb;
    v_result         jsonb;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Check access: staff OR own-team member (unchanged gate)
    v_is_staff := public.is_endurance_staff(v_user_id);
    v_is_team_member := EXISTS (
        SELECT 1 FROM public.endurance_team_members etm
        WHERE etm.team_id = p_team_id AND etm.user_id = v_user_id
    );

    IF NOT v_is_staff AND NOT v_is_team_member THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- Team info
    SELECT t.name, t.car_id, t.car_number
    INTO v_team_name, v_team_car, v_team_car_num
    FROM public.endurance_teams t
    WHERE t.id = p_team_id AND t.event_id = p_event_id;

    -- Current active race run for this team/event (for opponent trends context)
    SELECT id INTO v_race_run_id
    FROM public.endurance_race_runs
    WHERE event_id = p_event_id AND team_id = p_team_id
      AND run_kind = 'race' AND status = 'active'
    LIMIT 1;

    -- 0.4.3: server-side closing-rate map for this race run (bounded). Empty when none.
    v_trends := CASE WHEN v_race_run_id IS NULL THEN '{}'::jsonb
                     ELSE public.pitwall_opponent_trends_v1(v_race_run_id) END;

    -- Punt 9: gemeten pitlanetijd uit de vastgelegde stops. Null als er geen
    -- in_pit_lane-vlaggen waren; dan moet de pitwall zwijgen, niet gokken.
    v_pit_loss := public.pitwall_pit_loss_v1(p_event_id, p_team_id);

    -- Build result (unchanged CTEs + scenario trend key)
    WITH
    latest_v3 AS (
        SELECT
            stl.telemetry,
            stl.v3_normalized,
            stl.current_driver_id,
            stl.current_driver_name,
            stl.car_id,
            stl.car_name,
            stl.track_name,
            stl.track_config,
            stl.driver_id,
            stl.received_at,
            stl.race_run_id
        FROM public.simhub_telemetry_latest stl
        WHERE stl.endurance_team_id = p_team_id
          AND stl.endurance_event_id = p_event_id
        ORDER BY stl.received_at DESC
        LIMIT 1
    ),
    strategy AS (
        SELECT row_to_json(s.*)::jsonb AS data
        FROM public.endurance_strategy_latest s
        WHERE s.team_id = p_team_id AND s.event_id = p_event_id
        LIMIT 1
    ),
    latest_events AS (
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
        FROM latest_events e
    ),
    planned_stints AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'id', s.id,
                    'driver_id', s.driver_id,
                    'original_start_at', s.original_start_at,
                    'original_end_at', s.original_end_at,
                    'actual_start_at', s.actual_start_at,
                    'actual_end_at', s.actual_end_at,
                    'expected_laps', s.expected_laps,
                    'fuel_litres', s.fuel_litres,
                    'tyre_change', s.tyre_change,
                    'double_stint', s.double_stint,
                    'status', s.status,
                    'notes', s.notes
                ) ORDER BY s.original_start_at
            ), '[]'::jsonb
        ) AS stints
        FROM public.endurance_stints s
        WHERE s.team_id = p_team_id AND s.event_id = p_event_id
    ),
    tyre_samples AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'lap', s.completed_laps,
                    'lap_time', s.lap_time_seconds,
                    'fuel', s.fuel_end_litres,
                    'fl', s.wear_fl, 'fr', s.wear_fr,
                    'rl', s.wear_rl, 'rr', s.wear_rr,
                    'captured_at', s.captured_at
                ) ORDER BY s.completed_laps DESC
            ), '[]'::jsonb
        ) AS samples
        FROM (
            SELECT completed_laps, lap_time_seconds, fuel_end_litres,
                   wear_fl, wear_fr, wear_rl, wear_rr, captured_at
            FROM public.endurance_strategy_lap_samples
            WHERE event_id = p_event_id
              AND team_id = p_team_id
              AND wear_fl IS NOT NULL
            ORDER BY completed_laps DESC
            LIMIT 20
        ) s
    ),
    fuel_samples AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'lap', f.completed_laps,
                    'used', f.fuel_used_litres,
                    'lap_time', f.lap_time_seconds,
                    'captured_at', f.captured_at
                ) ORDER BY f.completed_laps DESC
            ), '[]'::jsonb
        ) AS samples
        FROM (
            SELECT s.completed_laps, s.fuel_used_litres, s.lap_time_seconds, s.captured_at
            FROM public.endurance_strategy_lap_samples s
            WHERE s.event_id = p_event_id
              AND s.team_id = p_team_id
              AND s.valid_fuel_sample
            ORDER BY s.completed_laps DESC
            LIMIT 20
        ) f
    ),
    pace_targets AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'user_id', pe.user_id,
                    'average_lap_seconds', pe.average_lap_seconds,
                    'best_lap_seconds', pe.best_lap_seconds,
                    'valid_laps', pe.valid_laps,
                    'source', pe.source
                )
            ), '[]'::jsonb
        ) AS targets
        FROM public.endurance_pace_entries pe
        WHERE pe.event_id = p_event_id
    )
    SELECT jsonb_build_object(
        'team', jsonb_build_object(
            'id', p_team_id,
            'name', v_team_name,
            'car_id', v_team_car,
            'car_number', v_team_car_num
        ),
        'telemetry', (SELECT row_to_json(l.*)::jsonb FROM latest_v3 l),
        'v3_normalized', (SELECT l.v3_normalized FROM latest_v3 l),
        'strategy', COALESCE((SELECT data FROM strategy), 'null'::jsonb),
        'timeline', COALESCE((SELECT events FROM timeline), '[]'::jsonb),
        'planned_stints', COALESCE((SELECT stints FROM planned_stints), '[]'::jsonb),
        'pace_targets', COALESCE((SELECT targets FROM pace_targets), '[]'::jsonb),
        'opponent_trends', COALESCE(v_trends, '{}'::jsonb),
        'fuel_samples', COALESCE((SELECT samples FROM fuel_samples), '[]'::jsonb),
        'tyre_samples', COALESCE((SELECT samples FROM tyre_samples), '[]'::jsonb),
        'pit_loss', COALESCE(v_pit_loss, 'null'::jsonb),
        'pit_lane_seconds', (v_pit_loss->>'pitLaneSeconds')::numeric,
        'access', CASE WHEN v_is_staff THEN 'staff' ELSE 'team_member' END
    ) INTO v_result;

    RETURN v_result;
END;
$function$;
