BEGIN;

-- A season is complete only when it has races and every race is completed.
-- Dates alone do not establish that results have been processed.
CREATE FUNCTION public.complete_finished_season_from_race()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  season_id uuid;
BEGIN
  FOR season_id IN
    SELECT DISTINCT id FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.league_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.league_id END
    ]) AS affected(id) WHERE id IS NOT NULL ORDER BY id
  LOOP
    PERFORM 1 FROM public.leagues WHERE id = season_id FOR UPDATE;
    UPDATE public.leagues l SET status = 'completed'
    WHERE l.id = season_id AND l.status IN ('active', 'upcoming')
      AND EXISTS (SELECT 1 FROM public.races r WHERE r.league_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM public.races r WHERE r.league_id = l.id AND r.status IS DISTINCT FROM 'completed');
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_finished_season_from_race() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER complete_finished_season
AFTER INSERT OR DELETE OR UPDATE OF status, league_id ON public.races
FOR EACH ROW EXECUTE FUNCTION public.complete_finished_season_from_race();

UPDATE public.leagues l SET status = 'completed'
WHERE l.status IN ('active', 'upcoming')
  AND EXISTS (SELECT 1 FROM public.races r WHERE r.league_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.races r WHERE r.league_id = l.id AND r.status IS DISTINCT FROM 'completed');

COMMIT;
