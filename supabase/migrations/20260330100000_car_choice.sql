-- Auto keuze per rijder per seizoen
ALTER TABLE public.season_registrations
  ADD COLUMN IF NOT EXISTS car_choice TEXT,
  ADD COLUMN IF NOT EXISTS car_locked BOOLEAN NOT NULL DEFAULT false;
