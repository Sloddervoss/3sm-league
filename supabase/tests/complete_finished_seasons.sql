-- Run inside a transaction and roll back the fixtures.
DO $$
DECLARE
  season_id uuid;
  race_one uuid;
  race_two uuid;
BEGIN
  INSERT INTO public.leagues(name, status) VALUES ('Season completion regression fixture', 'active') RETURNING id INTO season_id;
  IF (SELECT status FROM public.leagues WHERE id = season_id) <> 'active' THEN RAISE EXCEPTION 'Empty season completed'; END IF;
  INSERT INTO public.races(league_id, round, name, track, race_date, status)
    VALUES (season_id, 1, 'First race', 'Test', now() - interval '2 days', 'upcoming') RETURNING id INTO race_one;
  INSERT INTO public.races(league_id, round, name, track, race_date, status)
    VALUES (season_id, 2, 'Final race', 'Test', now() - interval '1 day', 'upcoming') RETURNING id INTO race_two;
  UPDATE public.races SET status = 'completed' WHERE id = race_one;
  IF (SELECT status FROM public.leagues WHERE id = season_id) <> 'active' THEN RAISE EXCEPTION 'Partially completed season closed'; END IF;
  UPDATE public.races SET status = 'live' WHERE id = race_two;
  IF (SELECT status FROM public.leagues WHERE id = season_id) <> 'active' THEN RAISE EXCEPTION 'Live race season closed'; END IF;
  UPDATE public.races SET status = 'completed' WHERE id = race_two;
  IF (SELECT status FROM public.leagues WHERE id = season_id) <> 'completed' THEN RAISE EXCEPTION 'Finished season remains active'; END IF;
  RAISE NOTICE 'PASS: empty, overdue, partial and live seasons stay active; final completed race closes season';
END;
$$;
