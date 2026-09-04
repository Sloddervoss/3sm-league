-- ============================================================================
-- Pitwall 0.4.3 — server-side opponent sampled history + closing-rate trends
-- Additive only. Sampling is UI-independent: runs from simhub-ingest-v3 as each
-- connector snapshot arrives, whether or not any Pitwall browser is open.
-- ============================================================================

-- ~10s sample bucket (deterministic)
CREATE OR REPLACE FUNCTION public.opp_sample_bucket(ts timestamptz)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT floor(extract(epoch FROM ts) / 10)::bigint;
$$;

CREATE TABLE IF NOT EXISTS public.endurance_opponent_gap_samples (
  race_run_id uuid NOT NULL,
  event_id    uuid NOT NULL,
  team_id     uuid NOT NULL,
  device_id   uuid NOT NULL,
  session_id  text NOT NULL,
  opponent_id text NOT NULL,
  sample_bucket bigint NOT NULL,               -- opp_sample_bucket(observed_at)
  observed_at   timestamptz NOT NULL,
  seq           bigint NOT NULL,
  gap_to_player_seconds double precision,
  lap_distance_pct        double precision,
  in_pit                  boolean,
  connected               boolean,
  PRIMARY KEY (race_run_id, opponent_id, sample_bucket)
);

CREATE INDEX IF NOT EXISTS idx_opp_gap_race_observed
  ON public.endurance_opponent_gap_samples (race_run_id, observed_at);

-- Prune >300s (120s trend window + 180s late-arrival headroom)
CREATE OR REPLACE FUNCTION public.prune_opponent_gap_samples()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.endurance_opponent_gap_samples
  WHERE observed_at < clock_timestamp() - interval '300 seconds';
$$;

-- Record one bounded sample per active opponent (10s bucket upsert, no 1Hz dupes)
CREATE OR REPLACE FUNCTION public.record_opponent_gap_samples(
  p_race_run_id uuid, p_event_id uuid, p_team_id uuid, p_device_id uuid,
  p_session_id text, p_seq bigint, p_captured_at timestamptz, p_opponents jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_bucket bigint := public.opp_sample_bucket(p_captured_at);
  v_i int := 0;
  v_opp record;
BEGIN
  IF p_opponents IS NULL OR jsonb_typeof(p_opponents) <> 'array' THEN RETURN; END IF;
  FOR v_opp IN
    SELECT * FROM jsonb_to_recordset(p_opponents) AS o(
      id text, gap_to_player_seconds double precision,
      lap_distance_pct double precision, in_pit boolean, connected boolean)
  LOOP
    IF v_i >= 40 THEN EXIT; END IF;                       -- cap to connector cap
    IF coalesce(v_opp.id, '') = '' THEN CONTINUE; END IF;
    IF v_opp.gap_to_player_seconds IS NULL THEN CONTINUE; END IF; -- require gap
    -- suppress pit-transition contaminated and disconnected samples at write time
    IF coalesce(v_opp.connected, false) IS NOT TRUE THEN CONTINUE; END IF;
    IF coalesce(v_opp.in_pit, false) IS TRUE THEN CONTINUE; END IF;

    INSERT INTO public.endurance_opponent_gap_samples(
      race_run_id, event_id, team_id, device_id, session_id, opponent_id,
      sample_bucket, observed_at, seq, gap_to_player_seconds,
      lap_distance_pct, in_pit, connected)
    VALUES (
      p_race_run_id, p_event_id, p_team_id, p_device_id, p_session_id, v_opp.id,
      v_bucket, p_captured_at, p_seq, v_opp.gap_to_player_seconds,
      v_opp.lap_distance_pct, false, true)
    ON CONFLICT (race_run_id, opponent_id, sample_bucket) DO NOTHING;
    v_i := v_i + 1;
  END LOOP;
  PERFORM public.prune_opponent_gap_samples();
END;
$$;

REVOKE ALL ON FUNCTION public.record_opponent_gap_samples
  (uuid,uuid,uuid,uuid,text,bigint,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_opponent_gap_samples
  (uuid,uuid,uuid,uuid,text,bigint,timestamptz,jsonb) TO service_role;

-- ============================================================================
-- Closing-rate per opponent for a race_run. UI unit: seconds of gap change per minute.
-- SIGN: gap > 0 => opponent BEHIND; gap < 0 => AHEAD (relative to player).
--   closing_rate_s_per_min > 0 => opponent is CLOSING on the player
--   closing_rate_s_per_min < 0 => opponent is OPENING / pulling away
-- Formula: PostgreSQL regr_slope(gap_seconds, time_seconds)=Δgap/Δtime, negated and
--   x60. A shrinking gap (slope<0) means the opponent is closing => positive result.
--   Requires >= 3 samples in the eligible (latest 120s) window; slower => not emitted.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pitwall_opponent_trends_v1(p_race_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH per_opp AS (
    SELECT opponent_id,
           count(*) AS n,
           round((-60 * regr_slope(gap_to_player_seconds, e_time))::numeric, 2) AS closing_rate_s_per_min
    FROM (
      SELECT opponent_id, extract(epoch FROM observed_at) AS e_time, gap_to_player_seconds
      FROM public.endurance_opponent_gap_samples
      WHERE race_run_id = p_race_run_id
        AND observed_at >= clock_timestamp() - interval '120 seconds'
        AND gap_to_player_seconds IS NOT NULL
    ) s
    GROUP BY opponent_id
    HAVING count(*) >= 3
  )
  SELECT coalesce(jsonb_object_agg(
    opponent_id,
    jsonb_build_object(
      'closing_rate_s_per_min', closing_rate_s_per_min,
      'sample_count', n,
      'window_seconds', 60
    )
  ), '{}'::jsonb)
  FROM per_opp;
$$;
REVOKE ALL ON FUNCTION public.pitwall_opponent_trends_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_opponent_trends_v1(uuid) TO service_role;

-- allow get_pitwall_data (service_role path) to call it
GRANT EXECUTE ON FUNCTION public.pitwall_opponent_trends_v1(uuid) TO service_role;

COMMENT ON TABLE public.endurance_opponent_gap_samples
  IS '0.4.3 server-side opponent gap samples (10s/opponent, UI-independent)';