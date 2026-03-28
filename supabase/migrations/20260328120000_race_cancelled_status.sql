-- Voeg 'cancelled' toe als geldige race status
ALTER TABLE public.races DROP CONSTRAINT IF EXISTS races_status_check;
ALTER TABLE public.races ADD CONSTRAINT races_status_check
  CHECK (status IN ('upcoming', 'live', 'completed', 'cancelled'));
