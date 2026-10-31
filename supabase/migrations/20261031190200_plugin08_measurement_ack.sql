-- ============================================================================
-- Plugin 0.7.2.0 — meet-ACK per rij
-- Datum: 2026-10-31
-- Vorige migratie: 20261031190100_plugin08_measurement_revisions.sql
-- Reviewpunt: 3 (ACK)
-- Status: voorstel. Niet toegepast op productie.
--
-- Een frame-ACK bewees niet dat de meetberichten duurzaam verwerkt waren: fouten
-- werden per deelbatch ingeslikt en de Edge antwoordde alleen met accepted.
--
-- De meetbatch geeft nu een rapport terug met per rij de uitkomst (accepted,
-- duplicates, superseded of rejected met reden), ook als de reeks als geheel werd
-- afgekeurd. simhub_persist_v3 geeft dat rapport door in een derde kolom, zodat de
-- Edge het aan de connector kan teruggeven en een outbox niet op een kale 202
-- opruimt.
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

-- De meetbatch verandert van vorm (tabel met vier tellers -> jsonb-rapport).
-- Dat kan niet met create or replace; daarom eerst weg.
drop function if exists public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb);

create or replace function public.simhub_persist_measurement_batch(
  p_device_id uuid,
  p_session_id text,
  p_events jsonb,
  p_laps jsonb)
returns jsonb
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
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  if p_device_id is null or v_delivered is null or char_length(v_delivered) not between 1 and 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
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
            if not public.simhub_jvalid(v_rec.row->'recordRevision', 'integer', 1, 100000) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'revision_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'supersedesEventUid', 'uuid') then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'supersedes_invalid', v_max_rejects);
              continue;
            end if;
            v_rev := coalesce(public.simhub_jint(v_rec.row->'recordRevision'), 1);
            v_supersedes := public.simhub_juuid(v_rec.row->'supersedesEventUid');

            -- Inhoudelijke vingerafdruk: dezelfde revisie met andere inhoud is een
            -- conflict, geen stille negeeractie.
            v_hash := md5(jsonb_build_object(
              'segmentId', v_seg, 'observedSessionId', v_obs, 'pitVisitId', v_pit,
              'kind', v_kind, 'observedAt', v_at, 'sessionTimeSeconds', v_st,
              'sdkTick', v_tick, 'wearBefore', v_wb, 'wearAfter', v_wa,
              'setGeneration', v_sg, 'evidence', v_ev, 'confidence', v_conf)::text);

            select e.record_revision, e.content_hash into v_prev_rev, v_prev_hash
              from public.simhub_measurement_events e
             where e.device_id = v_device and e.event_uid = v_uid;

            if not found then
            insert into public.simhub_measurement_events (
              device_id, event_uid, event_id, observed_session_id, delivered_session_id,
              transport_session_id, segment_id, pit_visit_id, kind, observed_at,
              session_time_seconds, sdk_tick, wear_before, wear_after, set_generation,
              evidence, confidence, record_revision, content_hash, supersedes_event_uid)
            values (
              v_device, v_uid, v_name, v_obs, v_delivered,
              v_delivered, v_seg, v_pit, v_kind, v_at,
              v_st, v_tick, v_wb, v_wa, v_sg,
              v_ev, v_conf, v_rev, v_hash, v_supersedes);
              ev_acc := ev_acc || v_uid::text;
            elsif v_rev > v_prev_rev then
              -- Hogere revisie: dit is de nieuwe stand van dezelfde waarneming.
              update public.simhub_measurement_events e
                 set event_id = v_name,
                     observed_session_id = v_obs,
                     delivered_session_id = v_delivered,
                     transport_session_id = v_delivered,
                     segment_id = v_seg,
                     pit_visit_id = v_pit,
                     kind = v_kind,
                     observed_at = v_at,
                     session_time_seconds = v_st,
                     sdk_tick = v_tick,
                     wear_before = v_wb,
                     wear_after = v_wa,
                     set_generation = v_sg,
                     evidence = v_ev,
                     confidence = v_conf,
                     record_revision = v_rev,
                     supersedes_event_uid = coalesce(v_supersedes, e.supersedes_event_uid),
                     content_hash = v_hash,
                     received_at = now()
               where e.device_id = v_device and e.event_uid = v_uid;
              ev_sup := ev_sup || v_uid::text;
            elsif v_rev = v_prev_rev and v_hash is not distinct from v_prev_hash then
              -- Zelfde revisie, zelfde inhoud: herverzending uit de oude outbox.
              ev_dup := ev_dup || v_uid::text;
            elsif v_rev = v_prev_rev then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'revision_conflict', v_max_rejects);
            else
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'stale_revision', v_max_rejects);
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
            if not public.simhub_jvalid(v_rec.row->'recordRevision', 'integer', 1, 100000) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'revision_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'supersedesSummaryUid', 'uuid') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'supersedes_invalid', v_max_rejects);
              continue;
            end if;
            v_rev := coalesce(public.simhub_jint(v_rec.row->'recordRevision'), 1);
            v_supersedes := public.simhub_juuid(v_rec.row->'supersedesSummaryUid');

            v_hash := md5(jsonb_build_object(
              'segmentId', v_seg, 'observedSessionId', v_obs, 'lapNumber', v_lap,
              'startedAt', public.simhub_jtimestamptz(v_rec.row->'startedAt'),
              'endedAt', public.simhub_jtimestamptz(v_rec.row->'endedAt'),
              'currentDriverId', v_drv, 'aggregationVersion', v_agg, 'complete', v_complete,
              'invalidReasons', v_reasons, 'pitLap', v_pitlap, 'driverChanged', v_drvchg,
              'tmin', v_tmin, 'tmax', v_tmax, 'tmean', v_tmean, 'amean', v_amean,
              'fs', v_fs, 'fe', v_fe, 'fi', v_fi, 'fa', v_fa,
              'ai', v_ai, 'ai2', v_ai2, 'amax', v_amax, 'ali', v_ali,
              'vd', v_vd, 'sc', v_sc, 'gap', v_gap, 'pitIds', v_pitids, 'wearIds', v_wearids)::text);

            select l.record_revision, l.content_hash into v_prev_rev, v_prev_hash
              from public.simhub_lap_summaries l
             where l.device_id = v_device and l.summary_uid = v_sum;

            if not found then
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
              wear_observation_ids, record_revision, content_hash, supersedes_summary_uid)
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
              v_wearids, v_rev, v_hash, v_supersedes);
              lp_acc := lp_acc || v_sum::text;
            elsif v_rev > v_prev_rev then
              update public.simhub_lap_summaries l
                 set summary_id = v_name,
                     observed_session_id = v_obs,
                     delivered_session_id = v_delivered,
                     transport_session_id = v_delivered,
                     segment_id = v_seg,
                     lap_number = v_lap,
                     started_at = public.simhub_jtimestamptz(v_rec.row->'startedAt'),
                     ended_at = public.simhub_jtimestamptz(v_rec.row->'endedAt'),
                     current_driver_id = v_drv,
                     aggregation_version = v_agg,
                     complete = v_complete,
                     invalid_reasons = v_reasons,
                     pit_lap = v_pitlap,
                     driver_changed = v_drvchg,
                     track_temp_c_mean = v_tmean,
                     track_temp_c_min = v_tmin,
                     track_temp_c_max = v_tmax,
                     air_temp_c_mean = v_amean,
                     fuel_start_litres = v_fs,
                     fuel_end_litres = v_fe,
                     fuel_level_integral_litre_seconds = v_fi,
                     fuel_added_litres_observed = v_fa,
                     abs_lat_accel_integral_g_seconds = v_ai,
                     lat_accel_squared_integral_g2_seconds = v_ai2,
                     max_abs_lat_accel_g = v_amax,
                     abs_long_accel_integral_g_seconds = v_ali,
                     valid_duration_seconds = v_vd,
                     sample_count = v_sc::bigint,
                     max_gap_seconds = v_gap,
                     pit_visit_ids = v_pitids,
                     wear_observation_ids = v_wearids,
                     record_revision = v_rev,
                     supersedes_summary_uid = coalesce(v_supersedes, l.supersedes_summary_uid),
                     content_hash = v_hash,
                     received_at = now()
               where l.device_id = v_device and l.summary_uid = v_sum;
              lp_sup := lp_sup || v_sum::text;
            elsif v_rev = v_prev_rev and v_hash is not distinct from v_prev_hash then
              lp_dup := lp_dup || v_sum::text;
            elsif v_rev = v_prev_rev then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'revision_conflict', v_max_rejects);
            else
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'stale_revision', v_max_rejects);
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

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device,
    'delivered_session_id', v_delivered,
    'events', jsonb_build_object(
      'received', ev_recv,
      'accepted', to_jsonb(ev_acc),
      'duplicates', to_jsonb(ev_dup),
      'superseded', to_jsonb(ev_sup),
      'rejected', ev_rej,
      'block_error', ev_block),
    'laps', jsonb_build_object(
      'received', lp_recv,
      'accepted', to_jsonb(lp_acc),
      'duplicates', to_jsonb(lp_dup),
      'superseded', to_jsonb(lp_sup),
      'rejected', lp_rej,
      'block_error', lp_block));
end;
$function$;

revoke all on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) to service_role;

comment on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) is
  'Interne schrijver voor meetgebeurtenissen en rondeaggregaten. Geeft een ACK-rapport per rij terug: accepted, duplicates, superseded en rejected met reden, plus een block_error als de reeks zelf werd afgekeurd.';

-- ---------------------------------------------------------------------------
-- simhub_persist_v3: dezelfde body, met het meetrapport als derde kolom
-- ---------------------------------------------------------------------------
-- De body is regel voor regel de definitie van 20261031180300. Alleen de
-- vroege returns krijgen een derde waarde (NULL of een expliciete afwijzing) en
-- de aanroep van de meetbatch levert het rapport op. Alle bestaande resultaten
-- ('accepted', 'replayed', 'rate_limited', 'invalid_payload', ...) blijven
-- gelijk; een 0.7.1.x-Edge leest nog steeds de eerste twee kolommen.
drop function if exists public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text);
-- En de achtargumentversie van 20261031180300: de retourvorm verandert, dus ook
-- die definitie moet eerst weg. Er blijft daarna precies één functie over.
drop function if exists public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text, jsonb, jsonb);

--
drop function if exists public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text);

CREATE OR REPLACE FUNCTION public.simhub_persist_v3(
  p_token_hash text,
  p_session_id text,
  p_sequence bigint,
  p_captured_at timestamp with time zone,
  p_v3_normalized jsonb,
  -- 0.8.0 herkomst: optioneel, achteraan en met default, zodat een aanroep met
  -- vijf argumenten blijft werken.
  p_simhub_version text DEFAULT NULL,
  -- 0.8.0 amendement: meetgebeurtenissen en rondeaggregaten uit hetzelfde frame.
  -- Beide zijn optioneel en staan ACHTER p_simhub_version, zodat de bestaande
  -- argumentvolgorde niet verschuift. Een 0.7.1.x-Edge die de functie met vijf
  -- benoemde argumenten aanroept, resolveert nog steeds naar deze functie.
  p_events jsonb DEFAULT NULL,
  p_laps jsonb DEFAULT NULL)
 RETURNS TABLE(result text, received_at timestamp with time zone, measurement_ack jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  d public.simhub_devices%ROWTYPE;
  s public.endurance_source_segments%ROWTYPE;
  e uuid; t uuid; r uuid;
  now_at timestamptz := clock_timestamp();
  nl integer; ni integer; np boolean;
  v_vorige_laps integer; nf text[];
  v_session_sequence bigint; v_session_count integer;
  baseline boolean := false; k text; payload jsonb;
  v_fuel numeric; v_last_laptime numeric; v_session_laps integer;
  v_driver_name text; v_driver_id text;
  v_run_laps integer; v_run_device uuid;
  v_auto_count bigint; v_auto_team uuid; v_auto_event uuid;
  v_practice_session_id uuid;
  v_practice_event_id uuid;
  -- S2 (anker): alleen op de pitvlag-overgang ingelezen. Alles nullable en
  -- null = onbekend; nooit een coalesce naar 0.
  v_anchor_fl numeric; v_anchor_fr numeric; v_anchor_rl numeric; v_anchor_rr numeric;
  v_zone_fl_l numeric;
  v_zone_fl_m numeric;
  v_zone_fl_r numeric;
  v_zone_fr_l numeric;
  v_zone_fr_m numeric;
  v_zone_fr_r numeric;
  v_zone_rl_l numeric;
  v_zone_rl_m numeric;
  v_zone_rl_r numeric;
  v_zone_rr_l numeric;
  v_zone_rr_m numeric;
  v_zone_rr_r numeric;
  v_anchor_track numeric; v_anchor_air numeric; v_anchor_rubber text;
  v_anchor_source text; v_anchor_sets integer;
  -- 0.8.0: uitkomst van de meetbatches. Bijzaak voor het frame; alleen voor de
  -- waarschuwing in de logboeken. 0/null betekent: er is niets aangeboden.
  v_agg_events integer := 0;
  v_agg_laps integer := 0;
  v_agg_rejected integer := 0;
  v_agg_duplicates integer := 0;
  v_agg_ack jsonb;
  -- Herkomst (0.8.0): twee losse versies, twee kolommen. Null = onbekend, en
  -- onbekend valt nooit terug op de apparaatnaam.
  v_simhub_version text;
  v_connector_version text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::timestamptz, jsonb_build_object('ok', false, 'error', 'frame_unauthorized'); RETURN;
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$'
     OR char_length(coalesce(p_session_id,'')) NOT BETWEEN 1 AND 120
     OR p_sequence IS NULL OR p_sequence < 0
     OR p_captured_at IS NULL
     OR jsonb_typeof(p_v3_normalized) <> 'object' THEN
    RETURN QUERY SELECT 'invalid_payload'::text, NULL::timestamptz, jsonb_build_object('ok', false, 'error', 'frame_invalid_payload'); RETURN;
  END IF;

  -- Herkomst: de SimHub-versie en de connectorversie zijn twee verschillende
  -- dingen en horen dus in twee kolommen. Het source-blok is optioneel; ontbreekt
  -- het, dan blijft de kolom leeg in plaats van de apparaatnaam te herhalen
  -- (dat deed deze functie tot 2026-10-31: simhub_version = d.device_name).
  -- Beide kolommen hebben een CHECK van 1-60 tekens; een waarde daarbuiten zou
  -- het hele frame met 23514 laten klappen, dus die wordt null. Leeg is ook null.
  v_simhub_version := btrim(coalesce(p_simhub_version, p_v3_normalized#>>'{source,simHubVersion}', ''));
  IF char_length(v_simhub_version) NOT BETWEEN 1 AND 60 THEN v_simhub_version := NULL; END IF;
  v_connector_version := btrim(coalesce(p_v3_normalized#>>'{source,connectorVersion}', ''));
  IF char_length(v_connector_version) NOT BETWEEN 1 AND 60 THEN v_connector_version := NULL; END IF;

  SELECT * INTO d FROM public.simhub_devices WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid_device'::text, NULL::timestamptz, jsonb_build_object('ok', false, 'error', 'frame_invalid_device'); RETURN; END IF;
  IF d.revoked_at IS NOT NULL THEN RETURN QUERY SELECT 'revoked'::text, NULL::timestamptz, jsonb_build_object('ok', false, 'error', 'frame_revoked'); RETURN; END IF;

  -- Routing vereist een actieve binding. Een inschrijving is GEEN voorwaarde meer:
  -- de binding is de beheerder beslis, en een ontbrekende registratie mag een
  -- correct gekoppeld device niet stil in de device-scoped modus laten vallen.
  IF d.endurance_event_id IS NOT NULL AND d.endurance_team_id IS NOT NULL
     AND d.device_status = 'active_binding' AND d.device_role = 'primary'
  THEN
    e := d.endurance_event_id; t := d.endurance_team_id;

    SELECT id INTO r FROM public.endurance_race_runs
    WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
    LIMIT 1;

    -- Zonder actieve race run is het lap-event onbereikbaar. Start er een.
    IF r IS NULL THEN
      PERFORM public.simhub_start_race_run(e, t, 'race');
      SELECT id INTO r FROM public.endurance_race_runs
      WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
      LIMIT 1;
    END IF;
  ELSE
    e := NULL; t := NULL; r := NULL;
  END IF;

  IF d.last_seen_at IS NOT NULL AND d.last_seen_at > now_at - interval '400 milliseconds' THEN
    RETURN QUERY SELECT 'rate_limited'::text, now_at, jsonb_build_object('ok', false, 'error', 'frame_rate_limited'); RETURN;
  END IF;
  SELECT last_sequence INTO v_session_sequence
  FROM public.simhub_device_sessions WHERE device_id = d.id AND session_id = p_session_id FOR UPDATE;
  IF FOUND AND p_sequence <= v_session_sequence THEN
    RETURN QUERY SELECT 'replayed'::text, now_at, jsonb_build_object('ok', false, 'error', 'frame_replayed'); RETURN;
  END IF;
  IF NOT FOUND THEN
    SELECT count(*) INTO v_session_count FROM public.simhub_device_sessions WHERE device_id = d.id;
    -- Een device dat zijn plafond raakt mag niet permanent dood zijn. Ruim de
    -- oudste sessies op en houd de recente geschiedenis voor replay-detectie.
    IF v_session_count >= 64 THEN
      DELETE FROM public.simhub_device_sessions AS oud
      WHERE oud.device_id = d.id
        AND oud.session_id NOT IN (
          SELECT nieuw.session_id FROM public.simhub_device_sessions AS nieuw
          WHERE nieuw.device_id = d.id
          ORDER BY nieuw.last_seen_at DESC NULLS LAST
          LIMIT 48
        );
      SELECT count(*) INTO v_session_count FROM public.simhub_device_sessions WHERE device_id = d.id;
    END IF;
    IF v_session_count >= 64 THEN RETURN QUERY SELECT 'session_limit'::text, now_at, jsonb_build_object('ok', false, 'error', 'frame_session_limit'); RETURN; END IF;
    IF d.last_session_id IS NOT NULL AND (d.last_seen_at > now_at - interval '5 seconds' OR p_sequence > 5) THEN
      RETURN QUERY SELECT 'replayed'::text, now_at, jsonb_build_object('ok', false, 'error', 'frame_replayed'); RETURN;
    END IF;
  END IF;

  nl := NULLIF(p_v3_normalized#>>'{timing,completedLaps}','')::integer;
  ni := NULLIF(p_v3_normalized#>>'{raceState,incidents}','')::integer;
  np := NULLIF(p_v3_normalized#>>'{track,onPitRoad}','')::boolean;
  v_fuel := NULLIF(p_v3_normalized#>>'{fuel,fuelLitres}','')::numeric;
  v_last_laptime := NULLIF(p_v3_normalized#>>'{timing,lastLapTimeSeconds}','')::numeric;
  v_session_laps := NULLIF(p_v3_normalized#>>'{session,sessionLapsRemaining}','')::integer;
  SELECT array_agg(x ORDER BY x) INTO nf FROM (
    SELECT DISTINCT jsonb_array_elements_text(coalesce(nullif(p_v3_normalized#>'{session,flags}', 'null'::jsonb), '[]'::jsonb)) x
  ) q;

  -- De plugin stuurt in currentDriverId in de praktijk een NAAM (SimHub's Opponent.Id).
  -- Beide velden worden daarom als naam behandeld.
  v_driver_name := nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverName}', '')), '');
  IF v_driver_name IS NULL THEN
    v_driver_name := nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverId}', '')), '');
  END IF;
  -- Automatische koppeling op de rijder in plaats van op het apparaat.
  -- Een device dat niet gekoppeld is hoort bij de coureur die erin zit. De naam
  -- komt uit de plugin en wordt opgezocht bij de teamleden van events die nu
  -- lopen. Alleen bij precies één team wordt er gekoppeld; bij twijfel niet.
  IF e IS NULL AND v_driver_name IS NOT NULL THEN
    WITH kandidaten AS (
      SELECT DISTINCT m.team_id, m.event_id
        FROM public.endurance_team_members m
        JOIN public.profiles p ON p.user_id = m.user_id
        JOIN public.endurance_events ev ON ev.id = m.event_id
       WHERE (public.simhub_name_key(p.iracing_name) = public.simhub_name_key(v_driver_name)
              OR public.simhub_name_key(p.display_name) = public.simhub_name_key(v_driver_name))
         AND now_at BETWEEN ev.start_at - interval '2 hours' AND ev.end_at + interval '30 minutes'
    )
    SELECT count(*), (array_agg(team_id))[1], (array_agg(event_id))[1]
      INTO v_auto_count, v_auto_team, v_auto_event
      FROM kandidaten;

    IF v_auto_count = 1 THEN
      -- Eerst de andere devices van dit team losmaken: er mag maar één primair zijn.
      UPDATE public.simhub_devices
         SET device_status = 'inactive', device_role = NULL,
             endurance_event_id = NULL, endurance_team_id = NULL,
             endurance_binding_source = NULL, updated_at = now_at
       WHERE id <> d.id AND revoked_at IS NULL
         AND endurance_team_id = v_auto_team AND endurance_event_id = v_auto_event;

      UPDATE public.simhub_devices
         SET device_status = 'active_binding', device_role = 'primary',
             endurance_event_id = v_auto_event, endurance_team_id = v_auto_team,
             endurance_binding_source = 'auto_driver', updated_at = now_at
       WHERE id = d.id;

      e := v_auto_event; t := v_auto_team;

      SELECT id INTO r FROM public.endurance_race_runs
       WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
       LIMIT 1;
      IF r IS NULL THEN
        PERFORM public.simhub_start_race_run(e, t, 'race');
        SELECT id INTO r FROM public.endurance_race_runs
         WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  v_driver_id := public.simhub_resolve_driver_user(e, t, v_driver_name);


  -- Practice op baansleutel. Een manager opent een sessie voor een event; iedereen
  -- die op die baan rijdt telt dan mee, ook zonder teamkoppeling. Dat is nodig
  -- omdat teams pas na de practice op pace worden ingedeeld. De baan wordt
  -- gematcht op iRacings trackId tegen de catalogus van het event.
  IF v_last_laptime IS NOT NULL AND nl IS NOT NULL AND nl > 0
     AND v_last_laptime > 0 AND v_last_laptime <= 3600 THEN
    SELECT sess.id, sess.event_id INTO v_practice_session_id, v_practice_event_id
    FROM public.endurance_practice_sessions AS sess
    JOIN public.endurance_events AS ev ON ev.id = sess.event_id
    LEFT JOIN public.endurance_iracing_events AS cat ON cat.id = ev.iracing_catalog_event_id
    WHERE sess.ended_at IS NULL
      AND (
        cat.track_id = NULLIF(p_v3_normalized#>>'{identity,trackId}', '')::integer
        OR lower(btrim(coalesce(sess.circuit, ''))) = lower(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}', '')))
      )
    ORDER BY sess.started_at DESC
    LIMIT 1;

    IF v_practice_session_id IS NOT NULL THEN
      INSERT INTO public.endurance_practice_laps (
        session_id, event_id, user_id, car_id, car_name, circuit,
        lap_seconds, fuel_used_litres, fuel_per_lap_litres,
        incident_count, recorded_at,
        source_session_id, source_device_id, completed_laps
      ) VALUES (
        v_practice_session_id, v_practice_event_id,
        COALESCE(NULLIF(v_driver_id, '')::uuid, d.owner_user_id),
        NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,carId}', '')), ''),
        NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,carName}', '')), ''),
        NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}', '')), ''),
        v_last_laptime,
        NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}', '')::numeric,
        NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}', '')::numeric,
        COALESCE(ni, 0),
        p_captured_at,
        btrim(p_session_id), d.id, nl
      )
      ON CONFLICT (event_id, source_session_id, source_device_id, completed_laps)
        WHERE source_session_id IS NOT NULL AND source_device_id IS NOT NULL AND completed_laps IS NOT NULL
      DO NOTHING;
    END IF;
  END IF;

  -- Routing-scoped logic only when active-bound
  IF e IS NOT NULL THEN
    SELECT * INTO s FROM public.endurance_source_segments
    WHERE device_id = d.id AND session_id = p_session_id AND event_id = e AND team_id = t FOR UPDATE;
    baseline := NOT FOUND;
    IF NOT baseline AND p_sequence <= s.last_sequence THEN
      RETURN QUERY SELECT 'replayed'::text, NULL::timestamptz, jsonb_build_object('ok', false, 'error', 'frame_replayed'); RETURN;
    END IF;

    -- Een nieuwe sessie begint weer bij ronde 0. Zonder deze controle blijft de
    -- oude race run actief en botst elke ronde op ON CONFLICT
    -- (race_run_id, completed_laps): de eerste rondes van een herstart
    -- verdwijnen dan stil, want ze bestaan al.
    --
    -- De vorige stand komt uit het laatst bijgewerkte segment van dit device,
    -- niet uit het huidige: bij een nieuwe sessie bestaat dat nog niet.
    IF nl IS NOT NULL AND r IS NOT NULL THEN
      -- Vergelijk met de laatste sample van DEZE run op HETZELFDE device.
      -- De oude code vergeleek met het eigen, mogelijk uren oude segment van dit
      -- device. Bij een coureurswissel komt de eerste ronde van een ander device
      -- met een andere tellerstand binnen, waardoor de race telkens in een nieuwe
      -- run werd geknipt (14 runs in een race van 6 uur).
      SELECT l.completed_laps, l.source_device_id
        INTO v_run_laps, v_run_device
        FROM public.endurance_strategy_lap_samples l
       WHERE l.race_run_id = r AND l.completed_laps IS NOT NULL
       ORDER BY l.captured_at DESC
       LIMIT 1;

      IF v_run_device = d.id AND v_run_laps IS NOT NULL AND nl + 2 < v_run_laps THEN
        UPDATE public.endurance_race_runs
           SET status = 'ended', ended_at = clock_timestamp()
         WHERE id = r AND status = 'active';
        PERFORM public.simhub_start_race_run(e, t, 'race');
        SELECT id INTO r FROM public.endurance_race_runs
         WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
         LIMIT 1;
        -- Deze ronde is de nulmeting van de nieuwe run; de volgende telt.
        s.previous_completed_laps := nl;
      END IF;
    END IF;

    IF NOT baseline AND r IS NOT NULL THEN
      IF s.previous_completed_laps IS NOT NULL AND nl = s.previous_completed_laps + 1 THEN
        k := 'lap:' || nl;
        payload := jsonb_build_object(
          'completedLaps', nl,
          'lastLapTimeSeconds', v_last_laptime,
          -- Identiteit mee, zodat de lees-kant altijd een bron heeft.
          'identity', coalesce(p_v3_normalized->'identity', '{}'::jsonb),
          'driverName', v_driver_name
        );
        -- S2: in_pit_lane, fuel_litres en fuel_per_lap_litres gaan mee. Niemand
        -- schreef ze ooit, waardoor pitstops achteraf onvindbaar waren; deze drie
        -- waren altijd null, dus er kan niets op gebroken zijn.
        INSERT INTO public.endurance_telemetry_events(
          device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
          event_detection_source,completed_laps,driver_id,lap,lap_time_from_deltas_s,payload,race_run_id,
          in_pit_lane,fuel_litres,fuel_per_lap_litres)
        VALUES(
          d.id,e,t,p_session_id,'lap_completed',k,p_sequence,p_captured_at,
          'simhub_v3_transition',nl,v_driver_id,nl,v_last_laptime,payload,r,
          np,v_fuel,NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}','')::numeric)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    INSERT INTO public.endurance_source_segments(
      device_id,session_id,event_id,team_id,race_run_id,last_sequence,
      previous_completed_laps,previous_in_pit_lane,previous_incidents,previous_flags)
    VALUES(d.id,p_session_id,e,t,r,p_sequence,nl,np,ni,nf)
    ON CONFLICT(device_id,session_id,event_id,team_id) DO UPDATE SET
      race_run_id=excluded.race_run_id,
      last_sequence=excluded.last_sequence,
      previous_completed_laps=excluded.previous_completed_laps,
      previous_in_pit_lane=excluded.previous_in_pit_lane,
      previous_incidents=excluded.previous_incidents,
      previous_flags=excluded.previous_flags,
      updated_at=clock_timestamp();
  END IF;

  -- Always store latest snapshot (device-scoped when unbounded: event/team/race_run NULL).
  INSERT INTO public.simhub_telemetry_latest(
    device_id,owner_user_id,race_id,team_id,session_id,sequence,captured_at,received_at,
    connector_id,simhub_version,connector_version,game,telemetry,
    endurance_event_id,endurance_team_id,race_run_id,
    driver_id,current_driver_id,current_driver_name,v3_normalized,
      car_id,car_name,track_name,track_config)
  VALUES(d.id,d.owner_user_id,d.race_id,d.team_id,p_session_id,p_sequence,p_captured_at,now_at,
    d.connector_id,v_simhub_version,v_connector_version,'IRacing','{}',
    e,t,r,
    v_driver_id,
    nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverId}','')),''),
    v_driver_name,
    p_v3_normalized,
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,carId}','')),''),
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,carName}','')),''),
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}','')),''),
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,trackConfig}','')),''))
  ON CONFLICT(device_id) DO UPDATE SET
    session_id=excluded.session_id, sequence=excluded.sequence, captured_at=excluded.captured_at,
    received_at=excluded.received_at,
    -- De versies horen bij het laatste frame. Een frame zonder source-blok wist ze
    -- naar null: onbekend blijft onbekend, en de oude apparaatnaam verdwijnt in
    -- plaats van voor altijd te blijven staan.
    simhub_version=excluded.simhub_version,
    connector_version=excluded.connector_version,
    endurance_event_id=excluded.endurance_event_id, endurance_team_id=excluded.endurance_team_id,
    race_run_id=excluded.race_run_id,
    driver_id=excluded.driver_id,
    current_driver_id=excluded.current_driver_id,
    current_driver_name=excluded.current_driver_name,
    v3_normalized=excluded.v3_normalized,
      car_id=excluded.car_id, car_name=excluded.car_name,
      track_name=excluded.track_name, track_config=excluded.track_config;

  INSERT INTO public.simhub_device_sessions(device_id,session_id,last_sequence,first_seen_at,last_seen_at)
  VALUES(d.id,p_session_id,p_sequence,now_at,now_at)
  ON CONFLICT(device_id,session_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_seen_at=excluded.last_seen_at;

  UPDATE public.simhub_devices SET last_seen_at=now_at, last_session_id=p_session_id, last_sequence=p_sequence, updated_at=now_at WHERE id=d.id;

  IF e IS NOT NULL THEN
    IF r IS NOT NULL AND NOT baseline THEN
      PERFORM public.simhub_update_strategy_v3(
        r,d.id,p_session_id,p_sequence,e,t,nl,v_fuel,np,v_last_laptime,v_session_laps,
        baseline,s.previous_completed_laps,s.previous_in_pit_lane);

        -- Bandenslijtage hoort bij dezelfde ronde, maar alleen hier is de
        -- payload beschikbaar; de strategiefunctie krijgt losse getallen.
        -- Alleen vullen als het een getal is, anders blijft de kolom leeg.
        IF nl IS NOT NULL THEN
          UPDATE public.endurance_strategy_lap_samples
             SET wear_fl = CASE WHEN (p_v3_normalized->'vehicle'->'frontLeft'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'frontLeft'->>'wearPercent')::numeric END,
                 wear_fr = CASE WHEN (p_v3_normalized->'vehicle'->'frontRight'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'frontRight'->>'wearPercent')::numeric END,
                 wear_rl = CASE WHEN (p_v3_normalized->'vehicle'->'rearLeft'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'rearLeft'->>'wearPercent')::numeric END,
                 wear_rr = CASE WHEN (p_v3_normalized->'vehicle'->'rearRight'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'rearRight'->>'wearPercent')::numeric END
           WHERE race_run_id = r AND completed_laps = nl
             AND wear_fl IS NULL AND wear_fr IS NULL
             AND wear_rl IS NULL AND wear_rr IS NULL;
        END IF;

        -- ------------------------------------------------------------------
        -- S2: de pitvlag-overgang. Alles wat hier gebeurt, gebeurt alleen op
        -- deze flank en nergens anders:
        --   1. de pit_entry/pit_exit-events die er nooit waren. Zonder deze
        --      events blijft pit_loss voor elke toekomstige race null, ook al
        --      staat in_pit_lane straks op de lap-rijen: derive_pit_stops()
        --      rekent met captured_at-verschillen en een stop kan midden in
        --      een ronde beginnen en eindigen.
        --   2. het banden-anker op de EXIT-overgang. Op entry staan de
        --      wear-kanalen nog op de vorige service; pas na de service staan
        --      ze op de staat van de gemonteerde banden. Wie op entry ankert,
        --      schrijft een verouderd getal als meting weg.
        --
        -- Twee harde regels:
        --   * INSERT ... SELECT ... WHERE, nooit INSERT ... VALUES. Ontbreekt
        --     vehicle in de payload (uitgebreide telemetrie uit), dan levert de
        --     WHERE nul rijen en gebeurt er niets. Een VALUES met null in een
        --     not-null-kolom zou een exception geven en daarmee de HELE
        --     snapshot terugdraaien: de coureur verliest dan zijn ronde omdat
        --     wij een anker niet konden schrijven.
        --   * Het hele blok zit in BEGIN ... EXCEPTION WHEN OTHERS THEN NULL.
        --     Een anker is bijzaak, de lap-sample is hoofdzaak. Het stille
        --     falen is detecteerbaar: nul ankers bij wel toenemende
        --     lap-samples betekent dat dit pad stuk is.
        -- ------------------------------------------------------------------
        IF nl IS NOT NULL AND np IS NOT NULL AND np IS DISTINCT FROM s.previous_in_pit_lane THEN
          BEGIN
            IF np IS TRUE THEN
              INSERT INTO public.endurance_telemetry_events(
                device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
                event_detection_source,completed_laps,in_pit_lane,lap,payload,race_run_id)
              SELECT d.id,e,t,p_session_id,'pit_entry','pit_entry:'||p_sequence::text,p_sequence,p_captured_at,
                     'simhub_v3_transition',nl,true,nl,
                     jsonb_build_object('completedLaps',nl,'inPitLane',true),r
               WHERE s.previous_in_pit_lane IS FALSE
              ON CONFLICT DO NOTHING;
            ELSE
              INSERT INTO public.endurance_telemetry_events(
                device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
                event_detection_source,completed_laps,in_pit_lane,lap,payload,race_run_id)
              SELECT d.id,e,t,p_session_id,'pit_exit','pit_exit:'||p_sequence::text,p_sequence,p_captured_at,
                     'simhub_v3_transition',nl,false,nl,
                     jsonb_build_object('completedLaps',nl,'inPitLane',false),r
               WHERE s.previous_in_pit_lane IS TRUE
              ON CONFLICT DO NOTHING;

              -- Payloadvelden één keer inlezen, met dezelfde guard als de
              -- wear-update hierboven: alleen als het een getal is.
              v_anchor_fl := CASE WHEN (p_v3_normalized#>>'{vehicle,frontLeft,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,frontLeft,wearPercent}')::numeric END;
              v_anchor_fr := CASE WHEN (p_v3_normalized#>>'{vehicle,frontRight,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,frontRight,wearPercent}')::numeric END;
              v_anchor_rl := CASE WHEN (p_v3_normalized#>>'{vehicle,rearLeft,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,rearLeft,wearPercent}')::numeric END;
              v_anchor_rr := CASE WHEN (p_v3_normalized#>>'{vehicle,rearRight,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,rearRight,wearPercent}')::numeric END;
              v_zone_fl_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fl,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fl,l}')::numeric END;
              v_zone_fl_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fl,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fl,m}')::numeric END;
              v_zone_fl_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fl,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fl,r}')::numeric END;
              v_zone_fr_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fr,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fr,l}')::numeric END;
              v_zone_fr_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fr,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fr,m}')::numeric END;
              v_zone_fr_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fr,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fr,r}')::numeric END;
              v_zone_rl_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rl,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rl,l}')::numeric END;
              v_zone_rl_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rl,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rl,m}')::numeric END;
              v_zone_rl_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rl,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rl,r}')::numeric END;
              v_zone_rr_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rr,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rr,l}')::numeric END;
              v_zone_rr_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rr,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rr,m}')::numeric END;
              v_zone_rr_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rr,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rr,r}')::numeric END;
              v_anchor_track := CASE WHEN (p_v3_normalized#>>'{tyres,environment,trackTempC}') ~ '^-?[0-9]+([.][0-9]+)?$'
                                     THEN (p_v3_normalized#>>'{tyres,environment,trackTempC}')::numeric END;
              v_anchor_air   := CASE WHEN (p_v3_normalized#>>'{tyres,environment,airTempC}') ~ '^-?[0-9]+([.][0-9]+)?$'
                                     THEN (p_v3_normalized#>>'{tyres,environment,airTempC}')::numeric END;
              v_anchor_rubber := CASE WHEN char_length(btrim(coalesce(p_v3_normalized#>>'{tyres,environment,rubberState}',''))) BETWEEN 1 AND 64
                                      THEN btrim(p_v3_normalized#>>'{tyres,environment,rubberState}') END;
              v_anchor_source := p_v3_normalized#>>'{vehicle,tyreDataMode}';
              v_anchor_sets   := CASE WHEN (p_v3_normalized#>>'{tyres,sets,used}') ~ '^[0-9]+$'
                                      THEN (p_v3_normalized#>>'{tyres,sets,used}')::integer END;

              -- stint_no en tyre_set_no komen uit het vorige anker van DEZELFDE
              -- run, niet uit de lap-samples: de lap-sample heeft geen setbegrip
              -- en fuel_stint_id is aantoonbaar onbetrouwbaar (dezelfde id dekt
              -- 1 tot 36 rondes). Het vorige anker wordt ook meegenomen als het
              -- onbruikbaar is: zo blijft de nummering aaneengesloten en blijft
              -- 'frozen' (identiek aan de vorige momentopname) detecteerbaar.
              INSERT INTO public.endurance_tyre_anchors(
                event_id,team_id,race_run_id,device_id,session_id,stint_no,anchor_lap,
                tyre_set_no,tyre_changed,
                wear_fl,wear_fr,wear_rl,wear_rr,
                wear_fl_l, wear_fl_m, wear_fl_r, wear_fr_l, wear_fr_m, wear_fr_r, wear_rl_l, wear_rl_m, wear_rl_r, wear_rr_l, wear_rr_m, wear_rr_r,
                track_temp_c,air_temp_c,rubber_state,wear_source,wear_frozen,anchor_usable,captured_at)
              SELECT e,t,r,d.id,p_session_id,x.stint_no,nl,
                     x.tyre_set_no,x.tyre_changed,
                     v_anchor_fl,v_anchor_fr,v_anchor_rl,v_anchor_rr,
                     v_zone_fl_l, v_zone_fl_m, v_zone_fl_r, v_zone_fr_l, v_zone_fr_m, v_zone_fr_r, v_zone_rl_l, v_zone_rl_m, v_zone_rl_r, v_zone_rr_l, v_zone_rr_m, v_zone_rr_r,
                     v_anchor_track,v_anchor_air,v_anchor_rubber,
                     CASE WHEN v_anchor_source = 'live' THEN 'live' ELSE 'last_available' END,
                     x.frozen, NOT x.frozen, p_captured_at
                FROM (
                  SELECT coalesce(a.stint_no, 0) + 1 AS stint_no,
                         -- set_no volgt de sim-teller (TireSetsUsed, 0-based), dus 1-based.
                         CASE WHEN v_anchor_sets IS NULL THEN NULL ELSE v_anchor_sets + 1 END AS tyre_set_no,
                         -- null = onbekend (geen teller of geen vorig anker), niet false.
                         CASE WHEN v_anchor_sets IS NULL OR a.tyre_set_no IS NULL THEN NULL
                              ELSE (v_anchor_sets + 1) <> a.tyre_set_no END AS tyre_changed,
                         coalesce(a.wear_fl = v_anchor_fl AND a.wear_fr = v_anchor_fr
                                  AND a.wear_rl = v_anchor_rl AND a.wear_rr = v_anchor_rr, false) AS frozen
                    FROM (SELECT 1) AS dummy
                    LEFT JOIN LATERAL (
                      SELECT prev.stint_no, prev.tyre_set_no,
                             prev.wear_fl, prev.wear_fr, prev.wear_rl, prev.wear_rr
                        FROM public.endurance_tyre_anchors prev
                       WHERE prev.race_run_id = r
                       ORDER BY prev.stint_no DESC
                       LIMIT 1
                    ) AS a ON true
                ) AS x
               WHERE v_anchor_fl IS NOT NULL AND v_anchor_fr IS NOT NULL
                 AND v_anchor_rl IS NOT NULL AND v_anchor_rr IS NOT NULL
                 AND s.previous_in_pit_lane IS TRUE
              ON CONFLICT (race_run_id, stint_no) DO NOTHING;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            -- Een anker is bijzaak. Nooit de snapshot laten klappen.
            NULL;
          END;
        END IF;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 0.8.0 — meetgebeurtenissen en rondeaggregaten
  -- ---------------------------------------------------------------------------
  -- Waarom PAS hier: het frame is op dit punt volledig verwerkt en de snapshot
  -- staat er. Een fout in de meetbatch mag nooit de ronde, de brandstof of de
  -- positie kosten (brief, paragraaf 3: ongeldige optionele meetblokken
  -- afzonderlijk afwijzen). Daarom een eigen blok met een eigen
  -- exception-handler: die draait alleen de meetbatch terug, niet het frame.
  --
  -- Waarom niet eerder: de batches hebben `d` nodig (het apparaat) en de
  -- sessie-id; en een event dat bij een afgekeurd frame hoort, hoort er niet in.
  IF p_events IS NOT NULL OR p_laps IS NOT NULL THEN
    BEGIN
      v_agg_ack := public.simhub_persist_measurement_batch(d.id, p_session_id, p_events, p_laps);

      -- De ack bevat per rij wat er gebeurde. De tellingen hieronder zijn alleen
      -- voor de waarschuwing in de logboeken.
      v_agg_events := coalesce(jsonb_array_length(v_agg_ack #> '{events,accepted}'), 0)
                    + coalesce(jsonb_array_length(v_agg_ack #> '{laps,accepted}'), 0);
      v_agg_rejected := coalesce(jsonb_array_length(v_agg_ack #> '{events,rejected}'), 0)
                      + coalesce(jsonb_array_length(v_agg_ack #> '{laps,rejected}'), 0);
      v_agg_duplicates := coalesce(jsonb_array_length(v_agg_ack #> '{events,duplicates}'), 0)
                        + coalesce(jsonb_array_length(v_agg_ack #> '{laps,duplicates}'), 0);

      -- Een afgekeurde of dubbele rij is geen fout in het frame, maar mag ook
      -- niet stil verdwijnen. De Edge logt de waarschuwing mee met het device.
      IF v_agg_rejected > 0 OR v_agg_duplicates > 0 THEN
        RAISE WARNING 'simhub_persist_v3 meetbatch: % geschreven, % afgekeurd, % dubbel (device %, sessie %)',
          v_agg_events + v_agg_laps, v_agg_rejected, v_agg_duplicates, d.id, p_session_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Nooit doorslikken zonder spoor: dit is de enige plek waar een kapotte
      -- meetbatch zichtbaar wordt.
      v_agg_ack := jsonb_build_object('ok', false, 'error', 'measurement_batch_failed');
      RAISE WARNING 'simhub_persist_v3 meetbatch mislukt: % (device %, sessie %)',
        SQLERRM, d.id, p_session_id;
    END;
  END IF;

  RETURN QUERY SELECT 'accepted'::text, now_at, v_agg_ack;
END
$function$;

revoke all on function public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text, jsonb, jsonb)
  to service_role;

comment on function public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text, jsonb, jsonb) is
  'Schrijft één V3-frame weg en geeft sinds 0.7.2.0 het meetrapport terug in measurement_ack (per rij accepted/duplicate/superseded/rejected met reden). Een fout in de meetbatch kost nooit het frame.';

do $guard$
declare
  v_overloads integer;
  v_args text;
begin
  select count(*) into v_overloads
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  if v_overloads <> 1 then
    raise exception 'simhub_persist_v3 heeft % overloads (42725)', v_overloads using errcode = '42725';
  end if;
  select pronargs::text into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  if v_args <> '8' then
    raise exception 'simhub_persist_v3 heeft % parameters in plaats van 8', v_args;
  end if;
end
$guard$;
