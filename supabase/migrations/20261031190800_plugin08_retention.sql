-- ============================================================================
-- Plugin 0.7.2.0 — bewaartermijn en opruimfunctie voor de twee meettabellen
-- Datum: 2026-10-31
-- Vorige migratie: 20261031190700_plugin08_control_limits.sql
-- Reviewpunt: 12 (retentie)
-- Status: voorstel. Niet toegepast op productie.
--
-- Waarom
-- ------
-- simhub_measurement_events en simhub_lap_summaries zijn append-only. Zonder
-- bewaartermijn groeien ze zonder grens, en de bestaande indexen (device_id,
-- observed_at) helpen niet bij opruimen op leeftijd.
--
-- Bewaartermijn (in dagen, vanaf received_at)
-- -------------------------------------------
--   * meetgebeurtenissen: 90 dagen. Een wear- of pitgebeurtenis is een anker
--     voor de analyse van de eerstvolgende races; ouder is het niet meer nodig.
--   * rondeaggregaten: 400 dagen. Eén seizoen plus marge, zodat een
--     jaarvergelijking nog kan.
--
-- De opruimfunctie is standaard een PROEF (p_dry_run = true): ze telt wat ze
-- zou verwijderen en verwijdert niets. Dat is opzettelijk; een verkeerde
-- aanroep mag geen seizoen wissen. Een termijn korter dan 30 dagen wordt
-- geweigerd.
--
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

create index if not exists simhub_measurement_events_received_idx
  on public.simhub_measurement_events (received_at);
create index if not exists simhub_lap_summaries_received_idx
  on public.simhub_lap_summaries (received_at);

create or replace function public.simhub_prune_measurements(
  p_events_before timestamptz default null,
  p_laps_before timestamptz default null,
  p_dry_run boolean default true)
returns table (
  events_deleted bigint,
  laps_deleted bigint,
  events_before timestamptz,
  laps_before timestamptz,
  dry_run boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_events_before timestamptz := coalesce(p_events_before, now() - interval '90 days');
  v_laps_before timestamptz := coalesce(p_laps_before, now() - interval '400 days');
  v_events bigint := 0;
  v_laps bigint := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'simhub_prune_measurements is service_role-only' using errcode = '42501';
  end if;

  -- Een te korte termijn is bijna altijd een vergissing, geen beleid.
  if v_events_before > now() - interval '30 days' or v_laps_before > now() - interval '30 days' then
    raise exception 'bewaartermijn korter dan 30 dagen geweigerd' using errcode = '22023';
  end if;

  if p_dry_run is not false then
    select count(*) into v_events from public.simhub_measurement_events where received_at < v_events_before;
    select count(*) into v_laps from public.simhub_lap_summaries where received_at < v_laps_before;
    return query select v_events, v_laps, v_events_before, v_laps_before, true;
    return;
  end if;

  delete from public.simhub_measurement_events where received_at < v_events_before;
  get diagnostics v_events = row_count;
  delete from public.simhub_lap_summaries where received_at < v_laps_before;
  get diagnostics v_laps = row_count;

  return query select v_events, v_laps, v_events_before, v_laps_before, false;
end;
$function$;

comment on function public.simhub_prune_measurements(timestamptz, timestamptz, boolean) is
  'Ruimt meetgebeurtenissen en rondeaggregaten ouder dan de bewaartermijn op. Standaard een proef (dry run). Weigert een termijn korter dan 30 dagen. Alleen service_role.';

revoke all on function public.simhub_prune_measurements(timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.simhub_prune_measurements(timestamptz, timestamptz, boolean) to service_role;

comment on table public.simhub_measurement_events is
  'Meetgebeurtenissen per apparaat: wear-ankers en pitgebeurtenissen met een duurzame client-UUID, bewijs en confidence. Dedupe op (device_id, event_uid); record_revision bepaalt wie wint. Bewaartermijn 90 dagen (simhub_prune_measurements).';
comment on table public.simhub_lap_summaries is
  'Rondeaggregaten per apparaat met dekking per metriekgroep (coverage). Dedupe op (device_id, summary_uid); record_revision bepaalt wie wint. Bewaartermijn 400 dagen (simhub_prune_measurements).';
