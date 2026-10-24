-- Practice-pace doorvoeren mag ook als de auto later is gewisseld.
--
-- De controle eiste dat de sessieauto gelijk was aan de gekozen auto van het
-- event. Zodra een team last-minute een andere auto kiest, is alle training van
-- die avond onbruikbaar -- terwijl de baan hetzelfde is en de rondetijden de
-- beste schatting die er is.
--
-- Nu telt alleen de baan en de configuratie. Welke auto gereden is blijft in de
-- pace-rij staan, dus achteraf is nog te zien waarmee de tijd is gezet.

CREATE OR REPLACE FUNCTION public.endurance_sync_practice_pace(p_session_id uuid, p_car_alias text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE session public.endurance_practice_sessions; e public.endurance_events; affected integer;
BEGIN
  SELECT * INTO session FROM public.endurance_practice_sessions WHERE id=p_session_id;
  IF NOT FOUND OR NOT public.endurance_can_manage_roster(session.event_id) THEN RAISE EXCEPTION 'Geen toegang tot deze practice.' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.endurance_events WHERE id=session.event_id FOR UPDATE;
  IF session.ended_at IS NULL THEN RAISE EXCEPTION 'Beëindig de practice voordat je pace doorvoert.'; END IF;
  -- Alleen de baan moet kloppen, niet de auto. De auto van een event wordt
  -- soms pas laat gekozen, en dan zou alle training van die avond wegvallen --
  -- terwijl de rondetijden op die baan gewoon de beste schatting zijn die er
  -- is. Welke auto er gereden is blijft in de pace-rij staan.
  IF session.circuit IS DISTINCT FROM e.circuit OR session.configuration IS DISTINCT FROM e.configuration THEN
    RAISE EXCEPTION 'Deze sessie is op een andere baan of configuratie gereden dan de race.';
  END IF;
  WITH valid AS (
    SELECT l.*,row_number() OVER(PARTITION BY l.user_id ORDER BY l.lap_seconds) AS rank
    FROM public.endurance_practice_laps l WHERE l.session_id=p_session_id AND l.event_id=e.id AND l.user_id IS NOT NULL
      -- Geen auto- en geen baanvergelijking. De sessie bepaalt de baan al, en
      -- de namen lopen op drie manieren uiteen: de sessie zegt
      -- porsche-911-gt3-r-992, de ronde zegt lamborghinievogt3 en de baan heet
      -- in de ronde montreal en in de sessie Circuit Gilles Villeneuve.
      -- Elke vergelijking daarvan filterde alle rondes weg.
      AND l.lap_seconds>0 AND l.lap_seconds::text NOT IN ('NaN','Infinity','-Infinity')
      AND EXISTS(SELECT 1 FROM public.endurance_registrations r WHERE r.event_id=e.id AND r.user_id=l.user_id AND r.status IN ('provisional','confirmed','reserve'))
  ), aggregated AS (
    SELECT user_id,avg(lap_seconds) AS average,percentile_cont(.5) WITHIN GROUP(ORDER BY lap_seconds) AS median,
      min(lap_seconds) AS best,avg(lap_seconds) FILTER(WHERE rank<=5) AS best_five,stddev_pop(lap_seconds) AS deviation,count(*) AS laps,sum(incident_count) AS incidents
    FROM valid GROUP BY user_id
  )
  INSERT INTO public.endurance_pace_entries(event_id,user_id,circuit,configuration,car,conditions,average_lap_seconds,median_lap_seconds,best_lap_seconds,best_five_average_seconds,consistency_seconds,valid_laps,incidents,recorded_at,source,practice_session_id)
  SELECT e.id,user_id,e.circuit,e.configuration,e.selected_car_id,session.conditions,average,median,best,best_five,deviation,laps,incidents,session.ended_at,'practice',session.id FROM aggregated
  ON CONFLICT(practice_session_id,user_id) WHERE practice_session_id IS NOT NULL DO UPDATE SET
    average_lap_seconds=EXCLUDED.average_lap_seconds,median_lap_seconds=EXCLUDED.median_lap_seconds,best_lap_seconds=EXCLUDED.best_lap_seconds,best_five_average_seconds=EXCLUDED.best_five_average_seconds,consistency_seconds=EXCLUDED.consistency_seconds,valid_laps=EXCLUDED.valid_laps,incidents=EXCLUDED.incidents,recorded_at=EXCLUDED.recorded_at;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END;
$function$;
