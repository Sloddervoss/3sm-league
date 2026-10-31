-- ============================================================================
-- Plugin 0.7.2.0 — controlgrenzen gelijk aan wat de ingest werkelijk aanvaardt
-- Datum: 2026-10-31
-- Vorige migratie: 20261031190600_plugin08_snapshot_strip.sql
-- Reviewpunt: 8 (grenzen)
-- Status: voorstel. Niet toegepast op productie.
--
-- Het probleem
-- ------------
-- Control kon een configuratie publiceren die de ingest zelf weigert:
-- send_interval_ms = 250 terwijl simhub_persist_v3 frames binnen 400 ms als
-- rate_limited afwijst, en payload_budget_bytes tot 262144 terwijl
-- readBoundedJson na 24576 bytes HTTP 413 geeft. Een geldig gepubliceerde
-- configuratie kon dus throttling of een 413 veroorzaken.
--
-- Wat hier verandert
-- ------------------
--   * De CHECK's zijn de grenzen van de ingest, niet die van de plugin:
--     send_interval_ms 400..10000, payload_budget_bytes 4096..24576.
--   * De schrijver weigert een waarde buiten die band met een expliciete reden
--     (rejection_detail) in plaats van een generiek 'invalid_payload'.
--   * Features: alleen booleans worden opgeslagen. Een bekende sleutel met een
--     niet-boolean waarde belandde eerder als {"feature":"true"} in de tabel en
--     stond tegelijk in ignored_feature_keys; dat is nu onmogelijk.
--
-- Bewijs dat de grens dezelfde is: de SQL-test
-- supabase/tests/plugin08_review_repairs.sql leest de 400 ms uit de body van
-- simhub_persist_v3 en vergelijkt hem met deze constraint. Twee getallen op twee
-- plaatsen is precies hoe dit soort fouten ontstaat; de test houdt ze gelijk.
--
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

alter table public.simhub_connector_config
  drop constraint if exists simhub_connector_config_send_interval_range;
alter table public.simhub_connector_config
  add constraint simhub_connector_config_send_interval_range
    check (send_interval_ms is null or (send_interval_ms >= 400 and send_interval_ms <= 10000));

alter table public.simhub_connector_config
  drop constraint if exists simhub_connector_config_payload_budget_range;
alter table public.simhub_connector_config
  add constraint simhub_connector_config_payload_budget_range
    check (payload_budget_bytes is null or (payload_budget_bytes >= 4096 and payload_budget_bytes <= 24576));

comment on column public.simhub_connector_config.send_interval_ms is
  'Verzendinterval in ms, 400..10000. De ondergrens is dezelfde als de rate-limit in simhub_persist_v3 (400 ms); een lagere waarde zou door de ingest geweigerd worden.';
comment on column public.simhub_connector_config.payload_budget_bytes is
  'Payloadbudget in bytes van de HTTP-body, 4096..24576. De bovengrens is dezelfde als readBoundedJson in _shared/simhub.ts; daarboven geeft de ingest 413.';
comment on column public.simhub_connector_config.features is
  'Alleen booleans voor features die de plugin al kent. Een niet-boolean waarde wordt niet opgeslagen en staat in ignored_feature_keys van simhub_connector_config_apply.';

-- De retourvorm krijgt er een kolom bij (de reden), dus eerst weg.
drop function if exists public.simhub_connector_config_apply(jsonb, integer);

create or replace function public.simhub_connector_config_apply(
  p_config jsonb,
  p_expected_revision integer default null)
returns table (result text, config_revision integer, ignored_feature_keys text[], rejection_detail text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_current public.simhub_connector_config%rowtype;
  v_keys text[];
  v_unknown text[];
  v_features jsonb := '{}'::jsonb;
  v_ignored text[] := '{}'::text[];
  v_new_revision integer;
  v_send integer;
  v_hz integer;
  v_budget integer;
begin
  if auth.role() is distinct from 'service_role' then
    return query select 'unauthorized'::text, null::integer, null::text[], null::text;
    return;
  end if;

  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    return query select 'invalid_payload'::text, null::integer, null::text[], 'not_an_object'::text;
    return;
  end if;

  select array_agg(k order by k) into v_keys from jsonb_object_keys(p_config) k;
  select array_agg(k order by k) into v_unknown
    from unnest(v_keys) k
   where k not in ('sendIntervalMs', 'sampleHz', 'payloadBudgetBytes', 'features',
                   'recommendedMinVersion', 'updateChannel', 'maintenanceWindow', 'expiresAt');
  if v_unknown is not null then
    return query select 'unknown_fields'::text, null::integer, null::text[],
                        ('unknown:' || array_to_string(v_unknown, ','))::text;
    return;
  end if;

  select * into v_current from public.simhub_connector_config where id = 1 for update;
  if not found then
    return query select 'not_initialized'::text, null::integer, null::text[], null::text;
    return;
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_current.config_revision then
    return query select 'revision_conflict'::text, v_current.config_revision, null::text[],
                        'expected_revision_mismatch'::text;
    return;
  end if;

  -- Grenzen expliciet, met dezelfde getallen als de CHECK. Zo krijgt de
  -- beheerder een reden in plaats van een constraint-naam.
  if p_config ? 'sendIntervalMs' then
    v_send := nullif(p_config->>'sendIntervalMs', '')::integer;
    if v_send is not null and (v_send < 400 or v_send > 10000) then
      return query select 'out_of_range'::text, v_current.config_revision, null::text[],
                          'sendIntervalMs:400..10000'::text;
      return;
    end if;
  else
    v_send := v_current.send_interval_ms;
  end if;

  if p_config ? 'sampleHz' then
    v_hz := nullif(p_config->>'sampleHz', '')::integer;
    if v_hz is not null and (v_hz < 1 or v_hz > 50) then
      return query select 'out_of_range'::text, v_current.config_revision, null::text[],
                          'sampleHz:1..50'::text;
      return;
    end if;
  else
    v_hz := v_current.sample_hz;
  end if;

  if p_config ? 'payloadBudgetBytes' then
    v_budget := nullif(p_config->>'payloadBudgetBytes', '')::integer;
    if v_budget is not null and (v_budget < 4096 or v_budget > 24576) then
      return query select 'out_of_range'::text, v_current.config_revision, null::text[],
                          'payloadBudgetBytes:4096..24576'::text;
      return;
    end if;
  else
    v_budget := v_current.payload_budget_bytes;
  end if;

  -- Features: alleen sleutels die de plugin kent én alleen booleans. Een
  -- niet-boolean waarde wordt niet opgeslagen en wordt als ignored gemeld.
  if p_config ? 'features' then
    if jsonb_typeof(p_config->'features') <> 'object' then
      return query select 'invalid_payload'::text, null::integer, null::text[], 'features_not_an_object'::text;
      return;
    end if;
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      into v_features
      from jsonb_each(p_config->'features') e
     where e.key in ('pitService', 'wearObservation', 'lapSummary', 'directIrSdk',
                     'measurementEvents', 'lapSummaries', 'environment', 'opponents')
       and jsonb_typeof(e.value) = 'boolean';

    -- Wat niet als boolean kan worden opgeslagen, wordt gemeld in plaats van
    -- stil in de tabel te belanden (dat gebeurde eerst met "true" als string).
    select coalesce(array_agg(e.key order by e.key), '{}'::text[])
      into v_ignored
      from jsonb_each(p_config->'features') e
     where e.key in ('pitService', 'wearObservation', 'lapSummary', 'directIrSdk',
                     'measurementEvents', 'lapSummaries', 'environment', 'opponents')
       and jsonb_typeof(e.value) is distinct from 'boolean';
  else
    v_features := v_current.features;
  end if;

  v_new_revision := v_current.config_revision + 1;

  update public.simhub_connector_config c
     set config_revision = v_new_revision,
         send_interval_ms = v_send,
         sample_hz = v_hz,
         payload_budget_bytes = v_budget,
         features = v_features,
         recommended_min_version = case when p_config ? 'recommendedMinVersion' then nullif(btrim(p_config->>'recommendedMinVersion'), '') else c.recommended_min_version end,
         update_channel = case when p_config ? 'updateChannel' then nullif(btrim(p_config->>'updateChannel'), '') else c.update_channel end,
         maintenance_window = case when p_config ? 'maintenanceWindow' then nullif(p_config->'maintenanceWindow', 'null'::jsonb) else c.maintenance_window end,
         expires_at = case when p_config ? 'expiresAt' then nullif(p_config->>'expiresAt', '')::timestamptz else c.expires_at end,
         updated_at = now()
   where c.id = 1;

  return query select 'applied'::text, v_new_revision, v_ignored, null::text;
exception
  when invalid_text_representation then
    return query select 'invalid_payload'::text, v_current.config_revision, null::text[],
                        ('not_a_number:' || sqlerrm)::text;
  when others then
    -- Een waarde buiten de CHECK of een onparsebare tijd: geen halve update.
    return query select 'invalid_payload'::text, v_current.config_revision, null::text[],
                        ('rejected:' || sqlstate)::text;
end;
$function$;

comment on function public.simhub_connector_config_apply(jsonb, integer) is
  'Service-role-only schrijver voor simhub_connector_config. Grenzen zijn die van de ingest (400 ms, 24576 bytes). Weigert onbekende beleidssleutels, slaat alleen booleans als feature op, kent optimistische concurrency en geeft bij een afwijzing een expliciete rejection_detail.';

revoke all on function public.simhub_connector_config_apply(jsonb, integer) from public, anon, authenticated;
grant execute on function public.simhub_connector_config_apply(jsonb, integer) to service_role;
