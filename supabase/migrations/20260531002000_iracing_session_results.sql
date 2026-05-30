-- Store new JSON-only race enrichment without backfilling existing uploaded pages.
-- Existing completed races keep rendering normally because all new fields are nullable
-- and session rows are only created by future JSON imports/re-imports.

ALTER TABLE public.race_results
  ADD COLUMN IF NOT EXISTS country_code TEXT;

DO $$
BEGIN
  ALTER TABLE public.race_results
    ADD CONSTRAINT race_results_country_code_format
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.race_session_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  race_id UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  session_type TEXT NOT NULL CHECK (session_type IN ('practice', 'qualifying')),
  session_name TEXT,
  session_number INTEGER,
  position INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  iracing_cust_id TEXT,
  laps INTEGER,
  best_lap TEXT,
  best_lap_num INTEGER,
  avg_lap TEXT,
  incidents INTEGER,
  car_name TEXT,
  club_name TEXT,
  country_code TEXT CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (race_id, session_type, session_number, position, display_name)
);

ALTER TABLE public.race_session_results ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_race_session_results_race_type_position
  ON public.race_session_results (race_id, session_type, position);

DROP POLICY IF EXISTS "Session results viewable by everyone" ON public.race_session_results;
DROP POLICY IF EXISTS "Admins can insert session results" ON public.race_session_results;
DROP POLICY IF EXISTS "Admins can update session results" ON public.race_session_results;
DROP POLICY IF EXISTS "Admins can delete session results" ON public.race_session_results;

CREATE POLICY "Session results viewable by everyone" ON public.race_session_results
  FOR SELECT USING (true);

CREATE POLICY "Admins can insert session results" ON public.race_session_results
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update session results" ON public.race_session_results
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete session results" ON public.race_session_results
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));
