-- Testmodus: de pitwall lezen zonder event of team.
--
-- Tijdens een race komt alles uit get_pitwall_data(event, team). Wie alleen
-- wil kijken wat de pitwall met zijn eigen apparatuur doet, moest daarvoor
-- een event aanmaken — en dat vervuilt de kalender.
--
-- Deze functie bouwt hetzelfde antwoord uit één apparaat. Wat er werkelijk
-- is, wordt gevuld; wat een event nodig heeft (stintplan, uitslag, klassement
-- over de race) blijft leeg in plaats van verzonnen te worden. De vlag
-- `sandbox` maakt dat onderscheid zichtbaar voor degebruikersinterface.

create or replace function public.pitwall_sandbox_v1(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dev public.simhub_devices;
  v_tel public.simhub_telemetry_latest;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_dev from public.simhub_devices where id = p_device_id;
  if v_dev.id is null then
    raise exception 'Onbekend apparaat';
  end if;

  if not (public.can_manage_simhub() or v_dev.owner_user_id = v_uid) then
    raise exception 'Geen toegang tot dit apparaat';
  end if;

  select * into v_tel
  from public.simhub_telemetry_latest
  where connector_id = v_dev.connector_id;

  return jsonb_build_object(
    'sandbox', true,
    'device', jsonb_build_object(
      'id', v_dev.id,
      'name', v_dev.device_name,
      'connector', v_dev.connector_id,
      'status', v_dev.device_status
    ),
    'team_access', true,
    'v3_normalized', coalesce(v_tel.v3_normalized, '{}'::jsonb),
    'telemetry', jsonb_build_object(
      'captured_at', v_tel.captured_at,
      'driver_name', v_tel.current_driver_name
    ),
    -- Wat een event nodig heeft: bewust leeg, niet geschat.
    'strategy', null,
    'planned_stints', '[]'::jsonb,
    'timeline', '[]'::jsonb,
    'pace_targets', '[]'::jsonb,
    'fuel_samples', '[]'::jsonb,
    'tyre_samples', '[]'::jsonb,
    'opponent_trends', '[]'::jsonb,
    'tyre_estimate', null,
    'pit_loss', null,
    'pit_lane_seconds', null
  );
end;
$$;

revoke all on function public.pitwall_sandbox_v1(uuid) from public, anon;
grant execute on function public.pitwall_sandbox_v1(uuid) to authenticated;

comment on function public.pitwall_sandbox_v1(uuid) is
  'Pitwall-context uit één apparaat, zonder event. Leeg waar een event nodig is.';
