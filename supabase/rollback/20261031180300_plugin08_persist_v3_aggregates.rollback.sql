-- Rollback van 20261031180300_plugin08_persist_v3_aggregates.sql
--
-- Zet simhub_persist_v3 terug op de definitie van 20261031140000: zes
-- parameters, zonder p_events en p_laps. De tabellen en hun GEGEVENS blijven
-- staan; ze worden hier alleen niet meer gevuld. Dat is opzettelijk: een DROP
-- zou alle wear-ankers, pitgebeurtenissen en rondeaggregaten weggooien en de
-- aanname dat de outbox ze opnieuw aanbiedt is niet gegarandeerd.
--
-- Destructief opruimen (na export) staat in
-- supabase/rollback/plugin08_destructive_cleanup.sql en is een aparte,
-- gedocumenteerde handeling — geen onderdeel van deze rollback.
--
-- VOLGORDE — dit is belangrijk en gaat mis als je hem negeert:
--   1. Zet eerst in de connectorconfiguratie de features
--      `measurementEvents` en `lapSummaries` UIT
--      (public.simhub_connector_config_apply('{"features":{"measurementEvents":false,"lapSummaries":false}}')).
--   2. Draai dan dit bestand.
-- Waarom: de 0.8-Edge stuurt p_events/p_laps alleen mee als de server ze in de
-- configuratie aanbiedt. Blijft de feature aan staan terwijl deze rollback al
-- gedraaid is, dan roept de Edge een functie met acht argumenten aan die niet
-- meer bestaat (42883) en valt de hele ingest om — niet alleen de meetbatch.
--
-- De DROP hieronder is nodig en niet cosmetisch: een functie met twee extra
-- DEFAULT-parameters is een nieuwe overload. Zonder drop blijven de acht- en de
-- zes-argumentversie naast elkaar bestaan en wordt een aanroep met vijf
-- benoemde argumenten ambigu (42725).
--
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

drop function if exists public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text, jsonb, jsonb);

-- De meetbatch en de validatiehelpers horen bij deze migratie, niet bij de
-- tabellen: zonder deze drops blijven ze als losse objecten achter.
drop function if exists public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb);
drop function if exists public.simhub_jvalid(jsonb, text, double precision, double precision);
drop function if exists public.simhub_jtext(jsonb);
drop function if exists public.simhub_jdouble(jsonb);
drop function if exists public.simhub_jint(jsonb);
drop function if exists public.simhub_jbigint(jsonb);
drop function if exists public.simhub_juuid(jsonb);
drop function if exists public.simhub_jtimestamptz(jsonb);
drop function if exists public.simhub_jbool(jsonb);
drop function if exists public.simhub_jtextarray(jsonb, integer);

CREATE OR REPLACE FUNCTION public.simhub_persist_v3(
  p_token_hash text,
  p_session_id text,
  p_sequence bigint,
  p_captured_at timestamp with time zone,
  p_v3_normalized jsonb,
  -- Optioneel, achteraan en met default: een aanroep met vijf argumenten blijft
  -- werken. Expliciet meegegeven wint van het source-blok in de payload.
  p_simhub_version text DEFAULT NULL)
 RETURNS TABLE(result text, received_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  d public.simhub_devices%ROWTYPE;
  s public.endurance_source_segments%ROWTYPE;
  e uuid; t uuid; r uuid;
  now_at timestamptz := clock_timestamp();
  nl integer; ni integer; np boolean;
  v_vorige_laps integer; nf text[];
  v_session_sequence bigint; v_session_count integer;
  baseline boolean := false; k text; payload jsonb;
  v_fuel numeric; v_last_laptime numeric; v_session_laps integer;
  v_driver_name text; v_driver_id text;
  v_run_laps integer; v_run_device uuid;
  v_auto_count bigint; v_auto_team uuid; v_auto_event uuid;
  v_practice_session_id uuid;
  v_practice_event_id uuid;
  -- S2 (anker): alleen op de pitvlag-overgang ingelezen. Alles nullable en
  -- null = onbekend; nooit een coalesce naar 0.
  v_anchor_fl numeric; v_anchor_fr numeric; v_anchor_rl numeric; v_anchor_rr numeric;
  v_zone_fl_l numeric;
  v_zone_fl_m numeric;
  v_zone_fl_r numeric;
  v_zone_fr_l numeric;
  v_zone_fr_m numeric;
  v_zone_fr_r numeric;
  v_zone_rl_l numeric;
  v_zone_rl_m numeric;
  v_zone_rl_r numeric;
  v_zone_rr_l numeric;
  v_zone_rr_m numeric;
  v_zone_rr_r numeric;
  v_anchor_track numeric; v_anchor_air numeric; v_anchor_rubber text;
  v_anchor_source text; v_anchor_sets integer;
  -- Herkomst (0.8.0): twee losse versies, twee kolommen. Null = onbekend, en
  -- onbekend valt nooit terug op de apparaatnaam.
  v_simhub_version text;
  v_connector_version text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::timestamptz; RETURN;
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$'
     OR char_length(coalesce(p_session_id,'')) NOT BETWEEN 1 AND 120
     OR p_sequence IS NULL OR p_sequence < 0
     OR p_captured_at IS NULL
     OR jsonb_typeof(p_v3_normalized) <> 'object' THEN
    RETURN QUERY SELECT 'invalid_payload'::text, NULL::timestamptz; RETURN;
  END IF;

  -- Herkomst: de SimHub-versie en de connectorversie zijn twee verschillende
  -- dingen en horen dus in twee kolommen. Het source-blok is optioneel; ontbreekt
  -- het, dan blijft de kolom leeg in plaats van de apparaatnaam te herhalen
  -- (dat deed deze functie tot 2026-10-31: simhub_version = d.device_name).
  -- Beide kolommen hebben een CHECK van 1-60 tekens; een waarde daarbuiten zou
  -- het hele frame met 23514 laten klappen, dus die wordt null. Leeg is ook null.
  v_simhub_version := btrim(coalesce(p_simhub_version, p_v3_normalized#>>'{source,simHubVersion}', ''));
  IF char_length(v_simhub_version) NOT BETWEEN 1 AND 60 THEN v_simhub_version := NULL; END IF;
  v_connector_version := btrim(coalesce(p_v3_normalized#>>'{source,connectorVersion}', ''));
  IF char_length(v_connector_version) NOT BETWEEN 1 AND 60 THEN v_connector_version := NULL; END IF;

  SELECT * INTO d FROM public.simhub_devices WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid_device'::text, NULL::timestamptz; RETURN; END IF;
  IF d.revoked_at IS NOT NULL THEN RETURN QUERY SELECT 'revoked'::text, NULL::timestamptz; RETURN; END IF;

  -- Routing vereist een actieve binding. Een inschrijving is GEEN voorwaarde meer:
  -- de binding is de beheerder beslis, en een ontbrekende registratie mag een
  -- correct gekoppeld device niet stil in de device-scoped modus laten vallen.
  IF d.endurance_event_id IS NOT NULL AND d.endurance_team_id IS NOT NULL
     AND d.device_status = 'active_binding' AND d.device_role = 'primary'
  THEN
    e := d.endurance_event_id; t := d.endurance_team_id;

    SELECT id INTO r FROM public.endurance_race_runs
    WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
    LIMIT 1;

    -- Zonder actieve race run is het lap-event onbereikbaar. Start er een.
    IF r IS NULL THEN
      PERFORM public.simhub_start_race_run(e, t, 'race');
      SELECT id INTO r FROM public.endurance_race_runs
      WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
      LIMIT 1;
    END IF;
  ELSE
    e := NULL; t := NULL; r := NULL;
  END IF;

  IF d.last_seen_at IS NOT NULL AND d.last_seen_at > now_at - interval '400 milliseconds' THEN
    RETURN QUERY SELECT 'rate_limited'::text, now_at; RETURN;
  END IF;
  SELECT last_sequence INTO v_session_sequence
  FROM public.simhub_device_sessions WHERE device_id = d.id AND session_id = p_session_id FOR UPDATE;
  IF FOUND AND p_sequence <= v_session_sequence THEN
    RETURN QUERY SELECT 'replayed'::text, now_at; RETURN;
  END IF;
  IF NOT FOUND THEN
    SELECT count(*) INTO v_session_count FROM public.simhub_device_sessions WHERE device_id = d.id;
    -- Een device dat zijn plafond raakt mag niet permanent dood zijn. Ruim de
    -- oudste sessies op en houd de recente geschiedenis voor replay-detectie.
    IF v_session_count >= 64 THEN
      DELETE FROM public.simhub_device_sessions AS oud
      WHERE oud.device_id = d.id
        AND oud.session_id NOT IN (
          SELECT nieuw.session_id FROM public.simhub_device_sessions AS nieuw
          WHERE nieuw.device_id = d.id
          ORDER BY nieuw.last_seen_at DESC NULLS LAST
          LIMIT 48
        );
      SELECT count(*) INTO v_session_count FROM public.simhub_device_sessions WHERE device_id = d.id;
    END IF;
    IF v_session_count >= 64 THEN RETURN QUERY SELECT 'session_limit'::text, now_at; RETURN; END IF;
    IF d.last_session_id IS NOT NULL AND (d.last_seen_at > now_at - interval '5 seconds' OR p_sequence > 5) THEN
      RETURN QUERY SELECT 'replayed'::text, now_at; RETURN;
    END IF;
  END IF;

  nl := NULLIF(p_v3_normalized#>>'{timing,completedLaps}','')::integer;
  ni := NULLIF(p_v3_normalized#>>'{raceState,incidents}','')::integer;
  np := NULLIF(p_v3_normalized#>>'{track,onPitRoad}','')::boolean;
  v_fuel := NULLIF(p_v3_normalized#>>'{fuel,fuelLitres}','')::numeric;
  v_last_laptime := NULLIF(p_v3_normalized#>>'{timing,lastLapTimeSeconds}','')::numeric;
  v_session_laps := NULLIF(p_v3_normalized#>>'{session,sessionLapsRemaining}','')::integer;
  SELECT array_agg(x ORDER BY x) INTO nf FROM (
    SELECT DISTINCT jsonb_array_elements_text(coalesce(nullif(p_v3_normalized#>'{session,flags}', 'null'::jsonb), '[]'::jsonb)) x
  ) q;

  -- De plugin stuurt in currentDriverId in de praktijk een NAAM (SimHub's Opponent.Id).
  -- Beide velden worden daarom als naam behandeld.
  v_driver_name := nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverName}', '')), '');
  IF v_driver_name IS NULL THEN
    v_driver_name := nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverId}', '')), '');
  END IF;
  -- Automatische koppeling op de rijder in plaats van op het apparaat.
  -- Een device dat niet gekoppeld is hoort bij de coureur die erin zit. De naam
  -- komt uit de plugin en wordt opgezocht bij de teamleden van events die nu
  -- lopen. Alleen bij precies één team wordt er gekoppeld; bij twijfel niet.
  IF e IS NULL AND v_driver_name IS NOT NULL THEN
    WITH kandidaten AS (
      SELECT DISTINCT m.team_id, m.event_id
        FROM public.endurance_team_members m
        JOIN public.profiles p ON p.user_id = m.user_id
        JOIN public.endurance_events ev ON ev.id = m.event_id
       WHERE (public.simhub_name_key(p.iracing_name) = public.simhub_name_key(v_driver_name)
              OR public.simhub_name_key(p.display_name) = public.simhub_name_key(v_driver_name))
         AND now_at BETWEEN ev.start_at - interval '2 hours' AND ev.end_at + interval '30 minutes'
    )
    SELECT count(*), (array_agg(team_id))[1], (array_agg(event_id))[1]
      INTO v_auto_count, v_auto_team, v_auto_event
      FROM kandidaten;

    IF v_auto_count = 1 THEN
      -- Eerst de andere devices van dit team losmaken: er mag maar één primair zijn.
      UPDATE public.simhub_devices
         SET device_status = 'inactive', device_role = NULL,
             endurance_event_id = NULL, endurance_team_id = NULL,
             endurance_binding_source = NULL, updated_at = now_at
       WHERE id <> d.id AND revoked_at IS NULL
         AND endurance_team_id = v_auto_team AND endurance_event_id = v_auto_event;

      UPDATE public.simhub_devices
         SET device_status = 'active_binding', device_role = 'primary',
             endurance_event_id = v_auto_event, endurance_team_id = v_auto_team,
             endurance_binding_source = 'auto_driver', updated_at = now_at
       WHERE id = d.id;

      e := v_auto_event; t := v_auto_team;

      SELECT id INTO r FROM public.endurance_race_runs
       WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
       LIMIT 1;
      IF r IS NULL THEN
        PERFORM public.simhub_start_race_run(e, t, 'race');
        SELECT id INTO r FROM public.endurance_race_runs
         WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  v_driver_id := public.simhub_resolve_driver_user(e, t, v_driver_name);


  -- Practice op baansleutel. Een manager opent een sessie voor een event; iedereen
  -- die op die baan rijdt telt dan mee, ook zonder teamkoppeling. Dat is nodig
  -- omdat teams pas na de practice op pace worden ingedeeld. De baan wordt
  -- gematcht op iRacings trackId tegen de catalogus van het event.
  IF v_last_laptime IS NOT NULL AND nl IS NOT NULL AND nl > 0
     AND v_last_laptime > 0 AND v_last_laptime <= 3600 THEN
    SELECT sess.id, sess.event_id INTO v_practice_session_id, v_practice_event_id
    FROM public.endurance_practice_sessions AS sess
    JOIN public.endurance_events AS ev ON ev.id = sess.event_id
    LEFT JOIN public.endurance_iracing_events AS cat ON cat.id = ev.iracing_catalog_event_id
    WHERE sess.ended_at IS NULL
      AND (
        cat.track_id = NULLIF(p_v3_normalized#>>'{identity,trackId}', '')::integer
        OR lower(btrim(coalesce(sess.circuit, ''))) = lower(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}', '')))
      )
    ORDER BY sess.started_at DESC
    LIMIT 1;

    IF v_practice_session_id IS NOT NULL THEN
      INSERT INTO public.endurance_practice_laps (
        session_id, event_id, user_id, car_id, car_name, circuit,
        lap_seconds, fuel_used_litres, fuel_per_lap_litres,
        incident_count, recorded_at,
        source_session_id, source_device_id, completed_laps
      ) VALUES (
        v_practice_session_id, v_practice_event_id,
        COALESCE(NULLIF(v_driver_id, '')::uuid, d.owner_user_id),
        NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,carId}', '')), ''),
        NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,carName}', '')), ''),
        NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}', '')), ''),
        v_last_laptime,
        NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}', '')::numeric,
        NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}', '')::numeric,
        COALESCE(ni, 0),
        p_captured_at,
        btrim(p_session_id), d.id, nl
      )
      ON CONFLICT (event_id, source_session_id, source_device_id, completed_laps)
        WHERE source_session_id IS NOT NULL AND source_device_id IS NOT NULL AND completed_laps IS NOT NULL
      DO NOTHING;
    END IF;
  END IF;

  -- Routing-scoped logic only when active-bound
  IF e IS NOT NULL THEN
    SELECT * INTO s FROM public.endurance_source_segments
    WHERE device_id = d.id AND session_id = p_session_id AND event_id = e AND team_id = t FOR UPDATE;
    baseline := NOT FOUND;
    IF NOT baseline AND p_sequence <= s.last_sequence THEN
      RETURN QUERY SELECT 'replayed'::text, NULL::timestamptz; RETURN;
    END IF;

    -- Een nieuwe sessie begint weer bij ronde 0. Zonder deze controle blijft de
    -- oude race run actief en botst elke ronde op ON CONFLICT
    -- (race_run_id, completed_laps): de eerste rondes van een herstart
    -- verdwijnen dan stil, want ze bestaan al.
    --
    -- De vorige stand komt uit het laatst bijgewerkte segment van dit device,
    -- niet uit het huidige: bij een nieuwe sessie bestaat dat nog niet.
    IF nl IS NOT NULL AND r IS NOT NULL THEN
      -- Vergelijk met de laatste sample van DEZE run op HETZELFDE device.
      -- De oude code vergeleek met het eigen, mogelijk uren oude segment van dit
      -- device. Bij een coureurswissel komt de eerste ronde van een ander device
      -- met een andere tellerstand binnen, waardoor de race telkens in een nieuwe
      -- run werd geknipt (14 runs in een race van 6 uur).
      SELECT l.completed_laps, l.source_device_id
        INTO v_run_laps, v_run_device
        FROM public.endurance_strategy_lap_samples l
       WHERE l.race_run_id = r AND l.completed_laps IS NOT NULL
       ORDER BY l.captured_at DESC
       LIMIT 1;

      IF v_run_device = d.id AND v_run_laps IS NOT NULL AND nl + 2 < v_run_laps THEN
        UPDATE public.endurance_race_runs
           SET status = 'ended', ended_at = clock_timestamp()
         WHERE id = r AND status = 'active';
        PERFORM public.simhub_start_race_run(e, t, 'race');
        SELECT id INTO r FROM public.endurance_race_runs
         WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
         LIMIT 1;
        -- Deze ronde is de nulmeting van de nieuwe run; de volgende telt.
        s.previous_completed_laps := nl;
      END IF;
    END IF;

    IF NOT baseline AND r IS NOT NULL THEN
      IF s.previous_completed_laps IS NOT NULL AND nl = s.previous_completed_laps + 1 THEN
        k := 'lap:' || nl;
        payload := jsonb_build_object(
          'completedLaps', nl,
          'lastLapTimeSeconds', v_last_laptime,
          -- Identiteit mee, zodat de lees-kant altijd een bron heeft.
          'identity', coalesce(p_v3_normalized->'identity', '{}'::jsonb),
          'driverName', v_driver_name
        );
        -- S2: in_pit_lane, fuel_litres en fuel_per_lap_litres gaan mee. Niemand
        -- schreef ze ooit, waardoor pitstops achteraf onvindbaar waren; deze drie
        -- waren altijd null, dus er kan niets op gebroken zijn.
        INSERT INTO public.endurance_telemetry_events(
          device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
          event_detection_source,completed_laps,driver_id,lap,lap_time_from_deltas_s,payload,race_run_id,
          in_pit_lane,fuel_litres,fuel_per_lap_litres)
        VALUES(
          d.id,e,t,p_session_id,'lap_completed',k,p_sequence,p_captured_at,
          'simhub_v3_transition',nl,v_driver_id,nl,v_last_laptime,payload,r,
          np,v_fuel,NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}','')::numeric)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    INSERT INTO public.endurance_source_segments(
      device_id,session_id,event_id,team_id,race_run_id,last_sequence,
      previous_completed_laps,previous_in_pit_lane,previous_incidents,previous_flags)
    VALUES(d.id,p_session_id,e,t,r,p_sequence,nl,np,ni,nf)
    ON CONFLICT(device_id,session_id,event_id,team_id) DO UPDATE SET
      race_run_id=excluded.race_run_id,
      last_sequence=excluded.last_sequence,
      previous_completed_laps=excluded.previous_completed_laps,
      previous_in_pit_lane=excluded.previous_in_pit_lane,
      previous_incidents=excluded.previous_incidents,
      previous_flags=excluded.previous_flags,
      updated_at=clock_timestamp();
  END IF;

  -- Always store latest snapshot (device-scoped when unbounded: event/team/race_run NULL).
  INSERT INTO public.simhub_telemetry_latest(
    device_id,owner_user_id,race_id,team_id,session_id,sequence,captured_at,received_at,
    connector_id,simhub_version,connector_version,game,telemetry,
    endurance_event_id,endurance_team_id,race_run_id,
    driver_id,current_driver_id,current_driver_name,v3_normalized,
      car_id,car_name,track_name,track_config)
  VALUES(d.id,d.owner_user_id,d.race_id,d.team_id,p_session_id,p_sequence,p_captured_at,now_at,
    d.connector_id,v_simhub_version,v_connector_version,'IRacing','{}',
    e,t,r,
    v_driver_id,
    nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverId}','')),''),
    v_driver_name,
    p_v3_normalized,
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,carId}','')),''),
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,carName}','')),''),
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}','')),''),
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,trackConfig}','')),''))
  ON CONFLICT(device_id) DO UPDATE SET
    session_id=excluded.session_id, sequence=excluded.sequence, captured_at=excluded.captured_at,
    received_at=excluded.received_at,
    -- De versies horen bij het laatste frame. Een frame zonder source-blok wist ze
    -- naar null: onbekend blijft onbekend, en de oude apparaatnaam verdwijnt in
    -- plaats van voor altijd te blijven staan.
    simhub_version=excluded.simhub_version,
    connector_version=excluded.connector_version,
    endurance_event_id=excluded.endurance_event_id, endurance_team_id=excluded.endurance_team_id,
    race_run_id=excluded.race_run_id,
    driver_id=excluded.driver_id,
    current_driver_id=excluded.current_driver_id,
    current_driver_name=excluded.current_driver_name,
    v3_normalized=excluded.v3_normalized,
      car_id=excluded.car_id, car_name=excluded.car_name,
      track_name=excluded.track_name, track_config=excluded.track_config;

  INSERT INTO public.simhub_device_sessions(device_id,session_id,last_sequence,first_seen_at,last_seen_at)
  VALUES(d.id,p_session_id,p_sequence,now_at,now_at)
  ON CONFLICT(device_id,session_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_seen_at=excluded.last_seen_at;

  UPDATE public.simhub_devices SET last_seen_at=now_at, last_session_id=p_session_id, last_sequence=p_sequence, updated_at=now_at WHERE id=d.id;

  IF e IS NOT NULL THEN
    IF r IS NOT NULL AND NOT baseline THEN
      PERFORM public.simhub_update_strategy_v3(
        r,d.id,p_session_id,p_sequence,e,t,nl,v_fuel,np,v_last_laptime,v_session_laps,
        baseline,s.previous_completed_laps,s.previous_in_pit_lane);

        -- Bandenslijtage hoort bij dezelfde ronde, maar alleen hier is de
        -- payload beschikbaar; de strategiefunctie krijgt losse getallen.
        -- Alleen vullen als het een getal is, anders blijft de kolom leeg.
        IF nl IS NOT NULL THEN
          UPDATE public.endurance_strategy_lap_samples
             SET wear_fl = CASE WHEN (p_v3_normalized->'vehicle'->'frontLeft'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'frontLeft'->>'wearPercent')::numeric END,
                 wear_fr = CASE WHEN (p_v3_normalized->'vehicle'->'frontRight'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'frontRight'->>'wearPercent')::numeric END,
                 wear_rl = CASE WHEN (p_v3_normalized->'vehicle'->'rearLeft'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'rearLeft'->>'wearPercent')::numeric END,
                 wear_rr = CASE WHEN (p_v3_normalized->'vehicle'->'rearRight'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'rearRight'->>'wearPercent')::numeric END
           WHERE race_run_id = r AND completed_laps = nl
             AND wear_fl IS NULL AND wear_fr IS NULL
             AND wear_rl IS NULL AND wear_rr IS NULL;
        END IF;

        -- ------------------------------------------------------------------
        -- S2: de pitvlag-overgang. Alles wat hier gebeurt, gebeurt alleen op
        -- deze flank en nergens anders:
        --   1. de pit_entry/pit_exit-events die er nooit waren. Zonder deze
        --      events blijft pit_loss voor elke toekomstige race null, ook al
        --      staat in_pit_lane straks op de lap-rijen: derive_pit_stops()
        --      rekent met captured_at-verschillen en een stop kan midden in
        --      een ronde beginnen en eindigen.
        --   2. het banden-anker op de EXIT-overgang. Op entry staan de
        --      wear-kanalen nog op de vorige service; pas na de service staan
        --      ze op de staat van de gemonteerde banden. Wie op entry ankert,
        --      schrijft een verouderd getal als meting weg.
        --
        -- Twee harde regels:
        --   * INSERT ... SELECT ... WHERE, nooit INSERT ... VALUES. Ontbreekt
        --     vehicle in de payload (uitgebreide telemetrie uit), dan levert de
        --     WHERE nul rijen en gebeurt er niets. Een VALUES met null in een
        --     not-null-kolom zou een exception geven en daarmee de HELE
        --     snapshot terugdraaien: de coureur verliest dan zijn ronde omdat
        --     wij een anker niet konden schrijven.
        --   * Het hele blok zit in BEGIN ... EXCEPTION WHEN OTHERS THEN NULL.
        --     Een anker is bijzaak, de lap-sample is hoofdzaak. Het stille
        --     falen is detecteerbaar: nul ankers bij wel toenemende
        --     lap-samples betekent dat dit pad stuk is.
        -- ------------------------------------------------------------------
        IF nl IS NOT NULL AND np IS NOT NULL AND np IS DISTINCT FROM s.previous_in_pit_lane THEN
          BEGIN
            IF np IS TRUE THEN
              INSERT INTO public.endurance_telemetry_events(
                device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
                event_detection_source,completed_laps,in_pit_lane,lap,payload,race_run_id)
              SELECT d.id,e,t,p_session_id,'pit_entry','pit_entry:'||p_sequence::text,p_sequence,p_captured_at,
                     'simhub_v3_transition',nl,true,nl,
                     jsonb_build_object('completedLaps',nl,'inPitLane',true),r
               WHERE s.previous_in_pit_lane IS FALSE
              ON CONFLICT DO NOTHING;
            ELSE
              INSERT INTO public.endurance_telemetry_events(
                device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
                event_detection_source,completed_laps,in_pit_lane,lap,payload,race_run_id)
              SELECT d.id,e,t,p_session_id,'pit_exit','pit_exit:'||p_sequence::text,p_sequence,p_captured_at,
                     'simhub_v3_transition',nl,false,nl,
                     jsonb_build_object('completedLaps',nl,'inPitLane',false),r
               WHERE s.previous_in_pit_lane IS TRUE
              ON CONFLICT DO NOTHING;

              -- Payloadvelden één keer inlezen, met dezelfde guard als de
              -- wear-update hierboven: alleen als het een getal is.
              v_anchor_fl := CASE WHEN (p_v3_normalized#>>'{vehicle,frontLeft,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,frontLeft,wearPercent}')::numeric END;
              v_anchor_fr := CASE WHEN (p_v3_normalized#>>'{vehicle,frontRight,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,frontRight,wearPercent}')::numeric END;
              v_anchor_rl := CASE WHEN (p_v3_normalized#>>'{vehicle,rearLeft,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,rearLeft,wearPercent}')::numeric END;
              v_anchor_rr := CASE WHEN (p_v3_normalized#>>'{vehicle,rearRight,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,rearRight,wearPercent}')::numeric END;
              v_zone_fl_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fl,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fl,l}')::numeric END;
              v_zone_fl_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fl,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fl,m}')::numeric END;
              v_zone_fl_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fl,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fl,r}')::numeric END;
              v_zone_fr_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fr,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fr,l}')::numeric END;
              v_zone_fr_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fr,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fr,m}')::numeric END;
              v_zone_fr_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fr,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fr,r}')::numeric END;
              v_zone_rl_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rl,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rl,l}')::numeric END;
              v_zone_rl_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rl,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rl,m}')::numeric END;
              v_zone_rl_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rl,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rl,r}')::numeric END;
              v_zone_rr_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rr,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rr,l}')::numeric END;
              v_zone_rr_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rr,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rr,m}')::numeric END;
              v_zone_rr_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rr,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rr,r}')::numeric END;
              v_anchor_track := CASE WHEN (p_v3_normalized#>>'{tyres,environment,trackTempC}') ~ '^-?[0-9]+([.][0-9]+)?$'
                                     THEN (p_v3_normalized#>>'{tyres,environment,trackTempC}')::numeric END;
              v_anchor_air   := CASE WHEN (p_v3_normalized#>>'{tyres,environment,airTempC}') ~ '^-?[0-9]+([.][0-9]+)?$'
                                     THEN (p_v3_normalized#>>'{tyres,environment,airTempC}')::numeric END;
              v_anchor_rubber := CASE WHEN char_length(btrim(coalesce(p_v3_normalized#>>'{tyres,environment,rubberState}',''))) BETWEEN 1 AND 64
                                      THEN btrim(p_v3_normalized#>>'{tyres,environment,rubberState}') END;
              v_anchor_source := p_v3_normalized#>>'{vehicle,tyreDataMode}';
              v_anchor_sets   := CASE WHEN (p_v3_normalized#>>'{tyres,sets,used}') ~ '^[0-9]+$'
                                      THEN (p_v3_normalized#>>'{tyres,sets,used}')::integer END;

              -- stint_no en tyre_set_no komen uit het vorige anker van DEZELFDE
              -- run, niet uit de lap-samples: de lap-sample heeft geen setbegrip
              -- en fuel_stint_id is aantoonbaar onbetrouwbaar (dezelfde id dekt
              -- 1 tot 36 rondes). Het vorige anker wordt ook meegenomen als het
              -- onbruikbaar is: zo blijft de nummering aaneengesloten en blijft
              -- 'frozen' (identiek aan de vorige momentopname) detecteerbaar.
              INSERT INTO public.endurance_tyre_anchors(
                event_id,team_id,race_run_id,device_id,session_id,stint_no,anchor_lap,
                tyre_set_no,tyre_changed,
                wear_fl,wear_fr,wear_rl,wear_rr,
                wear_fl_l, wear_fl_m, wear_fl_r, wear_fr_l, wear_fr_m, wear_fr_r, wear_rl_l, wear_rl_m, wear_rl_r, wear_rr_l, wear_rr_m, wear_rr_r,
                track_temp_c,air_temp_c,rubber_state,wear_source,wear_frozen,anchor_usable,captured_at)
              SELECT e,t,r,d.id,p_session_id,x.stint_no,nl,
                     x.tyre_set_no,x.tyre_changed,
                     v_anchor_fl,v_anchor_fr,v_anchor_rl,v_anchor_rr,
                     v_zone_fl_l, v_zone_fl_m, v_zone_fl_r, v_zone_fr_l, v_zone_fr_m, v_zone_fr_r, v_zone_rl_l, v_zone_rl_m, v_zone_rl_r, v_zone_rr_l, v_zone_rr_m, v_zone_rr_r,
                     v_anchor_track,v_anchor_air,v_anchor_rubber,
                     CASE WHEN v_anchor_source = 'live' THEN 'live' ELSE 'last_available' END,
                     x.frozen, NOT x.frozen, p_captured_at
                FROM (
                  SELECT coalesce(a.stint_no, 0) + 1 AS stint_no,
                         -- set_no volgt de sim-teller (TireSetsUsed, 0-based), dus 1-based.
                         CASE WHEN v_anchor_sets IS NULL THEN NULL ELSE v_anchor_sets + 1 END AS tyre_set_no,
                         -- null = onbekend (geen teller of geen vorig anker), niet false.
                         CASE WHEN v_anchor_sets IS NULL OR a.tyre_set_no IS NULL THEN NULL
                              ELSE (v_anchor_sets + 1) <> a.tyre_set_no END AS tyre_changed,
                         coalesce(a.wear_fl = v_anchor_fl AND a.wear_fr = v_anchor_fr
                                  AND a.wear_rl = v_anchor_rl AND a.wear_rr = v_anchor_rr, false) AS frozen
                    FROM (SELECT 1) AS dummy
                    LEFT JOIN LATERAL (
                      SELECT prev.stint_no, prev.tyre_set_no,
                             prev.wear_fl, prev.wear_fr, prev.wear_rl, prev.wear_rr
                        FROM public.endurance_tyre_anchors prev
                       WHERE prev.race_run_id = r
                       ORDER BY prev.stint_no DESC
                       LIMIT 1
                    ) AS a ON true
                ) AS x
               WHERE v_anchor_fl IS NOT NULL AND v_anchor_fr IS NOT NULL
                 AND v_anchor_rl IS NOT NULL AND v_anchor_rr IS NOT NULL
                 AND s.previous_in_pit_lane IS TRUE
              ON CONFLICT (race_run_id, stint_no) DO NOTHING;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            -- Een anker is bijzaak. Nooit de snapshot laten klappen.
            NULL;
          END;
        END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT 'accepted'::text, now_at;
END
$function$;

-- Rechten opnieuw zetten: een verse functie erft de ACL van de oude niet.
revoke all on function public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text)
  to service_role;

-- Precies één overload, anders is een aanroep met vijf argumenten ambigu.
do $guard$
declare
  v_overloads integer;
begin
  select count(*) into v_overloads
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  if v_overloads <> 1 then
    raise exception 'simhub_persist_v3 heeft % overloads na rollback (42725)', v_overloads
      using errcode = '42725';
  end if;
end
$guard$;
