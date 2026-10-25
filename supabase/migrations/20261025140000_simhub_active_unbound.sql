-- Apparaten mogen actief zijn zonder event- of teambinding.
-- Nodig om te kunnen testen en om bandentelemetrie te verzamelen
-- zonder een race te vervuilen.
begin;

alter table public.simhub_devices
    drop constraint if exists simhub_devices_device_status_check;

alter table public.simhub_devices
    add constraint simhub_devices_device_status_check check (
        device_status in ('inactive', 'active_binding', 'active_unbound', 'revoked')
    );

alter table public.simhub_devices
    drop constraint if exists simhub_devices_status_revoked_at_check;

alter table public.simhub_devices
    add constraint simhub_devices_status_revoked_at_check check (
        (device_status = 'revoked' and revoked_at is not null)
        or (device_status in ('active_binding', 'active_unbound', 'inactive') and revoked_at is null)
    );

alter table public.simhub_devices
    drop constraint if exists simhub_devices_binding_check;

alter table public.simhub_devices
    add constraint simhub_devices_binding_check check (
        (endurance_event_id is null) = (endurance_team_id is null)
        and (
            -- Gebonden: alleen bij een actieve racebinding.
            (
                device_status = 'active_binding'
                and endurance_event_id is not null
                and endurance_team_id is not null
                and device_role is not null
                and revoked_at is null
            )
            -- Actief maar ongebonden: geen event, geen team, geen rol.
            or (
                device_status = 'active_unbound'
                and endurance_event_id is null
                and endurance_team_id is null
                and device_role is null
                and revoked_at is null
            )
            -- Rustend of ingetrokken.
            or (
                device_status in ('inactive', 'revoked')
                and endurance_event_id is null
                and endurance_team_id is null
                and device_role is null
            )
        )
    );

commit;
