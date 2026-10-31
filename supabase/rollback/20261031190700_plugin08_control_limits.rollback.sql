-- Rollback van 20261031190700_plugin08_control_limits.sql
-- Gegevensbehoudend: er wordt geen enkele meetrij verwijderd. Wat teruggaat is
-- code en, waar nodig, een constraint. De tabellen en hun inhoud blijven staan,
-- zodat een review of een latere herkansing de gegevens niet kwijt is.
--
-- De oude grenzen (250 ms en 262144 bytes) en de oude schrijver komen terug.
-- Dat maakt opnieuw publiceren van waarden mogelijk die de ingest weigert; dat is
-- precies de fout die deze migratie repareerde. Alleen doen als de hele 0.7.2.0-set
-- terug moet.
-- Volgorde: altijd van nieuw naar oud terugdraaien (190800 eerst).
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

alter table public.simhub_connector_config
  drop constraint if exists simhub_connector_config_send_interval_range;
alter table public.simhub_connector_config
  add constraint simhub_connector_config_send_interval_range
    check (send_interval_ms is null or (send_interval_ms >= 250 and send_interval_ms <= 10000));

alter table public.simhub_connector_config
  drop constraint if exists simhub_connector_config_payload_budget_range;
alter table public.simhub_connector_config
  add constraint simhub_connector_config_payload_budget_range
    check (payload_budget_bytes is null or (payload_budget_bytes >= 4096 and payload_budget_bytes <= 262144));

-- De retourvorm verandert terug (vier kolommen), dus eerst weg.
drop function if exists public.simhub_connector_config_apply(jsonb, integer);

-- geactiveerd worden) en verhoogt de revision alleen bij een geslaagde wijziging.
create or replace function public.simhub_connector_config_apply(
  p_config jsonb,
  p_expected_revision integer default null)
returns table (result text, config_revision integer, ignored_feature_keys text[])
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
begin
  if auth.role() <> 'service_role' then
    return query select 'unauthorized'::text, null::integer, null::text[];
    return;
  end if;

  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    return query select 'invalid_payload'::text, null::integer, null::text[];
    return;
  end if;

  -- Onbekende sleutels zijn een fout, geen uitbreiding: dit is een patch op een
  -- gesloten beleidsobject. (Bij de payloadparser is het omgekeerde waar, omdat
  -- daar een nieuwe client een oudere server moet kunnen passeren.)
  select array_agg(k order by k) into v_keys from jsonb_object_keys(p_config) k;
  select array_agg(k order by k) into v_unknown
    from unnest(v_keys) k
   where k not in ('sendIntervalMs', 'sampleHz', 'payloadBudgetBytes', 'features',
                   'recommendedMinVersion', 'updateChannel', 'maintenanceWindow', 'expiresAt');
  if v_unknown is not null then
    return query select 'unknown_fields'::text, null::integer, null::text[];
    return;
  end if;

  select * into v_current from public.simhub_connector_config where id = 1 for update;
  if not found then
    return query select 'not_initialized'::text, null::integer, null::text[];
    return;
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_current.config_revision then
    return query select 'revision_conflict'::text, v_current.config_revision, null::text[];
    return;
  end if;

  -- Features: alleen sleutels die de plugin kent, alleen booleans.
  if p_config ? 'features' then
    if jsonb_typeof(p_config->'features') <> 'object' then
      return query select 'invalid_payload'::text, null::integer, null::text[];
      return;
    end if;
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb),
           coalesce(array_agg(e.key order by e.key) filter (where e.value not in ('true'::jsonb, 'false'::jsonb)), '{}'::text[])
      into v_features, v_ignored
      from jsonb_each(p_config->'features') e
     where e.key in ('pitService', 'wearObservation', 'lapSummary', 'directIrSdk',
                     'measurementEvents', 'lapSummaries', 'environment', 'opponents');
    -- Onbekende featuresleutels staan niet in v_ignored maar worden ook niet
    -- meegenomen; ze zijn stil genegeerd en dat is de bedoeling (brief: een
    -- onbekende feature wordt niet geactiveerd).
  else
    v_features := v_current.features;
  end if;

  v_new_revision := v_current.config_revision + 1;

  update public.simhub_connector_config c
     set config_revision = v_new_revision,
         send_interval_ms = case when p_config ? 'sendIntervalMs' then nullif(p_config->>'sendIntervalMs', '')::integer else c.send_interval_ms end,
         sample_hz = case when p_config ? 'sampleHz' then nullif(p_config->>'sampleHz', '')::integer else c.sample_hz end,
         payload_budget_bytes = case when p_config ? 'payloadBudgetBytes' then nullif(p_config->>'payloadBudgetBytes', '')::integer else c.payload_budget_bytes end,
         features = v_features,
         recommended_min_version = case when p_config ? 'recommendedMinVersion' then nullif(btrim(p_config->>'recommendedMinVersion'), '') else c.recommended_min_version end,
         update_channel = case when p_config ? 'updateChannel' then nullif(btrim(p_config->>'updateChannel'), '') else c.update_channel end,
         maintenance_window = case when p_config ? 'maintenanceWindow' then nullif(p_config->'maintenanceWindow', 'null'::jsonb) else c.maintenance_window end,
         expires_at = case when p_config ? 'expiresAt' then nullif(p_config->>'expiresAt', '')::timestamptz else c.expires_at end,
         updated_at = now()
   where c.id = 1;

  return query select 'applied'::text, v_new_revision, v_ignored;
exception
  -- Een waarde buiten de CHECK of een onparsebare tijd: geen halve update, maar
  -- een expliciete afwijzing. De tabel blijft dan op de vorige, geldige stand.
  when others then
    return query select 'invalid_payload'::text, v_current.config_revision, null::text[];
end;
$function$;

revoke all on function public.simhub_connector_config_apply(jsonb, integer) from public, anon, authenticated;
grant execute on function public.simhub_connector_config_apply(jsonb, integer) to service_role;

