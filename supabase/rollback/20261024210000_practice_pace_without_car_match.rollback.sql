-- Terugdraaien: de pace-functie die een gelijke auto eist.

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
  IF session.car_id IS NULL OR (session.car_id,session.circuit,session.configuration) IS DISTINCT FROM (e.selected_car_id,e.circuit,e.configuration) THEN RAISE EXCEPTION 'Deze sessie heeft geen passende vastgelegde auto/baancombinatie. Start een nieuwe practice voor de huidige racekeuze.'; END IF;
  WITH valid AS (
    SELECT l.*,row_number() OVER(PARTITION BY l.user_id ORDER BY l.lap_seconds) AS rank
    FROM public.endurance_practice_laps l WHERE l.session_id=p_session_id AND l.event_id=e.id AND l.user_id IS NOT NULL
      AND l.car_id IN (session.car_id,p_car_alias) AND l.circuit=session.circuit
      AND l.lap_seconds>0 AND l.lap_seconds::text NOT IN ('NaN','Infinity','-Infinity')
      AND EXISTS(SELECT 1 FROM public.endurance_registrations r WHERE r.event_id=e.id AND r.user_id=l.user_id AND r.status IN ('provisional','confirmed','reserve'))
  ), aggregated AS (
    SELECT user_id,avg(lap_seconds) AS average,percentile_cont(.5) WITHIN GROUP(ORDER BY lap_seconds) AS median,
      min(lap_seconds) AS best,avg(lap_seconds) FILTER(WHERE rank<=5) AS best_five,stddev_pop(lap_seconds) AS deviation,count(*) AS laps,sum(incident_count) AS incidents
    FROM valid GROUP BY user_id
  )
  INSERT INTO public.endurance_pace_entries(event_id,user_id,circuit,configuration,car,conditions,average_lap_seconds,median_lap_seconds,best_lap_seconds,best_five_average_seconds,consistency_seconds,valid_laps,incidents,recorded_at,source,practice_session_id)
  SELECT e.id,user_id,session.circuit,session.configuration,session.car_id,session.conditions,average,median,best,best_five,deviation,laps,incidents,session.ended_at,'practice',session.id FROM aggregated
  ON CONFLICT(practice_session_id,user_id) WHERE practice_session_id IS NOT NULL DO UPDATE SET
    average_lap_seconds=EXCLUDED.average_lap_seconds,median_lap_seconds=EXCLUDED.median_lap_seconds,best_lap_seconds=EXCLUDED.best_lap_seconds,best_five_average_seconds=EXCLUDED.best_five_average_seconds,consistency_seconds=EXCLUDED.consistency_seconds,valid_laps=EXCLUDED.valid_laps,incidents=EXCLUDED.incidents,recorded_at=EXCLUDED.recorded_at;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END;
$function$

;
