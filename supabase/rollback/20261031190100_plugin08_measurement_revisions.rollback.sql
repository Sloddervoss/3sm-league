-- Rollback van 20261031190100_plugin08_measurement_revisions.sql
-- Gegevensbehoudend: er wordt geen enkele meetrij verwijderd. Wat teruggaat is
-- code en, waar nodig, een constraint. De tabellen en hun inhoud blijven staan,
-- zodat een review of een latere herkansing de gegevens niet kwijt is.
--
-- De revisiekolommen blijven staan met hun inhoud; alleen de NOT NULL op
-- content_hash en de CHECK's gaan weg, zodat een oudere schrijver (die geen hash
-- meeschrijft) weer kan invoegen. De schrijver zelf gaat terug naar de
-- identiteitsversie.
-- Volgorde: altijd van nieuw naar oud terugdraaien (190800 eerst).
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

alter table public.simhub_measurement_events
  drop constraint if exists simhub_measurement_events_revision_range,
  drop constraint if exists simhub_measurement_events_content_hash_len;
alter table public.simhub_measurement_events
  alter column content_hash drop not null;

alter table public.simhub_lap_summaries
  drop constraint if exists simhub_lap_summaries_revision_range,
  drop constraint if exists simhub_lap_summaries_content_hash_len;
alter table public.simhub_lap_summaries
  alter column content_hash drop not null;

drop function if exists public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb);

create or replace function public.simhub_persist_measurement_batch(
  p_device_id uuid,
  p_session_id text,
  p_events jsonb,
  p_laps jsonb)
returns table (events_written integer, laps_written integer, rejected integer, duplicates integer)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_max_events constant integer := 200;
  v_max_laps constant integer := 20;
  v_max_rejects constant integer := 200;
  v_device text := p_device_id::text;
  v_delivered text := nullif(btrim(p_session_id), '');

  v_rec record;
  v_label text;
  v_name text;
  ev_recv integer := 0;
  ev_acc text[] := '{}'::text[];
  ev_dup text[] := '{}'::text[];
  ev_sup text[] := '{}'::text[];
  ev_rej jsonb := '[]'::jsonb;
  ev_block text;
  lp_recv integer := 0;
  lp_acc text[] := '{}'::text[];
  lp_dup text[] := '{}'::text[];
  lp_sup text[] := '{}'::text[];
  lp_rej jsonb := '[]'::jsonb;
  lp_block text;

  v_uid uuid; v_seg text; v_pit text; v_kind text; v_obs text;
  v_at timestamptz; v_st double precision; v_tick bigint;
  v_wb jsonb; v_wa jsonb; v_sg jsonb; v_ev jsonb; v_conf double precision;
  v_rev integer; v_supersedes uuid; v_hash text; v_prev_rev integer; v_prev_hash text;

  v_sum uuid; v_lap integer; v_drv uuid; v_agg integer; v_complete boolean;
  v_cov jsonb;
  v_reasons text[]; v_pitlap boolean; v_drvchg boolean;
  v_tmean double precision; v_tmin double precision; v_tmax double precision; v_amean double precision;
  v_fs double precision; v_fe double precision; v_fi double precision; v_fa double precision;
  v_ai double precision; v_ai2 double precision; v_amax double precision; v_ali double precision;
  v_vd double precision; v_sc double precision; v_gap double precision;
  v_pitids text[]; v_wearids text[];
begin
  -- De server is de baas over apparaat en afleversessie. Wat de client daarover
  -- meeschuift, wordt nooit gebruikt.
  if auth.role() is distinct from 'service_role' then
    return query select 0, 0, 0, 0;
    return;
  end if;

  if p_device_id is null or v_delivered is null or char_length(v_delivered) not between 1 and 120 then
    return query select 0, 0, 0, 0;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- Meetgebeurtenissen
  -- -------------------------------------------------------------------------
  if p_events is not null then
    begin
      if jsonb_typeof(p_events) <> 'array' then
        ev_block := 'not_an_array';
      elsif jsonb_array_length(p_events) > v_max_events then
        ev_block := 'too_many';
      else
        ev_recv := jsonb_array_length(p_events);
        for v_rec in
          select t.value as row, t.ord as ord
            from jsonb_array_elements(p_events) with ordinality as t(value, ord)
        loop
          -- Eén rij per subtransactie: een fout in deze rij kost nooit de andere
          -- rijen, het frame of de rondeaggregaten.
          begin
            v_label := null;
            if jsonb_typeof(v_rec.row) <> 'object' then
              ev_rej := public.simhub_ack_reject(ev_rej, null, v_rec.ord - 1, 'not_an_object', v_max_rejects);
              continue;
            end if;

            v_label := nullif(btrim(coalesce(v_rec.row->>'eventId', '')), '');
            if v_rec.row->'eventUid' is null or v_rec.row->'eventUid' = 'null'::jsonb then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'event_uid_missing', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'eventUid', 'uuid') then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'event_uid_invalid', v_max_rejects);
              continue;
            end if;
            v_uid := public.simhub_juuid(v_rec.row->'eventUid');
            v_name := v_label;
            v_label := v_uid::text;

            if v_rec.row->'kind' is null or (v_rec.row->>'kind') !~ '^[a-z0-9._-]{1,64}$' then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'kind_invalid', v_max_rejects);
              continue;
            end if;
            v_kind := btrim(v_rec.row->>'kind');

            if not public.simhub_jvalid(v_rec.row->'segmentId', 'string', 1, 64)
               or not public.simhub_jvalid(v_rec.row->'pitVisitId', 'string', 1, 64)
               or not public.simhub_jvalid(v_rec.row->'observedSessionId', 'string', 1, 120) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'identifier_invalid', v_max_rejects);
              continue;
            end if;
            v_seg := public.simhub_jtext(v_rec.row->'segmentId');
            v_pit := public.simhub_jtext(v_rec.row->'pitVisitId');
            -- De oorspronkelijke waarnemingssessie komt van de client en blijft bij
            -- herverzending gelijk; de afleversessie is wat de server nu ziet.
            v_obs := public.simhub_jtext(v_rec.row->'observedSessionId');

            if not public.simhub_jvalid(v_rec.row->'observedAt', 'timestamp') then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'observed_at_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'sessionTimeSeconds', 'number', 0, 604800) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'session_time_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'sdkTick', 'bigint', 0, 9007199254740991) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'sdk_tick_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'confidence', 'number', 0, 1) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'confidence_invalid', v_max_rejects);
              continue;
            end if;

            v_at := public.simhub_jtimestamptz(v_rec.row->'observedAt');
            v_st := public.simhub_jdouble(v_rec.row->'sessionTimeSeconds');
            v_tick := public.simhub_jbigint(v_rec.row->'sdkTick');
            v_conf := public.simhub_jdouble(v_rec.row->'confidence');
            v_wb := v_rec.row->'wearBefore';
            v_wa := v_rec.row->'wearAfter';
            v_sg := v_rec.row->'setGeneration';
            v_ev := v_rec.row->'evidence';
            if v_ev = 'null'::jsonb then v_ev := null; end if;
            if v_wb = 'null'::jsonb then v_wb := null; end if;
            if v_wa = 'null'::jsonb then v_wa := null; end if;
            if v_sg = 'null'::jsonb then v_sg := null; end if;

            -- Eén budgetmaat: de jsonb-bytes die de database straks opslaat. Een
            -- te groot bewijs is een expliciete afwijzing, geen stille null.
            if v_ev is not null and (jsonb_typeof(v_ev) <> 'object' or pg_column_size(v_ev) > 4096) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'evidence_too_large', v_max_rejects);
              continue;
            end if;
            if v_wb is not null and (jsonb_typeof(v_wb) <> 'object' or pg_column_size(v_wb) > 2048) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'wear_before_invalid', v_max_rejects);
              continue;
            end if;
            if v_wa is not null and (jsonb_typeof(v_wa) <> 'object' or pg_column_size(v_wa) > 2048) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'wear_after_invalid', v_max_rejects);
              continue;
            end if;
            if v_sg is not null and (jsonb_typeof(v_sg) <> 'object' or pg_column_size(v_sg) > 2048) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'set_generation_invalid', v_max_rejects);
              continue;
            end if;
            select 1 into v_prev_rev
              from public.simhub_measurement_events e
             where e.device_id = v_device and e.event_uid = v_uid;
            if found then
              ev_dup := ev_dup || v_uid::text;
            else
            insert into public.simhub_measurement_events (
              device_id, event_uid, event_id, observed_session_id, delivered_session_id,
              transport_session_id, segment_id, pit_visit_id, kind, observed_at,
              session_time_seconds, sdk_tick, wear_before, wear_after, set_generation,
              evidence, confidence)
            values (
              v_device, v_uid, v_name, v_obs, v_delivered,
              v_delivered, v_seg, v_pit, v_kind, v_at,
              v_st, v_tick, v_wb, v_wa, v_sg,
              v_ev, v_conf);
              ev_acc := ev_acc || v_uid::text;
            end if;
          exception when others then
            ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'row_failed:' || sqlstate, v_max_rejects);
          end;
        end loop;
      end if;
    exception when others then
      ev_block := 'series_failed:' || sqlstate;
    end;
  end if;

  -- -------------------------------------------------------------------------
  -- Rondeaggregaten
  -- -------------------------------------------------------------------------
  if p_laps is not null then
    begin
      if jsonb_typeof(p_laps) <> 'array' then
        lp_block := 'not_an_array';
      elsif jsonb_array_length(p_laps) > v_max_laps then
        lp_block := 'too_many';
      else
        lp_recv := jsonb_array_length(p_laps);
        for v_rec in
          select t.value as row, t.ord as ord
            from jsonb_array_elements(p_laps) with ordinality as t(value, ord)
        loop
          begin
            v_label := null;
            if jsonb_typeof(v_rec.row) <> 'object' then
              lp_rej := public.simhub_ack_reject(lp_rej, null, v_rec.ord - 1, 'not_an_object', v_max_rejects);
              continue;
            end if;

            v_label := nullif(btrim(coalesce(v_rec.row->>'summaryId', '')), '');
            if v_rec.row->'summaryUid' is null or v_rec.row->'summaryUid' = 'null'::jsonb then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'summary_uid_missing', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'summaryUid', 'uuid') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'summary_uid_invalid', v_max_rejects);
              continue;
            end if;
            v_sum := public.simhub_juuid(v_rec.row->'summaryUid');
            v_name := v_label;
            v_label := v_sum::text;

            if jsonb_typeof(v_rec.row->'lapNumber') <> 'number'
               or not public.simhub_jvalid(v_rec.row->'lapNumber', 'integer', 0, 100000) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'lap_number_invalid', v_max_rejects);
              continue;
            end if;
            v_lap := public.simhub_jint(v_rec.row->'lapNumber');

            if not public.simhub_jvalid(v_rec.row->'segmentId', 'string', 1, 64)
               or not public.simhub_jvalid(v_rec.row->'observedSessionId', 'string', 1, 120)
               or not public.simhub_jvalid(v_rec.row->'startedAt', 'timestamp')
               or not public.simhub_jvalid(v_rec.row->'endedAt', 'timestamp')
               or not public.simhub_jvalid(v_rec.row->'currentDriverId', 'uuid')
               or not public.simhub_jvalid(v_rec.row->'aggregationVersion', 'integer', 1, 1000)
               or not public.simhub_jvalid(v_rec.row->'complete', 'boolean')
               or not public.simhub_jvalid(v_rec.row->'pitLap', 'boolean')
               or not public.simhub_jvalid(v_rec.row->'driverChanged', 'boolean') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'field_invalid', v_max_rejects);
              continue;
            end if;

            -- Temperatuur, brandstof en belasting: elke waarde moet eindig zijn en
            -- binnen een fysiek mogelijke band liggen. Geen enkele cast mag hier
            -- nog kunnen klappen.
            if not public.simhub_jvalid(v_rec.row->'trackTempCMean', 'number', -60, 120)
               or not public.simhub_jvalid(v_rec.row->'trackTempCMin', 'number', -60, 120)
               or not public.simhub_jvalid(v_rec.row->'trackTempCMax', 'number', -60, 120)
               or not public.simhub_jvalid(v_rec.row->'airTempCMean', 'number', -60, 120) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'temperature_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'fuelStartLitres', 'number', 0, 300)
               or not public.simhub_jvalid(v_rec.row->'fuelEndLitres', 'number', 0, 300)
               or not public.simhub_jvalid(v_rec.row->'fuelLevelIntegralLitreSeconds', 'number', 0, 1200000)
               or not public.simhub_jvalid(v_rec.row->'fuelAddedLitresObserved', 'number', 0, 300) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'fuel_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'absLatAccelIntegralGSeconds', 'number', 0, 600000)
               or not public.simhub_jvalid(v_rec.row->'latAccelSquaredIntegralG2Seconds', 'number', 0, 6000000)
               or not public.simhub_jvalid(v_rec.row->'maxAbsLatAccelG', 'number', 0, 10)
               or not public.simhub_jvalid(v_rec.row->'absLongAccelIntegralGSeconds', 'number', 0, 600000) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'load_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'validDurationSeconds', 'number', 0, 86400)
               or not public.simhub_jvalid(v_rec.row->'maxGapSeconds', 'number', 0, 86400) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'sampleCount', 'number', 0, 100000000) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'sample_count_invalid', v_max_rejects);
              continue;
            end if;
            if public.simhub_jtimestamptz(v_rec.row->'startedAt') is not null
               and public.simhub_jtimestamptz(v_rec.row->'endedAt') is not null
               and public.simhub_jtimestamptz(v_rec.row->'endedAt') < public.simhub_jtimestamptz(v_rec.row->'startedAt') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'window_inverted', v_max_rejects);
              continue;
            end if;
            if public.simhub_jdouble(v_rec.row->'trackTempCMin') is not null
               and public.simhub_jdouble(v_rec.row->'trackTempCMax') is not null
               and public.simhub_jdouble(v_rec.row->'trackTempCMax') < public.simhub_jdouble(v_rec.row->'trackTempCMin') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'temperature_inverted', v_max_rejects);
              continue;
            end if;

            v_seg := public.simhub_jtext(v_rec.row->'segmentId');
            v_obs := public.simhub_jtext(v_rec.row->'observedSessionId');
            v_drv := public.simhub_juuid(v_rec.row->'currentDriverId');
            v_agg := coalesce(public.simhub_jint(v_rec.row->'aggregationVersion'), 1);
            v_complete := public.simhub_jbool(v_rec.row->'complete');
            v_reasons := public.simhub_jtextarray(v_rec.row->'invalidReasons', 16);
            v_pitlap := public.simhub_jbool(v_rec.row->'pitLap');
            v_drvchg := public.simhub_jbool(v_rec.row->'driverChanged');
            v_tmean := public.simhub_jdouble(v_rec.row->'trackTempCMean');
            v_tmin := public.simhub_jdouble(v_rec.row->'trackTempCMin');
            v_tmax := public.simhub_jdouble(v_rec.row->'trackTempCMax');
            v_amean := public.simhub_jdouble(v_rec.row->'airTempCMean');
            v_fs := public.simhub_jdouble(v_rec.row->'fuelStartLitres');
            v_fe := public.simhub_jdouble(v_rec.row->'fuelEndLitres');
            v_fi := public.simhub_jdouble(v_rec.row->'fuelLevelIntegralLitreSeconds');
            v_fa := public.simhub_jdouble(v_rec.row->'fuelAddedLitresObserved');
            v_ai := public.simhub_jdouble(v_rec.row->'absLatAccelIntegralGSeconds');
            v_ai2 := public.simhub_jdouble(v_rec.row->'latAccelSquaredIntegralG2Seconds');
            v_amax := public.simhub_jdouble(v_rec.row->'maxAbsLatAccelG');
            v_ali := public.simhub_jdouble(v_rec.row->'absLongAccelIntegralGSeconds');
            v_vd := public.simhub_jdouble(v_rec.row->'validDurationSeconds');
            v_sc := public.simhub_jdouble(v_rec.row->'sampleCount');
            v_gap := public.simhub_jdouble(v_rec.row->'maxGapSeconds');
            v_pitids := public.simhub_jtextarray(v_rec.row->'pitVisitIds', 32);
            v_wearids := public.simhub_jtextarray(v_rec.row->'wearObservationIds', 64);
            v_cov := v_rec.row->'coverage';
            if v_cov = 'null'::jsonb then v_cov := null; end if;
            select 1 into v_prev_rev
              from public.simhub_lap_summaries l
             where l.device_id = v_device and l.summary_uid = v_sum;
            if found then
              lp_dup := lp_dup || v_sum::text;
            else
            insert into public.simhub_lap_summaries (
              summary_uid, summary_id, device_id, observed_session_id, delivered_session_id,
              transport_session_id, segment_id, lap_number, started_at, ended_at,
              current_driver_id, aggregation_version, complete, invalid_reasons, pit_lap,
              driver_changed, track_temp_c_mean, track_temp_c_min, track_temp_c_max,
              air_temp_c_mean, fuel_start_litres, fuel_end_litres,
              fuel_level_integral_litre_seconds, fuel_added_litres_observed,
              abs_lat_accel_integral_g_seconds, lat_accel_squared_integral_g2_seconds,
              max_abs_lat_accel_g, abs_long_accel_integral_g_seconds,
              valid_duration_seconds, sample_count, max_gap_seconds, pit_visit_ids,
              wear_observation_ids)
            values (
              v_sum, v_name, v_device, v_obs, v_delivered,
              v_delivered, v_seg, v_lap,
              public.simhub_jtimestamptz(v_rec.row->'startedAt'),
              public.simhub_jtimestamptz(v_rec.row->'endedAt'),
              v_drv, v_agg, v_complete, v_reasons, v_pitlap,
              v_drvchg, v_tmean, v_tmin, v_tmax,
              v_amean, v_fs, v_fe,
              v_fi, v_fa,
              v_ai, v_ai2,
              v_amax, v_ali,
              v_vd, v_sc::bigint, v_gap, v_pitids,
              v_wearids);
              lp_acc := lp_acc || v_sum::text;
            end if;
          exception when others then
            lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'row_failed:' || sqlstate, v_max_rejects);
          end;
        end loop;
      end if;
    exception when others then
      lp_block := 'series_failed:' || sqlstate;
    end;
  end if;

  return query select
    cardinality(ev_acc),
    cardinality(lp_acc),
    (ev_recv - cardinality(ev_acc) - cardinality(ev_dup) - cardinality(ev_sup))
      + (lp_recv - cardinality(lp_acc) - cardinality(lp_dup) - cardinality(lp_sup))
      + (case when ev_block is null then 0 else 1 end)
      + (case when lp_block is null then 0 else 1 end),
    cardinality(ev_dup) + cardinality(lp_dup);
  return;
end;
$function$;


revoke all on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) to service_role;

