-- Rollback van 20261031200300_plugin08_wear_version_required.sql
-- Gegevensbehoudend: opgeslagen wear-objecten blijven staan. Wat teruggaat is
-- de validator van vóór deze migratie, die een ontbrekende versie als 1 las.
-- Idempotent: twee keer draaien levert dezelfde functie.
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

create or replace function public.simhub_wear_v1_valid(p jsonb)
returns boolean
language sql
immutable
as $$
  select case
           when p is null or p = 'null'::jsonb then true
           when jsonb_typeof(p) <> 'object' then false
           when exists (select 1 from jsonb_object_keys(p) k
                         where k not in ('version', 'scale', 'fl', 'fr', 'rl', 'rr')) then false
           when coalesce(p->>'version', '1') <> '1' then false
           when coalesce(p->>'scale', '') <> 'remaining_percent' then false
           when jsonb_typeof(p->'fl') <> 'number'
             or jsonb_typeof(p->'fr') <> 'number'
             or jsonb_typeof(p->'rl') <> 'number'
             or jsonb_typeof(p->'rr') <> 'number' then false
           else coalesce(
             (p->>'fl') ~ '^-?[0-9]+([.][0-9]+)?$' and (p->>'fl')::numeric between 0 and 100
             and (p->>'fr') ~ '^-?[0-9]+([.][0-9]+)?$' and (p->>'fr')::numeric between 0 and 100
             and (p->>'rl') ~ '^-?[0-9]+([.][0-9]+)?$' and (p->>'rl')::numeric between 0 and 100
             and (p->>'rr') ~ '^-?[0-9]+([.][0-9]+)?$' and (p->>'rr')::numeric between 0 and 100,
             false)
         end
$$;

revoke all on function public.simhub_wear_v1_valid(jsonb) from public, anon, authenticated;
grant execute on function public.simhub_wear_v1_valid(jsonb) to service_role;
