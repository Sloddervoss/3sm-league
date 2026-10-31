-- ============================================================================
-- Plugin 0.8 — connectorbesturing: één configuratierij en een publieke leesfunctie
-- Datum: 2026-10-31
-- Vorige migratie: 20261031180100_plugin08_lap_summaries.sql
-- Status: VOORSTEL. Niet toegepast op productie.
--
-- Waarom
-- ------
-- De brief (paragraaf 3) wil releases voorkomen voor beleid: verzend- en
-- samplefrequentie, payloadbudget, welke reeds ingebouwde features aan staan, en
-- welk updatekanaal geldt. Dat is een klein, expliciet mandaat — geen dynamische
-- plugin.
--
-- Wat hier NIET in zit (en er ook nooit in hoort)
-- ----------------------------------------------
-- Geen SDK-kanaalnamen met formules, geen DLL- of scriptpad, geen auth- of
-- bindingsoverschrijving. De tabel heeft daarom geen kolom `sql`, geen
-- `downloadUrl` en geen `formula`: wat er niet is, kan niet misbruikt worden.
--
-- Waarom één rij
-- --------------
-- `check (id = 1)` maakt van de tabel een singleton. Een configuratie is beleid
-- voor de hele vloot; meerdere rijen zouden een volgorde- of
-- prioriteitsmechanisme vragen dat niemand heeft gevraagd.
--
-- Waarom de leesfunctie SECURITY DEFINER is
-- -----------------------------------------
-- De tabel staat op RLS zonder policies: anon kan er niet bij. De leesfunctie
-- geeft precies de publieke kolommen terug en niets anders, en is daarom de
-- enige route voor een client. Ze is expliciet opgesomd (geen `select *`), zodat
-- een later toegevoegde kolom niet per ongeluk publiek wordt.
--
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

create table if not exists public.simhub_connector_config (
  id integer primary key default 1,
  constraint simhub_connector_config_singleton check (id = 1),

  -- Monotoon oplopend. De client bewaart de laatste revision en gebruikt hem om
  -- te zien of een configuratie nieuwer is; de schrijver verhoogt hem bij iedere
  -- geslaagde wijziging.
  config_revision integer not null default 1,

  -- Grenzen in de DDL, niet alleen in de schrijver: een verkeerde waarde mag de
  -- tabel niet in. De ondergrens van 250 ms en de bovengrens van 10 s zijn
  -- ruimer dan wat de plugin lokaal accepteert; de client klemt alsnog binnen
  -- zijn eigen grenzen (brief: "binnen lokale grenzen").
  send_interval_ms integer,
  sample_hz integer,
  payload_budget_bytes integer,

  -- Alleen booleans per bekende feature. Onbekende sleutels worden door de
  -- schrijver weggefilterd en dus nooit geactiveerd.
  features jsonb not null default '{}'::jsonb,

  recommended_min_version text,
  update_channel text,
  maintenance_window jsonb,

  -- Null = geen vervaldatum. Een verstreken tijd betekent: niet toepassen.
  expires_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint simhub_connector_config_revision_range
    check (config_revision >= 1),
  constraint simhub_connector_config_send_interval_range
    check (send_interval_ms is null or (send_interval_ms >= 250 and send_interval_ms <= 10000)),
  constraint simhub_connector_config_sample_hz_range
    check (sample_hz is null or (sample_hz >= 1 and sample_hz <= 50)),
  constraint simhub_connector_config_payload_budget_range
    check (payload_budget_bytes is null or (payload_budget_bytes >= 4096 and payload_budget_bytes <= 262144)),
  constraint simhub_connector_config_features_is_object
    check (jsonb_typeof(features) = 'object'),
  constraint simhub_connector_config_features_size
    check (pg_column_size(features) <= 4096),
  constraint simhub_connector_config_maintenance_window_is_object
    check (maintenance_window is null or jsonb_typeof(maintenance_window) = 'object'),
  constraint simhub_connector_config_maintenance_window_size
    check (maintenance_window is null or pg_column_size(maintenance_window) <= 2048),
  constraint simhub_connector_config_min_version_len
    check (recommended_min_version is null or char_length(recommended_min_version) between 1 and 60),
  constraint simhub_connector_config_update_channel
    check (update_channel is null or update_channel in ('stable', 'beta', 'canary', 'off'))
);

comment on table public.simhub_connector_config is
  'Singleton (id = 1) met servergestuurde connectorinstellingen: frequenties, payloadbudget, feature-schakelaars, minimumversie, updatekanaal en onderhoudsvenster. Geen SDK-kanaalnamen, formules of downloadpaden.';
comment on column public.simhub_connector_config.features is
  'Alleen booleans voor features die de plugin al kent. Onbekende sleutels worden bij het schrijven weggefilterd en dus nooit geactiveerd.';
comment on column public.simhub_connector_config.expires_at is
  'Null = geen vervaldatum. Is de tijd verstreken, dan mag de client deze configuratie niet toepassen en gelden de ingebouwde defaults.';

-- De rij bestaat altijd, met veilige defaults en zonder features aan te zetten.
-- Zonder deze rij zou de publieke leesfunctie nul rijen geven en moest iedere
-- client zelf een fallback kennen; nu is "er is nog geen beleid" een geldige
-- toestand met revision 1.
insert into public.simhub_connector_config (id, config_revision, features)
values (1, 1, '{}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Publieke leesfunctie: precies deze kolommen, niets meer.
-- ---------------------------------------------------------------------------
create or replace function public.simhub_connector_config_public()
returns table (
  config_revision integer,
  send_interval_ms integer,
  sample_hz integer,
  payload_budget_bytes integer,
  features jsonb,
  recommended_min_version text,
  update_channel text,
  maintenance_window jsonb,
  expires_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select c.config_revision,
         c.send_interval_ms,
         c.sample_hz,
         c.payload_budget_bytes,
         c.features,
         c.recommended_min_version,
         c.update_channel,
         c.maintenance_window,
         c.expires_at,
         c.updated_at
    from public.simhub_connector_config c
   where c.id = 1;
$$;

comment on function public.simhub_connector_config_public() is
  'Publieke, alleen-lezen projectie van simhub_connector_config (id = 1). Geeft uitsluitend beleidsvelden terug; geen apparaat, token of sleutel. Leest ook een verlopen configuratie terug — de aanroeper ziet expires_at en beslist.';

revoke all on function public.simhub_connector_config_public() from public;
grant execute on function public.simhub_connector_config_public() to anon, authenticated, service_role;

-- Leesbare view voor de operations-runbook en voor SQL-tests. Dun laagje om
-- dezelfde functie, zodat er geen tweede definitie van "publiek" kan ontstaan.
create or replace view public.simhub_connector_config_readonly
with (security_invoker = false) as
  select * from public.simhub_connector_config_public();

comment on view public.simhub_connector_config_readonly is
  'Read-only view op simhub_connector_config_public(). Zelfde kolommen als de publieke functie; geen geheimen.';

revoke all on public.simhub_connector_config_readonly from public;
grant select on public.simhub_connector_config_readonly to anon, authenticated, service_role;

alter table public.simhub_connector_config enable row level security;

revoke all on table public.simhub_connector_config from public, anon, authenticated;
grant select, insert, update, delete on table public.simhub_connector_config to service_role;

-- ---------------------------------------------------------------------------
-- Schrijven: één service-role-only RPC met eigen validatie.
-- ---------------------------------------------------------------------------
-- Waarom niet rechtstreeks een UPDATE vanuit de Edge: dan zou de validatie in
-- TypeScript staan en de grenzen in de DDL een tweede, zwakkere waarheid zijn.
-- Deze functie weigert onbekende sleutels (een typefout in een beleidsveld mag
-- niet stil verdwijnen), filtert onbekende feature-sleutels weg (die mogen nooit
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

comment on function public.simhub_connector_config_apply(jsonb, integer) is
  'Service-role-only schrijver voor simhub_connector_config. Weigert onbekende beleidssleutels, filtert onbekende feature-sleutels weg, kent optimistische concurrency via p_expected_revision en verhoogt config_revision alleen bij een geslaagde wijziging.';

revoke all on function public.simhub_connector_config_apply(jsonb, integer) from public, anon, authenticated;
grant execute on function public.simhub_connector_config_apply(jsonb, integer) to service_role;
