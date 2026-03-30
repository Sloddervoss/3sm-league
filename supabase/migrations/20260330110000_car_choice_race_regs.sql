-- Auto keuze ook voor losse race registraties
ALTER TABLE public.race_registrations
  ADD COLUMN IF NOT EXISTS car_choice TEXT,
  ADD COLUMN IF NOT EXISTS car_locked BOOLEAN NOT NULL DEFAULT false;
