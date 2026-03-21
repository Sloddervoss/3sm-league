-- =============================================================================
-- 3STRIPE RATING (3SR) — RECALCULATION FUNCTIONS
-- =============================================================================
-- Stap 2 van 2: recalculate_3sr_for_race + recalculate_3sr_all
-- =============================================================================
-- Gebruik:
--   SELECT recalculate_3sr_for_race('race-uuid');  -- na race import
--   SELECT recalculate_3sr_all();                  -- backfill / bulk correctie
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: rank label bepalen op basis van score + aantal races
-- -----------------------------------------------------------------------------
-- Thresholds (SUM van beste 8 races, max ~960):
--   < 5 races             → NULL (unranked)
--   0   – 199             → Rookie
--   200 – 374             → Stripe 3
--   375 – 549             → Stripe 2
--   550 – 699             → Stripe 1
--   700 – 799             → Elite Stripe
--   800 – 899             → Pro Stripe
--   900+ EN >= 12 races   → Legend Stripe
--   900+ maar < 12 races  → Pro Stripe (gate nog niet bereikt)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _3sr_rank_label(
  p_score       numeric,
  p_race_count  int
) RETURNS text
  LANGUAGE sql
  IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_race_count < 5                              THEN NULL
    WHEN p_score >= 900 AND p_race_count >= 12         THEN 'Legend Stripe'
    WHEN p_score >= 800                                THEN 'Pro Stripe'
    WHEN p_score >= 700                                THEN 'Elite Stripe'
    WHEN p_score >= 550                                THEN 'Stripe 1'
    WHEN p_score >= 375                                THEN 'Stripe 2'
    WHEN p_score >= 200                                THEN 'Stripe 3'
    ELSE                                                    'Rookie'
  END
$$;

-- -----------------------------------------------------------------------------
-- recalculate_3sr_for_race(race_id)
-- -----------------------------------------------------------------------------
-- Herberekent 3SR voor alle rijders in één race.
-- Flow:
--   1. Eligibility check (counts_for_3sr + min. 5 finishers)
--   2. UPSERT race_3sr_results voor alle starters
--   3. UPSERT driver_3sr voor alle betrokken rijders
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION recalculate_3sr_for_race(p_race_id uuid)
RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_eligible       boolean;
  v_finisher_count int;
  v_uid            uuid;
  v_affected_users uuid[];
  v_score          numeric(6,2);
  v_race_count     int;
BEGIN

  -- 1a. Bestaat de race en is counts_for_3sr = true?
  SELECT counts_for_3sr INTO v_eligible
  FROM races WHERE id = p_race_id;

  IF v_eligible IS NULL OR v_eligible = false THEN
    -- Verwijder eventueel al berekende resultaten en stop
    DELETE FROM race_3sr_results WHERE race_id = p_race_id;
    RETURN;
  END IF;

  -- 1b. Minimaal 5 geldige finishers (niet-DNF)
  SELECT COUNT(*) INTO v_finisher_count
  FROM race_results
  WHERE race_id = p_race_id
    AND (dnf IS NULL OR dnf = false);

  IF v_finisher_count < 5 THEN
    DELETE FROM race_3sr_results WHERE race_id = p_race_id;
    RETURN;
  END IF;

  -- 1c. Verzamel betrokken rijders
  SELECT ARRAY_AGG(user_id) INTO v_affected_users
  FROM race_results
  WHERE race_id = p_race_id;

  -- 2. Bereken en sla race_3sr_results op
  --
  -- irating_snapshot: gebruik snapshot op race_results als beschikbaar,
  -- anders val terug op profiles.irating (huidige iRating).
  -- Als geen iRating beschikbaar: performance_bonus = 0.
  --
  -- position_score: genormaliseerd op GREATEST(finishers-1, 9)
  -- zodat kleine grids (< 10 auto's) dezelfde schaal gebruiken als 10-auto grids.
  --
  -- performance_bonus: multiplier ×2, cap ±20
  -- delta = expected_position - effective_position (positief = overperform)
  --
  -- race_score: 0 bij DNF, anders MAX(0, position_score + bonus - penalty)

  WITH
  starters AS (
    SELECT
      rr.user_id,
      rr.position,
      COALESCE(rr.dnf, false)                                   AS dnf,
      COALESCE(rr.irating_snapshot, pr.irating)                 AS irating_val,
      -- Finishers = rijders die NIET DNF zijn
      COUNT(*) FILTER (WHERE NOT COALESCE(rr.dnf, false))
        OVER (PARTITION BY rr.race_id)                          AS finisher_count
    FROM race_results rr
    LEFT JOIN profiles pr ON pr.user_id = rr.user_id
    WHERE rr.race_id = p_race_id
  ),
  ranked AS (
    SELECT
      s.*,
      -- iRating rank: hoogste iRating = rank 1 (verwachte winnaar)
      RANK() OVER (
        ORDER BY COALESCE(s.irating_val, 0) DESC NULLS LAST
      )                                                         AS irating_rank,
      -- Effectieve positie: DNF rijders scoren als finishers+1
      CASE
        WHEN s.dnf THEN s.finisher_count + 1
        ELSE s.position
      END                                                       AS effective_position
    FROM starters s
  ),
  scored AS (
    SELECT
      r.*,
      r.irating_rank                                            AS expected_position,
      r.irating_rank - r.effective_position                     AS delta,
      -- Position score: genormaliseerd op min. 10-auto schaal
      GREATEST(0::numeric, ROUND(
        100.0 * (1.0 - (r.effective_position - 1.0)
          / NULLIF(GREATEST(r.finisher_count - 1, 9), 0)
        ), 2
      ))                                                        AS position_score,
      -- Performance bonus: 0 als geen iRating beschikbaar
      CASE
        WHEN r.irating_val IS NULL THEN 0::numeric
        ELSE GREATEST(-20::numeric, LEAST(20::numeric,
          ROUND((r.irating_rank - r.effective_position) * 2.0, 2)
        ))
      END                                                       AS performance_bonus,
      -- Penalty: gebruik points_deduction uit penalties tabel
      COALESCE(pen.points_deduction, 0)                        AS penalty_deduction
    FROM ranked r
    LEFT JOIN penalties pen
      ON pen.race_id = p_race_id
      AND pen.user_id = r.user_id
  )
  INSERT INTO race_3sr_results (
    race_id, user_id,
    position, effective_position, finishers, dnf,
    irating_snapshot, irating_rank, expected_position, delta,
    position_score, performance_bonus, penalty_deduction, race_score,
    calculated_at
  )
  SELECT
    p_race_id,
    s.user_id,
    s.position,
    s.effective_position,
    s.finisher_count,
    s.dnf,
    s.irating_val,
    s.irating_rank,
    s.expected_position,
    s.delta,
    s.position_score,
    s.performance_bonus,
    s.penalty_deduction,
    -- race_score: 0 bij DNF, anders max(0, som van componenten)
    CASE
      WHEN s.dnf THEN 0::numeric
      ELSE GREATEST(0::numeric,
        s.position_score + s.performance_bonus - s.penalty_deduction
      )
    END                                                         AS race_score,
    now()
  FROM scored s
  ON CONFLICT (race_id, user_id) DO UPDATE SET
    position           = EXCLUDED.position,
    effective_position = EXCLUDED.effective_position,
    finishers          = EXCLUDED.finishers,
    dnf                = EXCLUDED.dnf,
    irating_snapshot   = EXCLUDED.irating_snapshot,
    irating_rank       = EXCLUDED.irating_rank,
    expected_position  = EXCLUDED.expected_position,
    delta              = EXCLUDED.delta,
    position_score     = EXCLUDED.position_score,
    performance_bonus  = EXCLUDED.performance_bonus,
    penalty_deduction  = EXCLUDED.penalty_deduction,
    race_score         = EXCLUDED.race_score,
    calculated_at      = EXCLUDED.calculated_at;

  -- 3. Update driver_3sr voor elke betrokken rijder
  FOREACH v_uid IN ARRAY v_affected_users LOOP

    -- Bereken score + race count in één subquery
    SELECT
      COALESCE((
        SELECT SUM(race_score)
        FROM (
          SELECT race_score
          FROM race_3sr_results
          WHERE user_id = v_uid
          ORDER BY race_score DESC
          LIMIT 8
        ) best8
      ), 0),
      (SELECT COUNT(*)::int FROM race_3sr_results WHERE user_id = v_uid)
    INTO v_score, v_race_count;

    INSERT INTO driver_3sr (user_id, current_score, ranked_races, is_ranked, rank_label, last_updated)
    VALUES (
      v_uid,
      v_score,
      v_race_count,
      v_race_count >= 5,
      _3sr_rank_label(v_score, v_race_count),
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      current_score = EXCLUDED.current_score,
      ranked_races  = EXCLUDED.ranked_races,
      is_ranked     = EXCLUDED.is_ranked,
      rank_label    = EXCLUDED.rank_label,
      last_updated  = EXCLUDED.last_updated;

  END LOOP;

END;
$$;

-- -----------------------------------------------------------------------------
-- recalculate_3sr_all()
-- -----------------------------------------------------------------------------
-- Herberekent 3SR voor ALLE races met counts_for_3sr = true.
-- Gebruik alleen voor backfill of bulk correctie.
-- Verwerkt races in chronologische volgorde.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION recalculate_3sr_all()
RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_race_id uuid;
BEGIN
  FOR v_race_id IN
    SELECT id FROM races
    WHERE counts_for_3sr = true
    ORDER BY race_date ASC
  LOOP
    PERFORM recalculate_3sr_for_race(v_race_id);
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- Rechten: functies zijn SECURITY DEFINER zodat de recalculation
-- altijd kan schrijven naar race_3sr_results en driver_3sr,
-- ook als de aanroeper geen admin is (bijv. edge function).
-- Aanroepen via RPC is alleen mogelijk voor admins/super_admin.
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION recalculate_3sr_for_race(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION recalculate_3sr_all()           FROM PUBLIC;

GRANT EXECUTE ON FUNCTION recalculate_3sr_for_race(uuid)
  TO authenticated;  -- RLS op de tabellen beperkt wie écht kan aanroepen

GRANT EXECUTE ON FUNCTION recalculate_3sr_all()
  TO authenticated;
