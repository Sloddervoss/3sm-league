-- =============================================================================
-- 3STRIPE RATING (3SR) — SCHEMA
-- =============================================================================
-- Stap 1 van 2: tabellen, kolommen, indexes, view, RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Uitbreidingen op bestaande tabellen
-- -----------------------------------------------------------------------------

-- races: markeer welke races meetellen voor 3SR
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS counts_for_3sr boolean NOT NULL DEFAULT false;

-- race_results: iRating snapshot op het moment van de race
-- (profiles.irating is de huidige iRating, dit is de snapshot bij de race)
ALTER TABLE race_results
  ADD COLUMN IF NOT EXISTS irating_snapshot int;

-- -----------------------------------------------------------------------------
-- 2. race_3sr_results — per-race 3SR scores (materialized)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS race_3sr_results (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id            uuid        NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  user_id            uuid        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,

  -- Finish data
  position           int         NOT NULL,
  effective_position int         NOT NULL,   -- = finishers+1 bij DNF
  finishers          int         NOT NULL,   -- aantal non-DNF rijders
  dnf                boolean     NOT NULL DEFAULT false,

  -- iRating debug
  irating_snapshot   int,                   -- NULL = niet beschikbaar (bonus = 0)
  irating_rank       int,                   -- rank van iRating in dit veld (1 = hoogste)
  expected_position  int,                   -- = irating_rank
  delta              int,                   -- expected_position - effective_position

  -- Score components (los zichtbaar voor troubleshooting)
  position_score     numeric(6,2) NOT NULL,
  performance_bonus  numeric(6,2) NOT NULL DEFAULT 0,
  penalty_deduction  numeric(6,2) NOT NULL DEFAULT 0,
  race_score         numeric(6,2) NOT NULL,  -- 0 bij DNF, anders MAX(0, som)

  calculated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (race_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 3. driver_3sr — geaggregeerde rating per rijder
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS driver_3sr (
  user_id        uuid         PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  current_score  numeric(6,2) NOT NULL DEFAULT 0,   -- SUM van beste 8 races
  ranked_races   int          NOT NULL DEFAULT 0,   -- totaal 3SR races gereden
  is_ranked      boolean      NOT NULL DEFAULT false, -- true als >= 5 races
  rank_label     text,                               -- NULL = unranked
  last_updated   timestamptz  NOT NULL DEFAULT now()
);

-- rank_label waarden:
-- NULL (< 5 races), 'Rookie', 'Stripe 3', 'Stripe 2', 'Stripe 1',
-- 'Elite Stripe', 'Pro Stripe', 'Legend Stripe'

-- -----------------------------------------------------------------------------
-- 4. Indexes
-- -----------------------------------------------------------------------------

-- race_3sr_results: lookup per race en per rijder
CREATE INDEX IF NOT EXISTS idx_3sr_results_race
  ON race_3sr_results (race_id);

CREATE INDEX IF NOT EXISTS idx_3sr_results_user
  ON race_3sr_results (user_id);

-- Covering index voor "beste 8" aggregatie (meest gebruikte query)
CREATE INDEX IF NOT EXISTS idx_3sr_results_user_score
  ON race_3sr_results (user_id, race_score DESC);

-- driver_3sr: leaderboard sortering (alleen gerankte rijders)
CREATE INDEX IF NOT EXISTS idx_driver_3sr_score
  ON driver_3sr (current_score DESC)
  WHERE is_ranked = true;

CREATE INDEX IF NOT EXISTS idx_driver_3sr_label
  ON driver_3sr (rank_label);

-- race_results: recalculation lookup (covering index, geen extra heap fetch)
CREATE INDEX IF NOT EXISTS idx_race_results_race_user_3sr
  ON race_results (race_id, user_id)
  INCLUDE (position, irating_snapshot, dnf);

-- penalties: lookup tijdens recalculation
CREATE INDEX IF NOT EXISTS idx_penalties_race_user
  ON penalties (race_id, user_id);

-- -----------------------------------------------------------------------------
-- 5. Admin eligibility view
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_3sr_race_eligibility AS
SELECT
  r.id                                                                    AS race_id,
  r.name,
  r.race_date,
  r.counts_for_3sr,
  COUNT(rr.id)                                                            AS total_starters,
  COUNT(rr.id) FILTER (WHERE NOT COALESCE(rr.dnf, false))                AS valid_finishers,
  COUNT(rr.id) FILTER (WHERE rr.dnf = true)                              AS dnf_count,
  COUNT(rr.id) FILTER (WHERE rr.irating_snapshot IS NOT NULL)            AS with_irating,
  CASE
    WHEN r.counts_for_3sr = false
      THEN 'not_flagged'
    WHEN COUNT(rr.id) FILTER (WHERE NOT COALESCE(rr.dnf, false)) < 5
      THEN 'too_few_finishers'
    ELSE 'eligible'
  END                                                                     AS eligibility_status,
  EXISTS (
    SELECT 1 FROM race_3sr_results x WHERE x.race_id = r.id
  )                                                                       AS has_3sr_results
FROM races r
LEFT JOIN race_results rr ON rr.race_id = r.id
GROUP BY r.id, r.name, r.race_date, r.counts_for_3sr;

-- -----------------------------------------------------------------------------
-- 6. RLS
-- -----------------------------------------------------------------------------

ALTER TABLE race_3sr_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_3sr       ENABLE ROW LEVEL SECURITY;

-- Iedereen kan 3SR data lezen
CREATE POLICY "3sr_results_read_all"
  ON race_3sr_results FOR SELECT
  USING (true);

CREATE POLICY "driver_3sr_read_all"
  ON driver_3sr FOR SELECT
  USING (true);

-- Alleen admins/super_admin kunnen schrijven (recalculation functies draaien als SECURITY DEFINER)
CREATE POLICY "3sr_results_admin_write"
  ON race_3sr_results FOR ALL
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "driver_3sr_admin_write"
  ON driver_3sr FOR ALL
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));
