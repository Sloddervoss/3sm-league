-- Persist the authoritative iRacing configuration ID for deterministic layered maps.
-- Nullable preserves every historical race and all existing consumers.
ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS iracing_track_id INTEGER;

COMMENT ON COLUMN public.races.iracing_track_id IS
  'Authoritative iRacing TrackID/configuration ID; null for unresolved historical races.';

CREATE INDEX IF NOT EXISTS races_iracing_track_id_idx
  ON public.races (iracing_track_id)
  WHERE iracing_track_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
