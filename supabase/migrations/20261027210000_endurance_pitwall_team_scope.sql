-- 2026-10-27: de pitwall leest alleen nog het eigen team — ook voor testers.
--
-- Aanleiding. `is_endurance_staff()` kent drie rollen: super_admin,
-- endurance_manager en tester. Die helper stond als enige poort in
-- get_pitwall_data(), pitwall_tyre_estimate_v1(), endurance_tyre_state_labels()
-- en pitwall_pit_loss_v1(). Met een zelfgekozen p_team_id kon een tester
-- daardoor brandstof, banden, strategie en pitverlies van een concurrent lezen.
-- Dat is racestrategie, geen demo-data.
--
-- Wat deze migratie doet:
--   * endurance_pitwall_can_read(team) — één poort voor alle leesfuncties:
--     auth.uid() is gevuld én de aanvrager is endurance-beheer (super_admin of
--     endurance_manager) óf lid van precies dat team. Tester zit er niet in.
--     Eén functie en niet vier keer hetzelfde IF-blok, omdat de vier poorten
--     juist uit elkaar waren gelopen; nu is er één plek om te controleren.
--   * De vier leesfuncties gebruiken die poort. endurance_tyre_state_labels()
--     en pitwall_pit_loss_v1() hadden helemaal geen auth-check: ze waren alleen
--     ingetrokken voor authenticated. Ze krijgen nu dezelfde poort, zodat een
--     andere grant ze niet stilzwijgend openzet.
--   * get_pitwall_data() geeft `access` nog steeds 'staff' of 'team_member';
--     'staff' betekent hier vanaf nu endurance-beheer.
--
-- Wat deze migratie NIET doet: is_endurance_staff() blijft ongewijzigd. Testers
-- houden hun device-koppeling en ingest-rechten (die hangen aan dezelfde
-- helper); dit gaat over racedata, niet over het recht om te streamen.
--
-- Additief: alleen CREATE OR REPLACE en nieuwe grants. Geen tabel-, kolom- of
-- datawijziging. Rollback: 20261027210000_endurance_pitwall_team_scope.rollback.sql

-- ---------------------------------------------------------------------------
-- 1. Eén poort voor alle pitwall-reads
-- ---------------------------------------------------------------------------

create or replace function public.endurance_pitwall_can_read(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $function$
  select auth.uid() is not null
     and (
       -- Beheer: super_admin of endurance_manager. Bewust niet is_endurance_staff,
       -- want die kent ook tester en dat is precies het lek.
       public.is_endurance_manager(auth.uid())
       -- Of lid van precies het opgevraagde team. Geen enkel ander team.
       or exists (
         select 1
           from public.endurance_team_members m
          where m.team_id = p_team_id
            and m.user_id = auth.uid()
       )
     );
$function$;

comment on function public.endurance_pitwall_can_read(uuid) is
  'Toegangspoort voor de pitwall-leesfuncties: endurance-beheer of lid van dit ene team. Tester geeft geen toegang tot andermans team.';

revoke all on function public.endurance_pitwall_can_read(uuid) from public, anon, authenticated;
grant execute on function public.endurance_pitwall_can_read(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. State labels: dezelfde poort, en nu ook echt een check
-- ---------------------------------------------------------------------------

create or replace function public.endurance_tyre_state_labels(p_event_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $function$
begin
    -- Deze functie had geen enkele auth-check: de revoke was de enige
    -- bescherming. Elke definitie-functie die hem aanriep gaf hem daarmee door
    -- aan elke gebruiker. Nu staat dezelfde poort erin als in de RPC.
    if not public.endurance_pitwall_can_read(p_team_id) then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    return (
      with blok as (
        select l.race_run_id,
               l.source_device_id,
               l.fuel_stint_id,
               min(l.completed_laps)  as lap_from,
               max(l.completed_laps)  as lap_to,
               min(l.captured_at)     as observed_at,
               round(avg(l.wear_fl), 2) as fl,
               round(avg(l.wear_fr), 2) as fr,
               round(avg(l.wear_rl), 2) as rl,
               round(avg(l.wear_rr), 2) as rr
          from public.endurance_strategy_lap_samples l
         where l.event_id = p_event_id
           and l.team_id = p_team_id
           and l.wear_fl is not null
         group by l.race_run_id, l.source_device_id, l.fuel_stint_id
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'lap_from', b1.lap_from,
            'lap_to', b1.lap_to,
            'laps', b1.lap_to - b1.lap_from + 1,
            'fl', b1.fl, 'fr', b1.fr, 'rl', b1.rl, 'rr', b1.rr,
            'observed_at', b1.observed_at,
            'source', 'state_label',
            -- Andere blokken in hetzelfde event die dezelfde rondes dekken met
            -- een andere waarde: het bewijs dat de blokken niet aaneensluiten.
            'conflicts', (
              select count(*)
                from blok b2
               where b2.race_run_id is not distinct from b1.race_run_id
                 and b2.source_device_id is distinct from b1.source_device_id
                 and b2.lap_from <= b1.lap_to
                 and b2.lap_to >= b1.lap_from
                 and (b2.fl, b2.fr, b2.rl, b2.rr) <> (b1.fl, b1.fr, b1.rl, b1.rr)
            ),
            -- Bewust altijd false: een sprong in de wear valt niet samen met een
            -- aantoonbare stop, dus hier valt geen bandenwissel uit af te leiden.
            'tyre_change_suspected', false
          ) order by b1.observed_at desc
        ), '[]'::jsonb)
      from blok b1
    );
end;
$function$;

revoke all on function public.endurance_tyre_state_labels(uuid, uuid) from public, anon, authenticated;
grant execute on function public.endurance_tyre_state_labels(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. De banden-RPC: dezelfde poort, zonder eigen afschrift
-- ---------------------------------------------------------------------------

create or replace function public.pitwall_tyre_estimate_v1(p_event_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $function$
DECLARE
    v_user_id    uuid;
    v_cur        public.endurance_tyre_anchors%ROWTYPE;
    v_prev       public.endurance_tyre_anchors%ROWTYPE;
    v_has_cur    boolean := false;
    v_has_prev   boolean := false;
    v_gap        integer;
    v_pair       boolean := false;
    v_grade      text;
    v_reason     text;
    v_source     text;
    v_sigma      numeric;
    v_anchor     jsonb;
    v_prev_anchor jsonb;
    v_estimate   jsonb;
    v_per_corner jsonb;
    v_weakest    text;
    v_labels     jsonb;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Zelfde toegangspoort als get_pitwall_data: beheer of lid van dit team.
    IF NOT public.endurance_pitwall_can_read(p_team_id) THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- Het nieuwste BRUIKBARE anker. anchor_usable = false is bewijs, geen meting
    -- (een bevroren herhaling van de vorige momentopname).
    SELECT * INTO v_cur
      FROM public.endurance_tyre_anchors a
     WHERE a.event_id = p_event_id
       AND a.team_id = p_team_id
       AND a.anchor_usable
     ORDER BY a.captured_at DESC, a.stint_no DESC
     LIMIT 1;
    v_has_cur := FOUND;

    IF v_has_cur THEN
        SELECT * INTO v_prev
          FROM public.endurance_tyre_anchors a
         WHERE a.race_run_id = v_cur.race_run_id
           AND a.stint_no = v_cur.stint_no - 1
         LIMIT 1;
        v_has_prev := FOUND;
        IF v_has_prev THEN
            v_gap := v_cur.anchor_lap - v_prev.anchor_lap;
        END IF;
    END IF;

    -- Poorten voor een paar. Zonder deze poorten levert één race tientallen
    -- schijnbaar geldige paren over setwissels heen in plaats van een handvol.
    v_pair := v_has_cur
              AND v_has_prev
              AND v_prev.anchor_usable
              AND COALESCE(v_gap, 0) >= 5
              AND v_cur.tyre_changed IS NOT TRUE
              AND v_prev.tyre_set_no IS NOT DISTINCT FROM v_cur.tyre_set_no
              AND v_cur.wear_fl <= v_prev.wear_fl
              AND v_cur.wear_fr <= v_prev.wear_fr
              AND v_cur.wear_rl <= v_prev.wear_rl
              AND v_cur.wear_rr <= v_prev.wear_rr;

    IF NOT v_has_cur THEN
        v_labels := public.endurance_tyre_state_labels(p_event_id, p_team_id);
        v_grade  := 'D';
        IF jsonb_array_length(v_labels) > 0 THEN
            v_source := 'state_label';
            -- Ankers bestaan wel maar zijn onbruikbaar (bevroren): dat is een
            -- andere oorzaak dan "er is nooit een anker geschreven".
            IF EXISTS (SELECT 1 FROM public.endurance_tyre_anchors a
                        WHERE a.event_id = p_event_id AND a.team_id = p_team_id) THEN
                v_reason := 'frozen';
            ELSE
                v_reason := 'no_anchor';
            END IF;
        ELSE
            v_source := 'none';
            v_reason := 'no_data';
        END IF;
    ELSIF v_pair THEN
        v_grade  := 'A';
        v_reason := 'two_anchors';
        v_source := 'anchor';
        -- De basisband uit het plan: ±1,6 pp met twee ankers, ±6 pp met één
        -- (plan §3). De gradetabel in §4 noemt σ ≤ 1,5 pp voor A; die 0,1 pp
        -- verschil zit in het plan zelf. We tonen de bandbreedte, niet de
        -- drempel, en de modelaag mag hem niet smaller maken dan de invoer
        -- rechtvaardigt.
        v_sigma  := 1.6;
    ELSIF NOT v_has_prev THEN
        -- Alleen een startanker: wel een stand, geen tempo.
        v_grade  := 'C';
        v_reason := 'one_anchor';
        v_source := 'anchor';
    ELSIF COALESCE(v_gap, 0) < 5 THEN
        v_grade  := 'C';
        v_reason := 'too_few_laps';
        v_source := 'anchor';
    ELSE
        -- Wel een eindmeting, maar geen bruikbaar paar (set gewisseld of niet
        -- monotoon): één getal met ruime marge, geen helling.
        v_grade  := 'B';
        v_reason := 'one_anchor';
        v_source := 'anchor';
        v_sigma  := 6.0;
    END IF;

    IF v_has_cur THEN
        SELECT public.endurance_tyre_anchor_json(a) INTO v_anchor
          FROM public.endurance_tyre_anchors a
         WHERE a.id = v_cur.id;

        IF v_has_prev THEN
            -- Rondes sinds het vorige anker: dat is de noemer van elke helling.
            -- Alleen zinvol als er een vorig anker is; anders blijft de sleutel weg.
            v_anchor := COALESCE(v_anchor, '{}'::jsonb) || jsonb_build_object('laps_since', v_gap);

            SELECT public.endurance_tyre_anchor_json(a) INTO v_prev_anchor
              FROM public.endurance_tyre_anchors a
             WHERE a.id = v_prev.id;
        END IF;

        -- rate_per_lap = verandering per ronde; negatief = slijt. Dat is de
        -- eenheid die de UI toont. Geen rate zonder paar.
        SELECT jsonb_object_agg(
                 d.corner,
                 jsonb_build_object(
                   'value', d.w_cur,
                   'rate_per_lap', d.rate,
                   'sigma', v_sigma,
                   'laps_to_threshold',
                     CASE WHEN d.rate < 0
                          THEN ceil((d.w_cur - 40) / (-d.rate))::integer END
                 ))
          INTO v_per_corner
          FROM (
            SELECT c.corner,
                   c.w_cur,
                   CASE WHEN v_pair AND COALESCE(v_gap, 0) > 0
                        THEN round((c.w_cur - c.w_prev) / v_gap, 2) END AS rate
              FROM (VALUES ('fl', v_cur.wear_fl, v_prev.wear_fl),
                           ('fr', v_cur.wear_fr, v_prev.wear_fr),
                           ('rl', v_cur.wear_rl, v_prev.wear_rl),
                           ('rr', v_cur.wear_rr, v_prev.wear_rr)
                   ) AS c(corner, w_cur, w_prev)
          ) d;

        v_weakest := CASE least(v_cur.wear_fl, v_cur.wear_fr, v_cur.wear_rl, v_cur.wear_rr)
                       WHEN v_cur.wear_fl THEN 'fl'
                       WHEN v_cur.wear_fr THEN 'fr'
                       WHEN v_cur.wear_rl THEN 'rl'
                       ELSE 'rr'
                     END;

        v_estimate := jsonb_build_object(
            'per_corner', v_per_corner,
            'weakest', v_weakest,
            'threshold_pct', 40,
            'grade_basis', v_reason
        );
    END IF;

    RETURN jsonb_build_object(
        'source', v_source,
        'grade', v_grade,
        'reason', v_reason,
        'anchor', v_anchor,
        'previous_anchor', v_prev_anchor,
        'estimate', v_estimate,
        'sigma_pct', v_sigma,
        'state_labels', COALESCE(v_labels, '[]'::jsonb)
    );
END;
$function$;

revoke all on function public.pitwall_tyre_estimate_v1(uuid, uuid) from public, anon;
grant execute on function public.pitwall_tyre_estimate_v1(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Pitverlies: dezelfde poort, en nu ook echt een check
-- ---------------------------------------------------------------------------

create or replace function public.pitwall_pit_loss_v1(p_event_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Ook deze functie had geen auth-check: de revoke op authenticated was de
  -- enige grens, niet de aanvraag zelf.
  if not public.endurance_pitwall_can_read(p_team_id) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  return (
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
    )
  );
end;
$function$;

revoke all on function public.pitwall_pit_loss_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pitwall_pit_loss_v1(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. get_pitwall_data: beheer in plaats van staff
-- ---------------------------------------------------------------------------

-- Basis: de versie uit 20261025130200 (met tyre_estimate en pit_loss). Alleen de
-- poort verandert: `v_is_staff` komt nu van is_endurance_manager() in plaats van
-- is_endurance_staff(). De CTE's, de sleutels en de ORDER BY blijven gelijk.

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
    v_tyre           jsonb;
    v_result         jsonb;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Beheer (super_admin, endurance_manager) OF lid van dit ene team.
    -- is_endurance_staff() zou hier ook tester toelaten, en die mocht met een
    -- gekozen p_team_id elk team lezen; dat is het lek dat dit dichtzet.
    v_is_staff := public.is_endurance_manager(v_user_id);
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

    -- S2: anker + graad + bandbreedte. STABLE en SECURITY DEFINER, dus dit mag
    -- hier zonder extra rechten. Zonder anker (zoals 24-10) komt er graad D met
    -- state labels terug en blijft elk getal weg.
    v_tyre := public.pitwall_tyre_estimate_v1(p_event_id, p_team_id);

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
        -- Deze sortering stond al in productie (er staat een rij per race-run;
        -- zonder ORDER BY pakte dit een willekeurige rij, dus na een herstart of
        -- apparaatwissel uren oude brandstof). Bewust meegenomen: hem weglaten
        -- zou een bestaande fix stil terugdraaien.
        ORDER BY s.updated_at DESC NULLS LAST
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
        -- tyre_samples is verouderd: een reeks, terwijl elke waarde in
        -- werkelijkheid een state label van een blok is. De vorm blijft staan
        -- zodat de huidige UI niets merkt; vervangen gebeurt in de UI-laag.
        'tyre_samples', COALESCE((SELECT samples FROM tyre_samples), '[]'::jsonb),
        'tyre_estimate', COALESCE(v_tyre, 'null'::jsonb),
        'pit_loss', COALESCE(v_pit_loss, 'null'::jsonb),
        'pit_lane_seconds', (v_pit_loss->>'pitLaneSeconds')::numeric,
        'access', CASE WHEN v_is_staff THEN 'staff' ELSE 'team_member' END
    ) INTO v_result;

    RETURN v_result;
END;
$function$;
