-- 2026-11-21: houd bewezen PACE-sectoren vast wanneer één tussenframe zijn
-- track-/auto-identiteit tijdelijk niet meezendt.
--
-- Aanleiding: de live timing verloor continu alle S1/S2/S3 en kreeg ze even
-- later terug, bij meerdere auto's tegelijk. De presentatielaag had al een
-- retentie voor sparse PACE-metingen, maar de SQL-snapshot verwierp de hele
-- `paceHistory` zodra `identity.trackId` of `identity.carId` in één frame
-- ontbrak: `IS DISTINCT FROM` behandelt NULL als een andere waarde. Een
-- ontbrekend veld is echter "onbekend", geen bevestigde wissel.
--
-- Deze guard zit op de enige plek waar de samengevoegde PACE-historie wordt
-- weggeschreven. Hij laat een echte sessie-, baan-, auto- of segmentwissel
-- ongewijzigd door en herstelt alleen de vorige historie bij een niet-
-- bevestigde terugval. Een frame uit een oude sessie dat na een nieuwe sessie
-- binnenkomt wordt als geheel geweigerd (BEFORE UPDATE RETURN NULL), zodat een
-- late retry het nieuwere beeld niet overschrijft.
--
-- Geen nieuwe tabel, geen leesroute, geen rechtenwijziging. De guard is
-- idempotent en raakt alleen `simhub_telemetry_latest.v3_normalized`.

BEGIN;

CREATE OR REPLACE FUNCTION public.simhub_pace_history_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $guard$
DECLARE
  old_h jsonb := OLD.v3_normalized -> 'paceHistory';
  new_h jsonb := NEW.v3_normalized -> 'paceHistory';
  old_track text := OLD.v3_normalized #>> '{identity,trackId}';
  new_track text := NEW.v3_normalized #>> '{identity,trackId}';
  old_car text := OLD.v3_normalized #>> '{identity,carId}';
  new_car text := NEW.v3_normalized #>> '{identity,carId}';
  old_segment text := old_h ->> 'segmentId';
  new_segment text := new_h ->> 'segmentId';
  old_observed text := old_h ->> 'observedSessionId';
  new_observed text := new_h ->> 'observedSessionId';
  old_clock numeric;
  new_clock numeric;
  old_updated timestamptz;
  new_updated timestamptz;
  old_cars integer;
  new_cars integer;
BEGIN
  IF old_h IS NULL OR jsonb_typeof(old_h) IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;

  -- De onderhoudsroute verwijdert historie ouder dan 24 uur. Die mag deze
  -- guard niet terugzetten; een verlopen blok is geen bewezen live waarde.
  BEGIN
    old_updated := (old_h ->> 'updatedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    old_updated := NULL;
  END;
  IF old_updated IS NOT NULL AND old_updated < now() - interval '24 hours' THEN
    RETURN NEW;
  END IF;

  -- Een frame uit een vorige sessie mag een nieuwer snapshot nooit vervangen.
  IF NEW.session_id IS DISTINCT FROM OLD.session_id
     AND NEW.captured_at < OLD.captured_at THEN
    RETURN NULL;
  END IF;

  -- Een bevestigde nieuwe afleversessie is een echte reset.
  IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RETURN NEW;
  END IF;

  -- Alleen twee bekende, verschillende waarden bewijzen een wissel.
  IF old_track IS NOT NULL AND new_track IS NOT NULL AND old_track IS DISTINCT FROM new_track THEN
    RETURN NEW;
  END IF;
  IF old_car IS NOT NULL AND new_car IS NOT NULL AND old_car IS DISTINCT FROM new_car THEN
    RETURN NEW;
  END IF;

  -- Houd de laatst bekende track-/auto-identiteit vast als dit frame die niet
  -- meezendt. Anders kan een volgend frame de echte wissel niet meer bewijzen
  -- en blijft de oude historie ten onrechte staan.
  IF new_track IS NULL AND old_track IS NOT NULL THEN
    NEW.v3_normalized := jsonb_set(
      NEW.v3_normalized,
      '{identity}',
      coalesce(NEW.v3_normalized -> 'identity', '{}'::jsonb) || jsonb_build_object('trackId',
        CASE WHEN old_track ~ '^[0-9]+$' THEN to_jsonb(old_track::bigint) ELSE to_jsonb(old_track) END),
      true
    );
    new_track := old_track;
  END IF;
  IF new_car IS NULL AND old_car IS NOT NULL THEN
    NEW.v3_normalized := jsonb_set(
      NEW.v3_normalized,
      '{identity}',
      coalesce(NEW.v3_normalized -> 'identity', '{}'::jsonb) || jsonb_build_object('carId', old_car),
      true
    );
    new_car := old_car;
  END IF;

  -- Een nieuw PACE-segment of een nieuwe observed sessie is ook een reset.
  IF old_segment IS NOT NULL AND new_segment IS NOT NULL AND old_segment IS DISTINCT FROM new_segment THEN
    RETURN NEW;
  END IF;
  IF old_observed IS NOT NULL AND new_observed IS NOT NULL AND old_observed IS DISTINCT FROM new_observed THEN
    RETURN NEW;
  END IF;

  BEGIN
    old_clock := (OLD.v3_normalized #>> '{session,sessionTimeSeconds}')::numeric;
    new_clock := (NEW.v3_normalized #>> '{session,sessionTimeSeconds}')::numeric;
  EXCEPTION WHEN OTHERS THEN
    old_clock := NULL;
    new_clock := NULL;
  END;
  IF old_clock IS NOT NULL AND new_clock IS NOT NULL AND new_clock < old_clock - 0.001 THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(new_h) IS DISTINCT FROM 'object'
     OR jsonb_typeof(new_h -> 'cars') IS DISTINCT FROM 'array' THEN
    NEW.v3_normalized := jsonb_set(NEW.v3_normalized, '{paceHistory}', old_h, true);
    RETURN NEW;
  END IF;

  old_cars := CASE WHEN jsonb_typeof(old_h -> 'cars') = 'array' THEN jsonb_array_length(old_h -> 'cars') ELSE 0 END;
  new_cars := jsonb_array_length(new_h -> 'cars');

  BEGIN
    old_updated := (old_h ->> 'updatedAt')::timestamptz;
    new_updated := (new_h ->> 'updatedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    old_updated := NULL;
    new_updated := NULL;
  END;

  -- Minder auto's of een oudere updatedAt zonder bevestigde wissel: de
  -- historie is door een ontbrekend identiteitsveld weggevallen. Herstel de
  -- laatst bekende volledige historie; het volgende complete frame werkt hem
  -- weer bij.
  IF new_cars < old_cars
     OR (old_updated IS NOT NULL AND new_updated IS NOT NULL AND new_updated < old_updated) THEN
    NEW.v3_normalized := jsonb_set(NEW.v3_normalized, '{paceHistory}', old_h, true);
  END IF;

  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS simhub_telemetry_latest_pace_guard ON public.simhub_telemetry_latest;
CREATE TRIGGER simhub_telemetry_latest_pace_guard
  BEFORE UPDATE OF v3_normalized ON public.simhub_telemetry_latest
  FOR EACH ROW
  EXECUTE FUNCTION public.simhub_pace_history_guard_v1();

COMMENT ON FUNCTION public.simhub_pace_history_guard_v1() IS
  'Houdt de bewezen PACE-historie bij een ontbrekende track-/auto-identiteit; een bevestigde sessie-, baan-, auto- of segmentwissel blijft een reset.';

COMMIT;
