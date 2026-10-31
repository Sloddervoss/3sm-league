-- ============================================================================
-- Controle na de rollbackketen, met echte meetrijen (review 2, punt 3)
-- Datum: 2026-10-31
--
-- Draai NA de rollbackketen (200300 → 180000) én na een tweede run van
-- 20261031190000 (idempotentie). De rijen uit plugin08_review2_rollback_seed.sql
-- moeten er dan nog staan, met hun revisies en correctieverwijzingen; de oude
-- schrijver moet werken zonder uniciteit op tekstlabels af te dwingen.
-- ============================================================================

begin;

set local request.jwt.claim.role = 'service_role';

create temp table t_resultaat (label text primary key, ok boolean not null);

create or replace function pg_temp.expect(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  insert into t_resultaat (label, ok) values (p_label, coalesce(p_ok, false))
  on conflict (label) do update set ok = excluded.ok;
end $$;

create or replace function pg_temp.eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  perform pg_temp.expect(p_actual is not distinct from p_expected, p_label);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Geen enkel meetgegeven is verdwenen of herschreven
-- ---------------------------------------------------------------------------
do $$
declare
  v_row public.simhub_measurement_events%rowtype;
  v_lap public.simhub_lap_summaries%rowtype;
begin
  perform pg_temp.eq(
    (select count(*)::integer from public.simhub_measurement_events
      where event_uid in ('aaaaaaaa-0000-4000-8000-000000000001',
                          'aaaaaaaa-0000-4000-8000-000000000002',
                          'aaaaaaaa-0000-4000-8000-000000000003')), 3,
    'R2-rollback alle drie de echte gebeurtenissen staan er nog');
  perform pg_temp.eq(
    (select count(*)::integer from public.simhub_lap_summaries
      where summary_uid in ('bbbbbbbb-0000-4000-8000-000000000001',
                            'bbbbbbbb-0000-4000-8000-000000000002',
                            'bbbbbbbb-0000-4000-8000-000000000003')), 3,
    'R2-rollback alle drie de echte rondeaggregaten staan er nog');

  select * into v_row from public.simhub_measurement_events
   where event_uid = 'aaaaaaaa-0000-4000-8000-000000000003';
  perform pg_temp.eq(v_row.event_id, null::text,
                     'R2-rollback de gebeurtenis zonder label heeft nog steeds geen label');
  perform pg_temp.eq(v_row.record_revision, 2,
                     'R2-rollback de hogere revisie is bewaard');
  perform pg_temp.eq(v_row.supersedes_event_uid, 'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
                     'R2-rollback de correctieverwijzing is bewaard');

  perform pg_temp.eq(
    (select count(*)::integer from public.simhub_measurement_events
      where device_id = '11111111-1111-4111-8111-111111111111' and event_id = 'evt-1'), 2,
    'R2-rollback twee UUIDs met hetzelfde tekstlabel bestaan nog');

  select * into v_lap from public.simhub_lap_summaries
   where summary_uid = 'bbbbbbbb-0000-4000-8000-000000000003';
  perform pg_temp.eq(v_lap.record_revision, 3,
                     'R2-rollback de hogere rondrevisie is bewaard');
  perform pg_temp.eq(v_lap.supersedes_summary_uid, 'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
                     'R2-rollback de ronde-correctieverwijzing is bewaard');
  perform pg_temp.eq(v_lap.current_driver_name, 'Vincent de Vos',
                     'R2-rollback de rijdersnaam is bewaard');

  -- De nieuwe identiteit is niet weggegooid.
  perform pg_temp.expect(
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'simhub_measurement_events'
               and column_name = 'event_uid'),
    'R2-rollback de UUID-identiteit bestaat nog');
end $$;

-- ---------------------------------------------------------------------------
-- 2. De oude tekstuniciteit is NIET opnieuw opgelegd
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.expect(
    not exists (select 1 from pg_constraint
                 where conrelid = 'public.simhub_measurement_events'::regclass
                   and contype = 'u'
                   and pg_get_constraintdef(oid) = 'UNIQUE (device_id, event_id)'),
    'R2-rollback geen unique (device_id, event_id)');
  perform pg_temp.expect(
    not exists (select 1 from pg_constraint
                 where conrelid = 'public.simhub_lap_summaries'::regclass
                   and contype = 'u'
                   and pg_get_constraintdef(oid) = 'UNIQUE (device_id, summary_id)'),
    'R2-rollback geen unique (device_id, summary_id)');
  -- En de UUID-uniciteit blijft wel staan: dat is de duurzame identiteit.
  perform pg_temp.expect(
    exists (select 1 from pg_constraint
             where conrelid = 'public.simhub_measurement_events'::regclass
               and contype = 'u'
               and pg_get_constraintdef(oid) = 'UNIQUE (device_id, event_uid)'),
    'R2-rollback de UUID-uniciteit blijft staan');
end $$;

-- ---------------------------------------------------------------------------
-- 3. De oude schrijver werkt, en dedupliceert zonder label-uniciteit
-- ---------------------------------------------------------------------------
do $$
declare
  v_written integer;
  v_rejected integer;
  v_duplicates integer;
begin
  perform pg_temp.expect(
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'simhub_persist_measurement_batch'
               and pg_get_function_identity_arguments(p.oid) = 'p_device_id uuid, p_session_id text, p_events jsonb, p_laps jsonb'),
    'R2-rollback de oude vierargument-schrijver is terug');

  -- Een nieuwe gebeurtenis met een nieuw label komt erdoor.
  select events_written, rejected, duplicates into v_written, v_rejected, v_duplicates
    from public.simhub_persist_measurement_batch(
      '11111111-1111-4111-8111-111111111111', 'sess-1',
      jsonb_build_array(jsonb_build_object(
        'eventId', 'evt-nieuw', 'kind', 'wear_refresh_confirmed',
        'segmentId', 'seg-1', 'observedAt', '2026-10-31T12:00:00Z',
        'sessionTimeSeconds', 1, 'sdkTick', 1, 'confidence', 0.9)),
      null);
  perform pg_temp.eq(v_written, 1, 'R2-rollback de oude schrijver schrijft een nieuwe rij');
  perform pg_temp.eq(v_rejected, 0, 'R2-rollback de nieuwe rij is niet afgekeurd');

  -- Hetzelfde label nog eens: dedupe in de query, geen unieke schending.
  select events_written, rejected, duplicates into v_written, v_rejected, v_duplicates
    from public.simhub_persist_measurement_batch(
      '11111111-1111-4111-8111-111111111111', 'sess-1',
      jsonb_build_array(jsonb_build_object(
        'eventId', 'evt-nieuw', 'kind', 'wear_refresh_confirmed',
        'segmentId', 'seg-1', 'observedAt', '2026-10-31T12:00:00Z',
        'sessionTimeSeconds', 1, 'sdkTick', 1, 'confidence', 0.9)),
      null);
  perform pg_temp.eq(v_written, 0, 'R2-rollback een herverzending schrijft niets bij');
  perform pg_temp.eq(v_duplicates, 1, 'R2-rollback de herverzending is als duplicaat geteld');

  -- Een rij zonder label is voor de oude schrijver ongeldig, maar kost de
  -- andere rijen niet.
  select events_written, rejected, duplicates into v_written, v_rejected, v_duplicates
    from public.simhub_persist_measurement_batch(
      '11111111-1111-4111-8111-111111111111', 'sess-1',
      jsonb_build_array(
        jsonb_build_object('kind', 'wear_refresh_confirmed', 'segmentId', 'seg-1',
                           'observedAt', '2026-10-31T12:00:00Z', 'sessionTimeSeconds', 2,
                           'sdkTick', 2, 'confidence', 0.9),
        jsonb_build_object('eventId', 'evt-nog-een', 'kind', 'wear_refresh_confirmed',
                           'segmentId', 'seg-1', 'observedAt', '2026-10-31T12:00:00Z',
                           'sessionTimeSeconds', 3, 'sdkTick', 3, 'confidence', 0.9)),
      null);
  perform pg_temp.eq(v_written, 1, 'R2-rollback een rij zonder label kost de andere rij niet');
  perform pg_temp.eq(v_rejected, 1, 'R2-rollback de rij zonder label is afgekeurd');
end $$;

select label, case when ok then 'PASS' else 'FAIL' end as resultaat
  from t_resultaat
 order by label;

do $$
declare
  v_fail integer;
  v_totaal integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_totaal from t_resultaat;
  raise notice 'plugin08 review2 rollback: % van % PASS', v_totaal - v_fail, v_totaal;
  if v_fail > 0 then
    raise exception '% van % rollbacktests FAALT: %', v_fail, v_totaal,
      (select string_agg(label, ' | ' order by label) from t_resultaat where not ok);
  end if;
end
$$;

rollback;
