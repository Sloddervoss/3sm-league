-- Fase 1, tweede laag: bandenmodel en pitverlies ook aan de run binden.
--
-- De buitenste functie koos sinds 20261108200000 wel de run van het getoonde
-- frame, maar gaf alleen event en team door aan `pitwall_tyre_estimate_v1` en
-- `pitwall_pit_loss_v1`. Die helpers pakten vervolgens het nieuwste anker of de
-- beste stop van het hele event. Een geldig frame van race B kon dus een meting
-- uit race A meekrijgen — dezelfde fout als de strategie van 25 oktober.
--
-- Wat dit doet: beide helpers krijgen een derde argument, de race-run. Ze
-- filteren daarop (endurance_tyre_anchors.race_run_id, endurance_pit_stops.
-- race_run_id). Ontbreekt de run, dan is het antwoord "onbekend" en niet het
-- nieuwste dat toevallig bestaat. De terugval op `endurance_tyre_state_labels`
-- vervalt in dit pad, omdat die functie blokken uit meerdere runs groepeert.
--
-- De bestaande twee-argument-vormen blijven bestaan voor het dev-scherm
-- `/admin/pitwall-test`; de pitwall gebruikt vanaf nu de rungebonden vorm.
--
-- Alleen-lezen op bestaande tabellen: er verandert geen rij en geen kolom.

BEGIN;

CREATE OR REPLACE FUNCTION public.pitwall_tyre_estimate_v1(p_event_id uuid, p_team_id uuid, p_race_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
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


    -- Fase 1: zonder bewezen run bestaat er geen meting. Een anker uit een andere
    -- run is precies wat de pitwall op 8 november liet zien (strategie van 25
    -- oktober naast frames van die avond). Onbekend is hier een geldig antwoord.
    IF p_race_run_id IS NULL THEN
        RETURN jsonb_build_object(
            'source', 'none',
            'grade', 'D',
            'reason', 'run_unknown',
            'anchor', NULL,
            'previous_anchor', NULL,
            'estimate', NULL,
            'sigma_pct', NULL,
            'state_labels', '[]'::jsonb
        );
    END IF;

    -- Het nieuwste BRUIKBARE anker. anchor_usable = false is bewijs, geen meting
    -- (een bevroren herhaling van de vorige momentopname).
    SELECT * INTO v_cur
      FROM public.endurance_tyre_anchors a
     WHERE a.event_id = p_event_id
       AND a.team_id = p_team_id
       AND a.race_run_id = p_race_run_id
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
        -- Geen terugval op `endurance_tyre_state_labels`: die functie groepeert
        -- per run en levert blokken uit meerdere runs. In een rungebonden antwoord
        -- zou dat weer een meting van een andere race zijn.
        v_labels := '[]'::jsonb;
        v_grade  := 'D';
        v_source := 'none';
        IF EXISTS (SELECT 1 FROM public.endurance_tyre_anchors a
                    WHERE a.event_id = p_event_id AND a.team_id = p_team_id
                      AND a.race_run_id = p_race_run_id) THEN
            v_reason := 'frozen';
        ELSE
            v_reason := 'no_anchor';
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


CREATE OR REPLACE FUNCTION public.pitwall_pit_loss_v1(p_event_id uuid, p_team_id uuid, p_race_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
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

  -- Zonder bewezen run geen pitverlies: een stop uit een andere race is geen
  -- meting van deze race.
  if p_race_run_id is null then
    return jsonb_build_object(
      'pitLaneSeconds', null,
      'sampleCount', 0,
      'source', 'none',
      'lastStopAt', null
    );
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
         and s.race_run_id = p_race_run_id
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
         and s.race_run_id = p_race_run_id
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

-- Fase 1 — één coherente pitwalllezing.
-- Alle racegebonden blokken (strategie, tijdlijn, brandstof- en bandensamples,
-- opponenttrends, bandenmodel, pitverlies) komen uit dezelfde run als de
-- telemetrie die getoond wordt. Is daar geen geldige, actieve run voor, dan
-- blijft alleen de telemetrie staan en zegt `context` waarom.
-- Reden: op 2026-11-08 stond verse telemetrie naast een strategie en tijdlijn
-- van 25 oktober, uit twee verschillende oude runs. Niets in de UI kon dat zien.
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
    v_live_run_id    uuid;
    v_live_received  timestamptz;
    v_event_status   text;
    v_status         text;
    v_view           text;
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

    SELECT e.status INTO v_event_status
    FROM public.endurance_events e WHERE e.id = p_event_id;

    -- Welke run hoort bij de telemetrie die we gaan tonen? Niet "de nieuwste
    -- strategie", maar de run waar het live-frame zelf bij hoort.
    SELECT stl.race_run_id, stl.received_at
    INTO v_live_run_id, v_live_received
    FROM public.simhub_telemetry_latest stl
    WHERE stl.endurance_team_id = p_team_id
      AND stl.endurance_event_id = p_event_id
    ORDER BY stl.received_at DESC
    LIMIT 1;

    IF v_live_received IS NULL THEN
        v_status := 'no_telemetry';
    ELSIF v_live_run_id IS NULL THEN
        v_status := 'unlinked_telemetry';
    ELSIF NOT EXISTS (
        SELECT 1 FROM public.endurance_race_runs r
        WHERE r.id = v_live_run_id
          AND r.event_id = p_event_id
          AND r.team_id = p_team_id
          AND r.run_kind = 'race'
          AND r.status = 'active'
    ) THEN
        v_status := CASE WHEN v_event_status = 'completed' THEN 'event_completed'
                         ELSE 'inactive_run' END;
    ELSIF v_live_received < now() - interval '5 minutes' THEN
        v_status := 'stale_telemetry';
    ELSE
        v_status := 'live';
    END IF;

    -- Welke run levert de racegebonden blokken?
    --   live     -> de run van het getoonde frame.
    --   archief  -> een afgesloten event waarvan de laatste telemetrie ouder is dan
    --               een etmaal (of helemaal ontbreekt): de laatste run van dat event.
    --               Zo blijft een oude race bekijkbaar zonder dat een race van
    --               gisteravond als "archief" naast verse frames komt te staan.
    --   anders   -> niets. Dat is het geval van vanavond: verse telemetrie op een
    --               afgesloten event, waar een oude strategie naast stond.
    IF v_status = 'live' THEN
        v_race_run_id := v_live_run_id;
        v_view := 'live';
    ELSIF v_event_status = 'completed'
          AND (v_live_received IS NULL OR v_live_received < now() - interval '24 hours') THEN
        SELECT r.id INTO v_race_run_id
        FROM public.endurance_race_runs r
        WHERE r.event_id = p_event_id AND r.team_id = p_team_id AND r.run_kind = 'race'
        ORDER BY r.started_at DESC
        LIMIT 1;
        v_view := CASE WHEN v_race_run_id IS NULL THEN 'none' ELSE 'history' END;
    ELSE
        v_race_run_id := NULL;
        v_view := 'none';
    END IF;

    -- 0.4.3: server-side closing-rate map for this race run (bounded). Empty when none.
    v_trends := CASE WHEN v_race_run_id IS NULL THEN '{}'::jsonb
                     ELSE public.pitwall_opponent_trends_v1(v_race_run_id) END;

    IF v_race_run_id IS NULL THEN
        v_tyre := NULL;
        v_pit_loss := NULL;
    ELSE
        -- S2: anker + graad + bandbreedte. STABLE en SECURITY DEFINER, dus dit mag
        -- hier zonder extra rechten. Zonder anker (zoals 24-10) komt er graad D met
        -- state labels terug en blijft elk getal weg.
        v_tyre := public.pitwall_tyre_estimate_v1(p_event_id, p_team_id, v_race_run_id);

        -- Punt 9: gemeten pitlanetijd uit de vastgelegde stops. Null als er geen
        -- in_pit_lane-vlaggen waren; dan moet de pitwall zwijgen, niet gokken.
        v_pit_loss := public.pitwall_pit_loss_v1(p_event_id, p_team_id, v_race_run_id);
    END IF;

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
          AND s.race_run_id = v_race_run_id
        ORDER BY s.updated_at DESC NULLS LAST
        LIMIT 1
    ),
    latest_events AS (
        SELECT e.*
        FROM public.endurance_telemetry_events e
        WHERE e.team_id = p_team_id AND e.event_id = p_event_id
          AND e.event_type <> 'sample'
          AND e.race_run_id = v_race_run_id
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
              AND race_run_id = v_race_run_id
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
              AND s.race_run_id = v_race_run_id
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
        -- Fase 1: expliciet waarom racegebonden blokken leeg zijn. De UI toont dit
        -- in plaats van een oude race; zonder dit veld is "leeg" niet te duiden.
        'context', jsonb_build_object(
            'status', v_status,
            'view', v_view,
            'race_run_id', v_race_run_id,
            'event_status', v_event_status,
            'telemetry_run_id', v_live_run_id,
            'telemetry_received_at', v_live_received
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

COMMIT;
