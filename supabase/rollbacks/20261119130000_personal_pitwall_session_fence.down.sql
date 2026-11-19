-- Paired rollback for 20261119130000_personal_pitwall_session_fence.sql.
--
-- The v1 functions were not edited by the forward migration (only revoked), so
-- they still exist. This rollback removes the additive objects, restores the
-- original lap-capture trigger and re-grants the v1 surface.
--
-- Revocations already written by the fence are intentionally NOT undone: a
-- bearer link that could not prove continuity must stay dead. Re-applying the
-- forward migration is supported.
BEGIN;

DROP TRIGGER IF EXISTS pitwall_session_fence_trg ON public.simhub_telemetry_latest;
DROP FUNCTION IF EXISTS public.pitwall_session_fence_v1();

DROP FUNCTION IF EXISTS public.pitwall_shared_snapshot_v2(text);
DROP FUNCTION IF EXISTS public.pitwall_share_create_v2(uuid, integer);
DROP FUNCTION IF EXISTS public.pitwall_owner_device_detail_v2(uuid);
DROP FUNCTION IF EXISTS public.pitwall_my_devices_v2();
DROP FUNCTION IF EXISTS public.pitwall_public_sector_car_v1(text, jsonb);
DROP FUNCTION IF EXISTS public.pitwall_resolve_observed_session_v1(uuid, text, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.pitwall_public_car_key_v1(text, text);
DROP FUNCTION IF EXISTS public.pitwall_public_track_id_v1(jsonb);
DROP FUNCTION IF EXISTS public.pitwall_share_session_active_v2(jsonb);
DROP FUNCTION IF EXISTS public.pitwall_share_terminal_v1(jsonb);
DROP FUNCTION IF EXISTS public.pitwall_observed_session_v1(jsonb);

-- Restore the original lap-capture trigger (0.7.4 shape, before the extra
-- observed_session_id column).
CREATE OR REPLACE FUNCTION public.simhub_capture_lap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_lap integer;
  v_vorige integer;
  v_tijd numeric;
  v_sessie text;
  v_driver text;
  v_device uuid;
begin
  v_lap := nullif(new.v3_normalized->'timing'->>'completedLaps', '')::integer;
  if v_lap is null or v_lap <= 0 then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_vorige := nullif(old.v3_normalized->'timing'->>'completedLaps', '')::integer;
    if v_vorige is not null and v_lap <= v_vorige then
      return new;
    end if;
  end if;

  v_tijd := nullif(new.v3_normalized->'timing'->>'lastLapTimeSeconds', '')::numeric;
  v_sessie := coalesce(nullif(new.v3_normalized->>'transportSessionId', ''), 'onbekend');
  v_driver := nullif(new.current_driver_name, '');

  select id into v_device from public.simhub_devices where connector_id = new.connector_id;
  if v_device is null then
    return new;
  end if;

  insert into public.simhub_device_laps
    (device_id, connector_id, session_key, lap_number, lap_seconds, driver_name, captured_at)
  values
    (v_device, new.connector_id, v_sessie, v_lap, v_tijd, v_driver, coalesce(new.captured_at, now()))
  on conflict (device_id, session_key, lap_number) do nothing;

  return new;
exception
  -- Een fout hier mag nooit de telemetrie-ingest blokkeren: de ronde gaat
  -- verloren, het frame niet.
  when others then
    return new;
end;
$$;

DROP INDEX IF EXISTS public.simhub_device_laps_observed_session_idx;
DROP INDEX IF EXISTS public.simhub_lap_summaries_device_delivered_idx;
DROP INDEX IF EXISTS public.simhub_measurement_events_device_delivered_idx;
ALTER TABLE public.simhub_device_laps DROP COLUMN IF EXISTS observed_session_id;

ALTER TABLE public.pitwall_shared_races
  DROP COLUMN IF EXISTS observed_session_key,
  DROP COLUMN IF EXISTS track_id;

-- Restore the grants the base migration created.
GRANT EXECUTE ON FUNCTION public.pitwall_shared_snapshot_v1(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_share_create_v1(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_share_revoke_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_my_devices_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_owner_device_detail_v1(uuid) TO authenticated;

COMMIT;
