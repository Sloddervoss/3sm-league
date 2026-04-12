-- ── Strafpunten systeem — penalties uitbreiden ───────────────────────────────

-- league_id: scope van de straf (null = losse race pool, ingevuld = seizoen pool)
ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS league_id UUID REFERENCES public.leagues(id) ON DELETE SET NULL;

-- penalty_sp: hoeveel strafpunten deze straf oplevert (vervalt na 6 gereden races in context)
ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS penalty_sp INTEGER NOT NULL DEFAULT 0;

-- penalty_category: A (licht) / B (matig) / C (ernstig) / D (zwaar)
ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS penalty_category TEXT CHECK (penalty_category IN ('A', 'B', 'C', 'D'));

-- grid_penalty_places: aantal plaatsen gridstraf
ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS grid_penalty_places INTEGER NOT NULL DEFAULT 0;

-- race_ban_next: driver mist de volgende race
ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS race_ban_next BOOLEAN NOT NULL DEFAULT false;

-- steward_initiated: straf direct door steward gegeven, zonder protest
ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS steward_initiated BOOLEAN NOT NULL DEFAULT false;

-- steward_description: verplichte motivatie bij steward-initiated straffen
ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS steward_description TEXT;

-- time_penalty_seconds bestaat al (DEFAULT 0) — geen actie nodig

-- Uitbreiden penalty_type constraint met grid_penalty en race_ban
ALTER TABLE public.penalties
  DROP CONSTRAINT IF EXISTS penalties_penalty_type_check;

ALTER TABLE public.penalties
  ADD CONSTRAINT penalties_penalty_type_check
  CHECK (penalty_type IN (
    'time_penalty',
    'points_deduction',
    'warning',
    'disqualification',
    'abandon',
    'grid_penalty',
    'race_ban'
  ));

-- ── protests tabel uitbreiden ─────────────────────────────────────────────────

-- penalty_category op het protest zelf (voor transparantie in Discord)
ALTER TABLE public.protests
  ADD COLUMN IF NOT EXISTS penalty_category TEXT CHECK (penalty_category IN ('A', 'B', 'C', 'D'));

-- time_penalty_seconds op het protest (voor Discord melding)
ALTER TABLE public.protests
  ADD COLUMN IF NOT EXISTS time_penalty_seconds INTEGER;

-- grid_penalty_places op het protest (voor Discord melding)
ALTER TABLE public.protests
  ADD COLUMN IF NOT EXISTS grid_penalty_places INTEGER;

-- race_ban_next op het protest (voor Discord melding)
ALTER TABLE public.protests
  ADD COLUMN IF NOT EXISTS race_ban_next BOOLEAN NOT NULL DEFAULT false;

-- Uitbreiden protests penalty_type constraint
ALTER TABLE public.protests
  DROP CONSTRAINT IF EXISTS protests_penalty_type_check;

ALTER TABLE public.protests
  ADD CONSTRAINT protests_penalty_type_check
  CHECK (penalty_type IN (
    'warning',
    'points_deduction',
    'disqualification',
    'time_penalty',
    'grid_penalty',
    'race_ban'
  ));

-- ── Functie: huidig SP totaal per driver per context ─────────────────────────
-- Strafpunten vervallen na de 6 meest recente races die de driver gereden heeft
-- in dezelfde context (league_id of null voor losse races).

CREATE OR REPLACE FUNCTION public.get_driver_sp(
  p_user_id UUID,
  p_league_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sp INTEGER;
BEGIN
  SELECT COALESCE(SUM(pen.penalty_sp), 0)
  INTO v_sp
  FROM public.penalties pen
  JOIN public.races r ON r.id = pen.race_id
  WHERE pen.user_id = p_user_id
    AND pen.revoked = false
    AND pen.penalty_sp > 0
    AND (
      CASE
        WHEN p_league_id IS NULL THEN r.league_id IS NULL
        ELSE r.league_id = p_league_id
      END
    )
    AND r.id IN (
      -- Laatste 6 races die deze driver gereden heeft in deze context
      SELECT rr.race_id
      FROM public.race_results rr
      JOIN public.races r2 ON r2.id = rr.race_id
      WHERE rr.user_id = p_user_id
        AND (
          CASE
            WHEN p_league_id IS NULL THEN r2.league_id IS NULL
            ELSE r2.league_id = p_league_id
          END
        )
      ORDER BY r2.race_date DESC
      LIMIT 6
    );

  RETURN COALESCE(v_sp, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_driver_sp(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_sp(UUID, UUID) TO anon;
