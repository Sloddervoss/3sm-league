BEGIN;

-- Private shadow only. No serving RPC and no dependency from the race strategy.
CREATE TABLE pitwall_learning.tyre_shadow_exit (
  exit_id bigint PRIMARY KEY REFERENCES public.simhub_tyre_observations(id) ON DELETE CASCADE,
  ready_at timestamptz NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  device_id uuid NOT NULL,
  transport text NOT NULL,
  frame_seq bigint NOT NULL,
  scope jsonb NOT NULL,
  policy_version integer NOT NULL,
  lap integer,
  measured_at timestamptz,
  wear numeric[],
  set_anchor_id bigint,
  corner_sets integer[],
  actual_rate numeric[],
  forecast_rate numeric[],
  issued_at timestamptz,
  absolute_error numeric[],
  outcome text,
  UNIQUE (device_id,transport,frame_seq)
);
CREATE INDEX tyre_shadow_exit_pending ON pitwall_learning.tyre_shadow_exit(ready_at,exit_id) WHERE NOT processed;
CREATE INDEX tyre_shadow_exit_history ON pitwall_learning.tyre_shadow_exit(device_id,transport,frame_seq DESC);
CREATE INDEX tyre_shadow_exit_fit ON pitwall_learning.tyre_shadow_exit(device_id,measured_at DESC) WHERE actual_rate IS NOT NULL;
ALTER TABLE pitwall_learning.tyre_shadow_exit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pitwall_learning.tyre_shadow_exit FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pitwall_learning.tyre_shadow_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pitwall_learning, pg_temp AS $$
DECLARE proof jsonb := NEW.raw->'shadowRaceV1'; prev boolean; policy integer;
BEGIN
  IF NEW.on_pit_road IS DISTINCT FROM false OR proof IS NULL OR proof->>'inCar' IS DISTINCT FROM 'true' THEN RETURN NEW; END IF;
  SELECT o.on_pit_road INTO prev FROM public.simhub_tyre_observations o
   WHERE o.device_id=NEW.device_id AND o.session_key=NEW.session_key AND o.frame_sequence<NEW.frame_sequence
   ORDER BY o.frame_sequence DESC LIMIT 1;
  IF prev IS DISTINCT FROM true THEN RETURN NEW; END IF;
  SELECT a.policy_version INTO policy FROM public.simhub_devices d
   JOIN pitwall_learning.account_policy a ON a.owner_user_id=d.owner_user_id
   JOIN pitwall_learning.runtime_settings s ON s.id=1
   WHERE d.id=NEW.device_id AND d.owner_user_id::text=proof->>'owner' AND d.revoked_at IS NULL
     AND (d.expires_at IS NULL OR d.expires_at>clock_timestamp())
     AND a.capture_enabled AND a.personal_fit_enabled AND s.capture_enabled;
  IF policy IS NOT NULL THEN
    INSERT INTO pitwall_learning.tyre_shadow_exit(exit_id,ready_at,device_id,transport,frame_seq,scope,policy_version)
    VALUES(NEW.id,clock_timestamp()+interval '10 minutes',NEW.device_id,NEW.session_key,NEW.frame_sequence,proof-ARRAY['capturedAt','inCar'],policy)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Shadow bookkeeping must not break telemetry. Do not log payloads or identifiers.
  RAISE WARNING 'tyre shadow enqueue skipped'; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION pitwall_learning.tyre_shadow_enqueue() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tyre_shadow_enqueue AFTER INSERT ON public.simhub_tyre_observations
 FOR EACH ROW WHEN (NEW.on_pit_road IS FALSE AND NEW.raw ? 'shadowRaceV1') EXECUTE FUNCTION pitwall_learning.tyre_shadow_enqueue();

CREATE FUNCTION pitwall_learning.tyre_shadow_drain(p_limit integer DEFAULT 20) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pitwall_learning, pg_temp AS $$
DECLARE
  q pitwall_learning.tyre_shadow_exit%ROWTYPE; last_exit pitwall_learning.tyre_shadow_exit%ROWTYPE;
  e public.simhub_tyre_observations%ROWTYPE; start_frame public.simhub_tyre_observations%ROWTYPE;
  w public.simhub_tyre_observations%ROWTYPE; begin_seq bigint;
  answer text; dist integer; done integer := 0; n_clean integer; n_all integer; n_rows integer; set_anchor bigint;
  measured numeric[]; corners integer[]; rate numeric[]; prediction numeric[]; errors numeric[]; reason text;
  contexts integer; issued timestamptz;
BEGIN
  IF NOT pg_try_advisory_xact_lock(137113, 6125) THEN RETURN 0; END IF;
  DELETE FROM pitwall_learning.tyre_shadow_exit WHERE ready_at < now()-interval '30 days';
  FOR q IN SELECT * FROM pitwall_learning.tyre_shadow_exit
    WHERE NOT processed AND ready_at<=clock_timestamp() ORDER BY ready_at,exit_id LIMIT greatest(0,least(coalesce(p_limit,0),50))
  LOOP
    reason := NULL; measured := NULL; corners := NULL; rate := NULL; prediction := NULL; errors := NULL; answer := NULL; issued := NULL; set_anchor := NULL;
    SELECT * INTO e FROM public.simhub_tyre_observations WHERE id=q.exit_id;
    SELECT * INTO last_exit FROM pitwall_learning.tyre_shadow_exit
      WHERE device_id=q.device_id AND transport=q.transport AND frame_seq<q.frame_seq AND processed
      ORDER BY frame_seq DESC LIMIT 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.simhub_devices d JOIN pitwall_learning.account_policy a USING(owner_user_id)
      JOIN pitwall_learning.runtime_settings s ON s.id=1
      WHERE d.id=q.device_id AND d.revoked_at IS NULL AND (d.expires_at IS NULL OR d.expires_at>clock_timestamp())
        AND a.owner_user_id::text=q.scope->>'owner' AND a.capture_enabled AND a.personal_fit_enabled AND s.capture_enabled
        AND a.policy_version=q.policy_version AND greatest(a.created_at,a.updated_at)<e.received_at
    ) THEN reason := 'policy'; END IF;
    -- Any explicit non-pit / unknown sample ends the backwards search. The immediate
    -- predecessor must be a known on-track sample before the first pit observation.
    IF reason IS NULL THEN
      SELECT max(o.frame_sequence) INTO begin_seq FROM public.simhub_tyre_observations o
       WHERE o.device_id=q.device_id AND o.session_key=q.transport AND o.frame_sequence<q.frame_seq AND o.on_pit_road IS DISTINCT FROM true;
      IF begin_seq IS NULL THEN reason:='missing_entry';
      ELSE
        SELECT * INTO start_frame FROM public.simhub_tyre_observations o WHERE o.device_id=q.device_id AND o.session_key=q.transport
         AND o.frame_sequence>begin_seq AND o.frame_sequence<q.frame_seq ORDER BY o.frame_sequence LIMIT 1;
        IF start_frame.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.simhub_tyre_observations o
          WHERE o.device_id=q.device_id AND o.session_key=q.transport AND o.frame_sequence=begin_seq AND o.on_pit_road IS FALSE
            AND (o.raw->'shadowRaceV1')-ARRAY['capturedAt','inCar']=q.scope AND o.endurance_event_id IS NOT DISTINCT FROM e.endurance_event_id
            AND o.endurance_team_id IS NOT DISTINCT FROM e.endurance_team_id
            AND start_frame.session_time_seconds-o.session_time_seconds BETWEEN 0 AND 45)
          OR NOT coalesce(e.session_time_seconds-start_frame.session_time_seconds BETWEEN 1 AND 600,false)
          OR EXISTS (SELECT 1 FROM public.simhub_tyre_observations o WHERE o.device_id=q.device_id AND o.session_key=q.transport
            AND o.frame_sequence>begin_seq AND o.frame_sequence<=q.frame_seq AND
            ((o.raw->'shadowRaceV1')-ARRAY['capturedAt','inCar'] IS DISTINCT FROM q.scope OR o.raw#>>'{shadowRaceV1,inCar}' IS DISTINCT FROM 'true'
             OR o.endurance_event_id IS DISTINCT FROM e.endurance_event_id OR o.endurance_team_id IS DISTINCT FROM e.endurance_team_id))
        THEN reason:='visit_discontinuity'; END IF;
      END IF;
    END IF;
    IF reason IS NULL THEN
      SELECT a.answer INTO answer FROM public.simhub_tyre_stop_anchors a WHERE a.device_id=q.device_id AND a.session_key=q.transport
        AND a.visit_first_seq=start_frame.frame_sequence AND a.answered_at<=q.ready_at
        AND a.endurance_event_id IS NOT DISTINCT FROM e.endurance_event_id AND a.endurance_team_id IS NOT DISTINCT FROM e.endurance_team_id;
      IF answer IS NULL OR answer NOT IN ('tyres','both','fuel','none') THEN reason:='unconfirmed_stop'; END IF;
    END IF;
    IF reason IS NULL THEN
      -- Use the exit's carried refresh (not the stale pitEntry snapshot or a generic
      -- heartbeat). The measurement must have first appeared inside this visit.
      SELECT * INTO w FROM public.simhub_tyre_observations o WHERE o.device_id=q.device_id AND o.session_key=q.transport
        AND o.frame_sequence>start_frame.frame_sequence AND o.frame_sequence<=q.frame_seq
        AND o.observed_at=e.observed_at AND o.trigger='sim_refresh'
        AND o.observed_at>(start_frame.raw#>>'{shadowRaceV1,capturedAt}')::timestamptz
        AND abs(extract(epoch FROM (o.observed_at-(o.raw#>>'{shadowRaceV1,capturedAt}')::timestamptz)))<=5
        AND o.observed_at<=o.received_at AND o.received_at<=e.received_at
        AND num_nonnulls(o.wear_fl,o.wear_fr,o.wear_rl,o.wear_rr)=4
        AND o.lap=e.lap
        AND ARRAY[o.wear_fl,o.wear_fr,o.wear_rl,o.wear_rr]=ARRAY[e.wear_fl,e.wear_fr,e.wear_rl,e.wear_rr]
        ORDER BY o.frame_sequence LIMIT 1;
      IF w.id IS NULL OR w.lap IS NULL THEN reason:='missing_fresh_wear';
      ELSE measured:=ARRAY[w.wear_fl,w.wear_fr,w.wear_rl,w.wear_rr];
        corners:=ARRAY[w.set_fl,w.set_fr,w.set_rl,w.set_rr]; END IF;
    END IF;
    IF reason IS NULL THEN
      reason := CASE WHEN answer IN ('tyres','both') THEN 'confirmed_set_boundary' ELSE 'unproven_interval' END;
      IF answer IN ('tyres','both') THEN set_anchor:=q.exit_id; END IF;
      dist:=w.lap-last_exit.lap;
      IF answer IN ('fuel','none') AND last_exit.wear IS NOT NULL AND last_exit.set_anchor_id IS NOT NULL AND last_exit.scope=q.scope
         AND last_exit.policy_version=q.policy_version AND dist BETWEEN 8 AND 100 AND w.observed_at>last_exit.measured_at
         AND NOT EXISTS (SELECT 1 FROM public.simhub_tyre_observations o WHERE o.device_id=q.device_id AND o.session_key=q.transport
            AND o.frame_sequence>last_exit.frame_seq AND o.frame_sequence<=q.frame_seq AND
            ((o.raw->'shadowRaceV1')-ARRAY['capturedAt','inCar'] IS DISTINCT FROM q.scope OR o.raw#>>'{shadowRaceV1,inCar}' IS DISTINCT FROM 'true'
             OR o.endurance_event_id IS DISTINCT FROM e.endurance_event_id OR o.endurance_team_id IS DISTINCT FROM e.endurance_team_id
             OR o.on_pit_road IS NULL OR (o.on_pit_road AND o.frame_sequence<start_frame.frame_sequence)))
      THEN
        SELECT count(DISTINCT l.lap_number), count(*), count(*) FILTER (WHERE l.complete IS TRUE AND l.driver_changed IS FALSE
           AND l.pit_lap IS FALSE AND coalesce(cardinality(l.invalid_reasons),0)=0)
          INTO n_all,n_rows,n_clean FROM public.simhub_lap_summaries l
         WHERE l.device_id=q.device_id::text AND l.delivered_session_id=q.transport AND l.observed_session_id=q.scope->>'race'
           AND l.lap_number>last_exit.lap AND l.lap_number<w.lap
           AND l.started_at>last_exit.measured_at AND l.ended_at<w.observed_at;
        IF n_all<>dist-1 OR n_rows<>dist-1 OR n_clean<>dist-1 THEN reason:='lap_coverage';
        ELSIF EXISTS(SELECT FROM generate_series(1,4) i WHERE measured[i]>last_exit.wear[i] OR (last_exit.wear[i]-measured[i])/dist>5
          OR (corners[i] IS NOT NULL AND last_exit.corner_sets[i] IS NOT NULL AND corners[i]<>last_exit.corner_sets[i])) THEN
          reason:='wear_discontinuity'; measured:=NULL;
        ELSE
          rate:=ARRAY(SELECT (last_exit.wear[i]-measured[i])/dist FROM generate_series(1,4) i);
          reason:='qualified'; set_anchor:=last_exit.set_anchor_id;
          -- Score only a frozen forecast which existed before this refresh. Never backdate.
          IF last_exit.issued_at < w.observed_at AND last_exit.forecast_rate IS NOT NULL THEN
            errors:=ARRAY(SELECT abs(last_exit.forecast_rate[i]-rate[i]) FROM generate_series(1,4) i);
          END IF;
        END IF;
      END IF;
      IF set_anchor IS NOT NULL THEN
        -- Fit only from previous labels (including a label just scored); no pooled data.
        WITH basis AS (
          SELECT x.actual_rate AS r,x.scope->>'race' AS race FROM pitwall_learning.tyre_shadow_exit x
           WHERE x.device_id=q.device_id AND x.policy_version=q.policy_version AND x.processed
             AND x.scope-'race'=q.scope-'race' AND x.actual_rate IS NOT NULL AND x.measured_at<w.observed_at
           ORDER BY x.measured_at DESC LIMIT 30
        ), rates AS (SELECT * FROM basis UNION ALL SELECT rate,q.scope->>'race' WHERE rate IS NOT NULL)
        SELECT count(DISTINCT race), ARRAY[percentile_cont(.5) within group(order by r[1]),percentile_cont(.5) within group(order by r[2]),
          percentile_cont(.5) within group(order by r[3]),percentile_cont(.5) within group(order by r[4])]::numeric[]
          INTO contexts,prediction FROM rates HAVING count(*)>=3;
        IF contexts>=2 THEN issued:=clock_timestamp(); ELSE prediction:=NULL; END IF;
      END IF;
    END IF;
    UPDATE pitwall_learning.tyre_shadow_exit SET processed=true,outcome=reason,wear=measured,set_anchor_id=set_anchor,corner_sets=CASE WHEN measured IS NOT NULL THEN corners END,
      lap=CASE WHEN measured IS NOT NULL THEN w.lap END,measured_at=CASE WHEN measured IS NOT NULL THEN w.observed_at END,
      actual_rate=rate,forecast_rate=prediction,issued_at=issued,absolute_error=errors WHERE exit_id=q.exit_id;
    done:=done+1;
  END LOOP;
  RETURN done;
END $$;
REVOKE ALL ON FUNCTION pitwall_learning.tyre_shadow_drain(integer) FROM PUBLIC, anon, authenticated, service_role;

-- Shadow requires explicit operator activation of its scheduler after the edge
-- provenance writer is placed and the live preflight passes. No cron on apply.
COMMIT;
