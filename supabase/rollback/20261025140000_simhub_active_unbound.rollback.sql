begin;
alter table public.simhub_devices drop constraint if exists simhub_devices_binding_check;
update public.simhub_devices set device_status = 'inactive' where device_status = 'active_unbound';
alter table public.simhub_devices
    drop constraint if exists simhub_devices_device_status_check;
alter table public.simhub_devices
    add constraint simhub_devices_device_status_check check (
        device_status in ('inactive', 'active_binding', 'revoked')
    );
alter table public.simhub_devices
    drop constraint if exists simhub_devices_status_revoked_at_check;
alter table public.simhub_devices
    add constraint simhub_devices_status_revoked_at_check check (
        (device_status = 'revoked' and revoked_at is not null)
        or (device_status in ('active_binding', 'inactive') and revoked_at is null)
    );
alter table public.simhub_devices
    add constraint simhub_devices_binding_check check (
        (endurance_event_id is null) = (endurance_team_id is null)
        and (endurance_event_id is null or (race_id is null and team_id is null))
        and (
            (device_status = 'active_binding' and endurance_event_id is not null and endurance_team_id is not null and device_role is not null and revoked_at is null)
            or (device_status in ('inactive','revoked') and endurance_event_id is null and endurance_team_id is null and device_role is null)
        )
    );
commit;
