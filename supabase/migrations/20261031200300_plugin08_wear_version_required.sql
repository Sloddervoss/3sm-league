-- ============================================================================
-- Plugin 0.7.2.0 — wear.version is verplicht aan beide kanten (review 2, punt 5)
-- Datum: 2026-10-31
-- Vorige migratie: 20261031200200_plugin08_complete_coverage.sql
-- Reviewpunt: 5 (wear-contract)
-- Status: voorstel. Niet toegepast op productie.
--
-- Het probleem
-- ------------
-- De Edge verlangt `wear.version`; SQL accepteerde een ontbrekende versie via
-- `coalesce(p->>'version', '1')`. Daardoor kon een rij die de Edge afkeurt toch
-- rechtstreeks in de tabel belanden, en waren de twee validators niet gelijk.
--
-- Wat hier verandert
-- ------------------
--   * `simhub_wear_v1_valid` eist de sleutel `version` en de waarde `1`. Geen
--     impliciete standaard meer: ontbreken is een afwijzing.
--   * De Edge wijzigt mee: `evidence: null` bij een wear-waarneming is geen
--     bewijs en wordt daar al geweigerd (was: pas in de database).
--   * De tabel-CHECK gebruikt dezelfde functie, dus ook een rechtstreekse
--     service-role-insert valt erop.
--
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
           -- Verplicht, geen coalesce: een ontbrekende versie is onbekend en
           -- dus geen geldig wear-object.
           when not (p ? 'version') then false
           when jsonb_typeof(p->'version') <> 'number'
             or (p->>'version') !~ '^[0-9]+([.][0-9]+)?$'
             or (p->>'version')::numeric <> 1 then false
           when not (p ? 'scale') or (p->>'scale') <> 'remaining_percent' then false
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

comment on function public.simhub_wear_v1_valid(jsonb) is
  'wear_v1: version=1 verplicht, scale=remaining_percent verplicht, vier hoeken 0..100. Geen impliciete standaardversie.';

revoke all on function public.simhub_wear_v1_valid(jsonb) from public, anon, authenticated;
grant execute on function public.simhub_wear_v1_valid(jsonb) to service_role;
