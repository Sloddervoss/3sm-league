-- ============================================================================
-- Plugin 0.7.2.0 — de verwijzing hoort bij de inhoud (review 2, open subpunt)
-- Datum: 2026-10-31
-- Vorige migratie: 20261031200400_plugin08_measurement_fast_path.sql
-- Tijdstempel: 200500 en niet 200000, want 20261031200000 is al de
--   lap_driver_semantics-migratie. Zo blijft de volgorde oplopend.
-- Reviewpunt: content_hash zonder supersedes_*
-- Status: voorstel. Niet toegepast op productie.
--
-- Het probleem
-- ------------
-- content_hash werd berekend over de meetvelden, maar niet over
-- supersedes_event_uid / supersedes_summary_uid. Een correctie die verder
-- precies dezelfde inhoud heeft (dezelfde waarneming, dezelfde tijd, hetzelfde
-- bewijs) en alleen de verwijzing naar het gecorrigeerde bericht toevoegt,
-- kreeg daardoor dezelfde vingerafdruk als het origineel. Bij dezelfde
-- record_revision werd zo'n rij als duplicaat ingekort en verdween de
-- verwijzing stilzwijgend: de correctie bestond dan niet op de server.
--
-- Wat hier verandert
-- ------------------
--   * De hash gaat over dezelfde velden plus de verwijzing. Twee rijen met
--     dezelfde inhoud maar een andere supersedes verschillen nu, en dezelfde
--     inhoud met dezelfde verwijzing blijft een duplicaat.
--   * Bestaande rijen krijgen de nieuwe hash (anders zou een herverzending van
--     een oude rij als conflict gelden). Alleen de hash wordt herschreven; geen
--     enkele meetwaarde, revisie of verwijzing verandert.
--   * De schrijver zelf verandert verder niet: dezelfde validatie, dezelfde
--     ACK-vorm, hetzelfde set-based snelpad met rij-voor-rij terugval.
--
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Bestaande rijen: dezelfde formule als de schrijver hieronder
-- ---------------------------------------------------------------------------
-- Een hash is geen integriteitsclaim naar buiten; hij bestaat alleen om een
-- herverzending te herkennen. Daarom mag hij op zijn plaats herschreven worden.
update public.simhub_measurement_events e
   set content_hash = md5(jsonb_build_object(
         'segmentId', e.segment_id, 'observedSessionId', e.observed_session_id,
         'pitVisitId', e.pit_visit_id, 'kind', e.kind, 'observedAt', e.observed_at,
         'sessionTimeSeconds', e.session_time_seconds, 'sdkTick', e.sdk_tick,
         'wearBefore', e.wear_before, 'wearAfter', e.wear_after,
         'setGeneration', e.set_generation, 'evidence', e.evidence,
         'confidence', e.confidence,
         'supersedesEventUid', e.supersedes_event_uid)::text);

update public.simhub_lap_summaries l
   set content_hash = md5(jsonb_build_object(
         'segmentId', l.segment_id, 'observedSessionId', l.observed_session_id,
         'lapNumber', l.lap_number,
         'startedAt', l.started_at, 'endedAt', l.ended_at,
         'currentDriverName', l.current_driver_name,
         'aggregationVersion', l.aggregation_version, 'complete', l.complete,
         'invalidReasons', l.invalid_reasons, 'pitLap', l.pit_lap,
         'driverChanged', l.driver_changed,
         'tmin', l.track_temp_c_min, 'tmax', l.track_temp_c_max,
         'tmean', l.track_temp_c_mean, 'amean', l.air_temp_c_mean,
         'fs', l.fuel_start_litres, 'fe', l.fuel_end_litres,
         'fi', l.fuel_level_integral_litre_seconds,
         'fa', l.fuel_added_litres_observed,
         'ai', l.abs_lat_accel_integral_g_seconds,
         'ai2', l.lat_accel_squared_integral_g2_seconds,
         'amax', l.max_abs_lat_accel_g, 'ali', l.abs_long_accel_integral_g_seconds,
         'vd', l.valid_duration_seconds, 'sc', l.sample_count, 'gap', l.max_gap_seconds,
         'pitIds', l.pit_visit_ids, 'wearIds', l.wear_observation_ids,
         'cov', l.coverage,
         'supersedesSummaryUid', l.supersedes_summary_uid)::text);

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
  -- Elke bevestiging is een object {id, record_revision}: zonder de
  -- bevestigde revisie weet een outbox met meerdere revisies van dezelfde UUID
  -- niet welke versie de server heeft aangenomen.
  ev_acc jsonb := '[]'::jsonb;
  ev_dup jsonb := '[]'::jsonb;
  ev_sup jsonb := '[]'::jsonb;
  ev_rej jsonb := '[]'::jsonb;
  ev_block text;
  lp_recv integer := 0;
  lp_acc jsonb := '[]'::jsonb;
  lp_dup jsonb := '[]'::jsonb;
  lp_sup jsonb := '[]'::jsonb;
  lp_rej jsonb := '[]'::jsonb;
  lp_block text;

  v_uid uuid; v_seg text; v_pit text; v_kind text; v_obs text;
  v_at timestamptz; v_st double precision; v_tick bigint;
  v_wb jsonb; v_wa jsonb; v_sg jsonb; v_ev jsonb; v_conf double precision;
  v_rev integer; v_supersedes uuid; v_hash text; v_prev_rev integer; v_prev_hash text;
  -- Snelpad: rijen worden gevalideerd en geclassificeerd in de lus, maar
  -- geschreven in één set-based statement. Mislukt dat, dan volgt een
  -- rij-voor-rij terugval met dezelfde al gevalideerde waarden.
  ev_ins jsonb := '[]'::jsonb;
  ev_upd jsonb := '[]'::jsonb;
  lp_ins jsonb := '[]'::jsonb;
  lp_upd jsonb := '[]'::jsonb;
  v_prev jsonb;
  v_apply record;
  v_updated integer;

  v_sum uuid; v_lap integer; v_drv_id uuid; v_drv_name text; v_agg integer; v_complete boolean;
  v_event uuid; v_team uuid;
  v_cov jsonb;
  v_reasons text[]; v_pitlap boolean; v_drvchg boolean; v_cover_reasons text[];
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

  -- De rijder van een ronde wordt SERVER-SIDE geresolveerd. De client kent
  -- alleen de SimHub-naam; een UUID die hij zelf invult is per definitie
  -- onbetrouwbaar (en meestal helemaal niet bekend). Event en team komen uit de
  -- apparaatbinding, dezelfde bron die het kernframe gebruikt.
  select d.endurance_event_id, d.endurance_team_id into v_event, v_team
    from public.simhub_devices d
   where d.id = p_device_id;

  -- -------------------------------------------------------------------------
  -- Meetgebeurtenissen
  -- -------------------------------------------------------------------------
  if p_events is not null then
    begin
      -- Ook een afgekeurde reeks is ontvangen: het totaal beschrijft de
      -- aangeboden reeks, niet wat er na inkorting overbleef.
      if jsonb_typeof(p_events) = 'array' then
        ev_recv := jsonb_array_length(p_events);
      end if;
      if jsonb_typeof(p_events) <> 'array' then
        ev_block := 'not_an_array';
      elsif jsonb_array_length(p_events) > v_max_events then
        ev_block := 'too_many';
      else
        -- Eén query voor de bestaande stand van alle aangeboden UUID's in
        -- plaats van een SELECT per rij.
        select coalesce(jsonb_object_agg(e.event_uid::text,
                                         jsonb_build_object('rev', e.record_revision,
                                                            'hash', e.content_hash)), '{}'::jsonb)
          into v_prev
          from public.simhub_measurement_events e
         where e.device_id = v_device
           and e.event_uid in (
             select (x.value->>'eventUid')::uuid
               from jsonb_array_elements(p_events) x
              where public.simhub_jvalid(x.value->'eventUid', 'uuid'));
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
            -- Inhoudelijk contract voor wear en bewijs: geen vrije vorm meer.
            if not public.simhub_wear_v1_valid(v_wb) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'wear_before_contract', v_max_rejects);
              continue;
            end if;
            if not public.simhub_wear_v1_valid(v_wa) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'wear_after_contract', v_max_rejects);
              continue;
            end if;
            if not public.simhub_set_generation_valid(v_sg) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'set_generation_contract', v_max_rejects);
              continue;
            end if;
            if not public.simhub_evidence_v1_valid(v_ev) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'evidence_contract', v_max_rejects);
              continue;
            end if;
            -- Een wear-waarneming zonder bewijsgrond of zonder confidence is geen
            -- waarneming: weigeren, niet als 'zeker' opslaan.
            if (v_wb is not null or v_wa is not null) and v_ev is null then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'evidence_missing', v_max_rejects);
              continue;
            end if;
            if (v_wb is not null or v_wa is not null) and v_conf is null then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'confidence_missing', v_max_rejects);
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
              'setGeneration', v_sg, 'evidence', v_ev, 'confidence', v_conf,
              'supersedesEventUid', v_supersedes)::text);

            v_prev_rev := null;
            v_prev_hash := null;
            if v_prev ? v_uid::text then
              v_prev_rev := (v_prev -> v_uid::text ->> 'rev')::integer;
              v_prev_hash := v_prev -> v_uid::text ->> 'hash';
            end if;

            if v_prev_rev is null then
              -- Nieuw: later in één statement ingevoegd.
              ev_ins := ev_ins || jsonb_build_object(
                'id', gen_random_uuid(),
                'device_id', v_device, 'event_uid', v_uid, 'event_id', v_name,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'pit_visit_id', v_pit, 'kind', v_kind, 'observed_at', v_at,
                'session_time_seconds', v_st, 'sdk_tick', v_tick,
                'wear_before', v_wb, 'wear_after', v_wa, 'set_generation', v_sg,
                'evidence', v_ev, 'confidence', v_conf, 'record_revision', v_rev,
                'content_hash', v_hash, 'supersedes_event_uid', v_supersedes,
                '_label', v_label, '_index', v_rec.ord - 1);
              ev_acc := ev_acc || jsonb_build_object('id', v_uid::text, 'record_revision', v_rev);
            elsif v_rev > v_prev_rev then
              -- Hogere revisie: later in één statement bijgewerkt.
              ev_upd := ev_upd || jsonb_build_object(
                'device_id', v_device, 'event_uid', v_uid, 'event_id', v_name,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'pit_visit_id', v_pit, 'kind', v_kind, 'observed_at', v_at,
                'session_time_seconds', v_st, 'sdk_tick', v_tick,
                'wear_before', v_wb, 'wear_after', v_wa, 'set_generation', v_sg,
                'evidence', v_ev, 'confidence', v_conf, 'record_revision', v_rev,
                'content_hash', v_hash, 'supersedes_event_uid', v_supersedes,
                '_label', v_label, '_index', v_rec.ord - 1);
              ev_sup := ev_sup || jsonb_build_object('id', v_uid::text, 'record_revision', v_rev);
            elsif v_rev = v_prev_rev and v_hash is not distinct from v_prev_hash then
              -- Zelfde revisie, zelfde inhoud: herverzending uit de oude outbox.
              ev_dup := ev_dup || jsonb_build_object('id', v_uid::text, 'record_revision', v_prev_rev);
            elsif v_rev = v_prev_rev then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'revision_conflict', v_max_rejects);
            else
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'stale_revision', v_max_rejects);
            end if;
          exception when others then
            ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'row_failed:' || sqlstate, v_max_rejects);
          end;
        end loop;

        -- Set-based snelpad: alle nieuwe rijen in één INSERT, alle hogere
        -- revisies in één UPDATE. Mislukt dat (bijvoorbeeld twee dezelfde
        -- UUID's in één batch), dan wordt de hele toepassing teruggedraaid en
        -- volgt de rij-voor-rij terugval hieronder.
        if jsonb_array_length(ev_ins) > 0 or jsonb_array_length(ev_upd) > 0 then
          begin
            if jsonb_array_length(ev_ins) > 0 then
              insert into public.simhub_measurement_events (
                id, device_id, event_uid, event_id, observed_session_id, delivered_session_id,
                transport_session_id, segment_id, pit_visit_id, kind, observed_at,
                session_time_seconds, sdk_tick, wear_before, wear_after, set_generation,
                evidence, confidence, record_revision, content_hash, supersedes_event_uid)
              select r.id, r.device_id, r.event_uid, r.event_id, r.observed_session_id,
                     r.delivered_session_id, r.transport_session_id, r.segment_id,
                     r.pit_visit_id, r.kind, r.observed_at, r.session_time_seconds,
                     r.sdk_tick, r.wear_before, r.wear_after, r.set_generation,
                     r.evidence, r.confidence, r.record_revision, r.content_hash,
                     r.supersedes_event_uid
                from jsonb_populate_recordset(null::public.simhub_measurement_events, ev_ins) r;
            end if;
            if jsonb_array_length(ev_upd) > 0 then
              update public.simhub_measurement_events e
                 set event_id = u.event_id,
                     observed_session_id = u.observed_session_id,
                     delivered_session_id = u.delivered_session_id,
                     transport_session_id = u.transport_session_id,
                     segment_id = u.segment_id,
                     pit_visit_id = u.pit_visit_id,
                     kind = u.kind,
                     observed_at = u.observed_at,
                     session_time_seconds = u.session_time_seconds,
                     sdk_tick = u.sdk_tick,
                     wear_before = u.wear_before,
                     wear_after = u.wear_after,
                     set_generation = u.set_generation,
                     evidence = u.evidence,
                     confidence = u.confidence,
                     record_revision = u.record_revision,
                     supersedes_event_uid = coalesce(u.supersedes_event_uid, e.supersedes_event_uid),
                     content_hash = u.content_hash,
                     received_at = now()
                from jsonb_populate_recordset(null::public.simhub_measurement_events, ev_upd) u
               where e.device_id = u.device_id and e.event_uid = u.event_uid;
              get diagnostics v_updated = row_count;
              -- Niet alle aangeboden revisies zijn bijgewerkt (rij verdwenen?):
              -- dan liever de rij-voor-rij terugval dan een onjuiste ACK.
              if v_updated <> jsonb_array_length(ev_upd) then
                raise exception 'fast_path_incomplete' using errcode = 'P0001';
              end if;
            end if;
          exception when others then
            -- Alles terug en opnieuw, rij voor rij, met dezelfde waarden.
            ev_acc := '[]'::jsonb;
            ev_sup := '[]'::jsonb;
            for v_apply in
              select value as row from jsonb_array_elements(ev_ins)
            loop
              begin
                insert into public.simhub_measurement_events (
                  id, device_id, event_uid, event_id, observed_session_id, delivered_session_id,
                  transport_session_id, segment_id, pit_visit_id, kind, observed_at,
                  session_time_seconds, sdk_tick, wear_before, wear_after, set_generation,
                  evidence, confidence, record_revision, content_hash, supersedes_event_uid)
                select r.id, r.device_id, r.event_uid, r.event_id, r.observed_session_id,
                       r.delivered_session_id, r.transport_session_id, r.segment_id,
                       r.pit_visit_id, r.kind, r.observed_at, r.session_time_seconds,
                       r.sdk_tick, r.wear_before, r.wear_after, r.set_generation,
                       r.evidence, r.confidence, r.record_revision, r.content_hash,
                       r.supersedes_event_uid
                  from jsonb_populate_record(null::public.simhub_measurement_events,
                                             v_apply.row - '_label' - '_index') r
                 on conflict (device_id, event_uid) do nothing;
                if found then
                  ev_acc := ev_acc || jsonb_build_object('id', v_apply.row->>'event_uid',
                                                         'record_revision', (v_apply.row->>'record_revision')::integer);
                else
                  -- Bestond al: opnieuw classificeren, geen stil verlies.
                  select e.record_revision, e.content_hash into v_prev_rev, v_prev_hash
                    from public.simhub_measurement_events e
                   where e.device_id = v_device and e.event_uid = (v_apply.row->>'event_uid')::uuid;
                  if v_prev_rev = (v_apply.row->>'record_revision')::integer
                     and v_prev_hash = v_apply.row->>'content_hash' then
                    ev_dup := ev_dup || jsonb_build_object('id', v_apply.row->>'event_uid',
                                                           'record_revision', v_prev_rev);
                  elsif v_prev_rev = (v_apply.row->>'record_revision')::integer then
                    ev_rej := public.simhub_ack_reject(ev_rej, v_apply.row->>'_label',
                                                       (v_apply.row->>'_index')::integer, 'revision_conflict', v_max_rejects);
                  else
                    ev_rej := public.simhub_ack_reject(ev_rej, v_apply.row->>'_label',
                                                       (v_apply.row->>'_index')::integer, 'stale_revision', v_max_rejects);
                  end if;
                end if;
              exception when others then
                ev_rej := public.simhub_ack_reject(ev_rej, v_apply.row->>'_label',
                                                   (v_apply.row->>'_index')::integer,
                                                   'row_failed:' || sqlstate, v_max_rejects);
              end;
            end loop;
            for v_apply in select value as row from jsonb_array_elements(ev_upd)
            loop
              begin
                update public.simhub_measurement_events e
                   set event_id = u.event_id,
                       observed_session_id = u.observed_session_id,
                       delivered_session_id = u.delivered_session_id,
                       transport_session_id = u.transport_session_id,
                       segment_id = u.segment_id,
                       pit_visit_id = u.pit_visit_id,
                       kind = u.kind,
                       observed_at = u.observed_at,
                       session_time_seconds = u.session_time_seconds,
                       sdk_tick = u.sdk_tick,
                       wear_before = u.wear_before,
                       wear_after = u.wear_after,
                       set_generation = u.set_generation,
                       evidence = u.evidence,
                       confidence = u.confidence,
                       record_revision = u.record_revision,
                       supersedes_event_uid = coalesce(u.supersedes_event_uid, e.supersedes_event_uid),
                       content_hash = u.content_hash,
                       received_at = now()
                  from jsonb_populate_record(null::public.simhub_measurement_events,
                                             v_apply.row - '_label' - '_index') u
                 where e.device_id = v_device and e.event_uid = u.event_uid;
                ev_sup := ev_sup || jsonb_build_object('id', v_apply.row->>'event_uid',
                                                       'record_revision', (v_apply.row->>'record_revision')::integer);
              exception when others then
                ev_rej := public.simhub_ack_reject(ev_rej, v_apply.row->>'_label',
                                                   (v_apply.row->>'_index')::integer,
                                                   'row_failed:' || sqlstate, v_max_rejects);
              end;
            end loop;
          end;
        end if;
      end if;
    exception when others then
      -- De hele reekstransactie is teruggedraaid: dan mag de ACK geen enkele
      -- bevestiging meer noemen. Anders claimt hij rijen die niet bestaan.
      ev_block := 'series_failed:' || sqlstate;
      ev_acc := '[]'::jsonb;
      ev_dup := '[]'::jsonb;
      ev_sup := '[]'::jsonb;
    end;
  end if;

  -- -------------------------------------------------------------------------
  -- Rondeaggregaten
  -- -------------------------------------------------------------------------
  if p_laps is not null then
    begin
      if jsonb_typeof(p_laps) = 'array' then
        lp_recv := jsonb_array_length(p_laps);
      end if;
      if jsonb_typeof(p_laps) <> 'array' then
        lp_block := 'not_an_array';
      elsif jsonb_array_length(p_laps) > v_max_laps then
        lp_block := 'too_many';
      else
        select coalesce(jsonb_object_agg(l.summary_uid::text,
                                         jsonb_build_object('rev', l.record_revision,
                                                            'hash', l.content_hash)), '{}'::jsonb)
          into v_prev
          from public.simhub_lap_summaries l
         where l.device_id = v_device
           and l.summary_uid in (
             select (x.value->>'summaryUid')::uuid
               from jsonb_array_elements(p_laps) x
              where public.simhub_jvalid(x.value->'summaryUid', 'uuid'));
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
               or not public.simhub_jvalid(v_rec.row->'currentDriverName', 'string', 1, 64)
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
            if not public.simhub_jvalid(v_rec.row->'sampleCount', 'integer', 0, 100000000) then
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
            -- Een UUID is geen clientgegeven. Wie hem toch meestuurt, krijgt een
            -- afwijzing met reden in plaats van een stil genegeerd veld.
            if v_rec.row ? 'currentDriverId' and v_rec.row->'currentDriverId' <> 'null'::jsonb then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'client_driver_id_forbidden', v_max_rejects);
              continue;
            end if;
            v_drv_name := nullif(btrim(coalesce(v_rec.row->>'currentDriverName', '')), '');
            v_drv_id := null;
            if v_drv_name is not null then
              -- Naam -> user_id, binnen het team van dit apparaat en anders
              -- globaal. Geen match of twijfel: leeg, nooit een gok.
              v_drv_id := public.simhub_resolve_driver_user(v_event, v_team, v_drv_name)::uuid;
            end if;
            v_agg := coalesce(public.simhub_jint(v_rec.row->'aggregationVersion'), 1);
            v_complete := public.simhub_jbool(v_rec.row->'complete');
            v_reasons := public.simhub_jtextarray(v_rec.row->'invalidReasons', 16);
            v_pitlap := public.simhub_jbool(v_rec.row->'pitLap');
            v_drvchg := public.simhub_jbool(v_rec.row->'driverChanged');
            -- Een rijderwissel binnen de ronde en tóch één naam: tegenstrijdig.
            -- Niet normaliseren (welke van de twee zou het zijn?), maar weigeren.
            if v_drvchg is true and v_drv_name is not null then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'driver_changed_with_driver', v_max_rejects);
              continue;
            end if;
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
            -- Dekking per metriekgroep. Een waarde zonder dekking is geen meting:
            -- de rij wordt geweigerd in plaats van als 'compleet' opgeslagen met
            -- een lege dekking.
            if not public.simhub_coverage_valid(v_cov) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_contract', v_max_rejects);
              continue;
            end if;
            if (v_tmean is not null or v_tmin is not null or v_tmax is not null or v_amean is not null)
               and not public.simhub_coverage_has(v_cov, 'temperature') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_missing:temperature', v_max_rejects);
              continue;
            end if;
            if (v_fi is not null or v_fa is not null) and not public.simhub_coverage_has(v_cov, 'fuel') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_missing:fuel', v_max_rejects);
              continue;
            end if;
            if (v_ai is not null or v_ai2 is not null or v_amax is not null or v_ali is not null)
               and not public.simhub_coverage_has(v_cov, 'load') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_missing:load', v_max_rejects);
              continue;
            end if;
            -- "Compleet" is een claim over de hele ronde. Onvoldoende dekking
            -- is geen framefout: de ronde blijft geldig, maar de claim gaat naar
            -- false en de reden komt in invalid_reasons. Dezelfde regel als in de
            -- Edge-parser (coverageVerdict).
            if v_complete is true then
              v_cover_reasons := public.simhub_coverage_reasons(
                v_cov,
                public.simhub_jtimestamptz(v_rec.row->'startedAt'),
                public.simhub_jtimestamptz(v_rec.row->'endedAt'));
              if cardinality(v_cover_reasons) > 0 then
                v_complete := false;
                v_reasons := (select array_agg(x order by x)
                                from (select distinct unnest(coalesce(v_reasons, '{}'::text[])
                                                            || v_cover_reasons) as x
                                       limit 16) q);
              end if;
            end if;
            -- De vlakke dekkingskolommen zijn een samenvatting van de groepen; ze
            -- worden afgeleid en nooit uit de payload overgenomen.
            if v_cov is not null then
              v_vd := public.simhub_coverage_valid_duration(v_cov);
              v_gap := public.simhub_coverage_max_gap(v_cov);
              v_sc := public.simhub_coverage_sample_total(v_cov)::double precision;
            end if;
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
              'currentDriverName', v_drv_name, 'aggregationVersion', v_agg, 'complete', v_complete,
              'invalidReasons', v_reasons, 'pitLap', v_pitlap, 'driverChanged', v_drvchg,
              'tmin', v_tmin, 'tmax', v_tmax, 'tmean', v_tmean, 'amean', v_amean,
              'fs', v_fs, 'fe', v_fe, 'fi', v_fi, 'fa', v_fa,
              'ai', v_ai, 'ai2', v_ai2, 'amax', v_amax, 'ali', v_ali,
              'vd', v_vd, 'sc', v_sc, 'gap', v_gap, 'pitIds', v_pitids, 'wearIds', v_wearids, 'cov', v_cov,
              'supersedesSummaryUid', v_supersedes)::text);

            v_prev_rev := null;
            v_prev_hash := null;
            if v_prev ? v_sum::text then
              v_prev_rev := (v_prev -> v_sum::text ->> 'rev')::integer;
              v_prev_hash := v_prev -> v_sum::text ->> 'hash';
            end if;

            if v_prev_rev is null then
              lp_ins := lp_ins || jsonb_build_object(
                'id', gen_random_uuid(),
                'summary_uid', v_sum, 'summary_id', v_name, 'device_id', v_device,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'lap_number', v_lap,
                'started_at', public.simhub_jtimestamptz(v_rec.row->'startedAt'),
                'ended_at', public.simhub_jtimestamptz(v_rec.row->'endedAt'),
                'current_driver_id', v_drv_id, 'current_driver_name', v_drv_name,
                'aggregation_version', v_agg, 'complete', v_complete,
                'invalid_reasons', v_reasons, 'pit_lap', v_pitlap,
                'driver_changed', v_drvchg, 'track_temp_c_mean', v_tmean,
                'track_temp_c_min', v_tmin, 'track_temp_c_max', v_tmax,
                'air_temp_c_mean', v_amean, 'fuel_start_litres', v_fs,
                'fuel_end_litres', v_fe, 'fuel_level_integral_litre_seconds', v_fi,
                'fuel_added_litres_observed', v_fa,
                'abs_lat_accel_integral_g_seconds', v_ai,
                'lat_accel_squared_integral_g2_seconds', v_ai2,
                'max_abs_lat_accel_g', v_amax,
                'abs_long_accel_integral_g_seconds', v_ali,
                'valid_duration_seconds', v_vd, 'sample_count', v_sc::bigint,
                'max_gap_seconds', v_gap, 'pit_visit_ids', v_pitids,
                'wear_observation_ids', v_wearids, 'coverage', v_cov,
                'record_revision', v_rev, 'content_hash', v_hash,
                'supersedes_summary_uid', v_supersedes,
                '_label', v_label, '_index', v_rec.ord - 1);
              lp_acc := lp_acc || jsonb_build_object('id', v_sum::text, 'record_revision', v_rev);
            elsif v_rev > v_prev_rev then
              lp_upd := lp_upd || jsonb_build_object(
                'summary_uid', v_sum, 'summary_id', v_name, 'device_id', v_device,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'lap_number', v_lap,
                'started_at', public.simhub_jtimestamptz(v_rec.row->'startedAt'),
                'ended_at', public.simhub_jtimestamptz(v_rec.row->'endedAt'),
                'current_driver_id', v_drv_id, 'current_driver_name', v_drv_name,
                'aggregation_version', v_agg, 'complete', v_complete,
                'invalid_reasons', v_reasons, 'pit_lap', v_pitlap,
                'driver_changed', v_drvchg, 'track_temp_c_mean', v_tmean,
                'track_temp_c_min', v_tmin, 'track_temp_c_max', v_tmax,
                'air_temp_c_mean', v_amean, 'fuel_start_litres', v_fs,
                'fuel_end_litres', v_fe, 'fuel_level_integral_litre_seconds', v_fi,
                'fuel_added_litres_observed', v_fa,
                'abs_lat_accel_integral_g_seconds', v_ai,
                'lat_accel_squared_integral_g2_seconds', v_ai2,
                'max_abs_lat_accel_g', v_amax,
                'abs_long_accel_integral_g_seconds', v_ali,
                'valid_duration_seconds', v_vd, 'sample_count', v_sc::bigint,
                'max_gap_seconds', v_gap, 'pit_visit_ids', v_pitids,
                'wear_observation_ids', v_wearids, 'coverage', v_cov,
                'record_revision', v_rev, 'content_hash', v_hash,
                'supersedes_summary_uid', v_supersedes,
                '_label', v_label, '_index', v_rec.ord - 1);
              lp_sup := lp_sup || jsonb_build_object('id', v_sum::text, 'record_revision', v_rev);
            elsif v_rev = v_prev_rev and v_hash is not distinct from v_prev_hash then
              lp_dup := lp_dup || jsonb_build_object('id', v_sum::text, 'record_revision', v_prev_rev);
            elsif v_rev = v_prev_rev then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'revision_conflict', v_max_rejects);
            else
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'stale_revision', v_max_rejects);
            end if;
          exception when others then
            lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'row_failed:' || sqlstate, v_max_rejects);
          end;
        end loop;

        if jsonb_array_length(lp_ins) > 0 or jsonb_array_length(lp_upd) > 0 then
          begin
            if jsonb_array_length(lp_ins) > 0 then
              insert into public.simhub_lap_summaries (
                id, summary_uid, summary_id, device_id, observed_session_id, delivered_session_id,
                transport_session_id, segment_id, lap_number, started_at, ended_at,
                current_driver_id, current_driver_name, aggregation_version, complete,
                invalid_reasons, pit_lap, driver_changed, track_temp_c_mean, track_temp_c_min,
                track_temp_c_max, air_temp_c_mean, fuel_start_litres, fuel_end_litres,
                fuel_level_integral_litre_seconds, fuel_added_litres_observed,
                abs_lat_accel_integral_g_seconds, lat_accel_squared_integral_g2_seconds,
                max_abs_lat_accel_g, abs_long_accel_integral_g_seconds, valid_duration_seconds,
                sample_count, max_gap_seconds, pit_visit_ids, wear_observation_ids, coverage,
                record_revision, content_hash, supersedes_summary_uid)
              select r.id, r.summary_uid, r.summary_id, r.device_id, r.observed_session_id,
                     r.delivered_session_id, r.transport_session_id, r.segment_id, r.lap_number,
                     r.started_at, r.ended_at, r.current_driver_id, r.current_driver_name,
                     r.aggregation_version, r.complete, r.invalid_reasons, r.pit_lap,
                     r.driver_changed, r.track_temp_c_mean, r.track_temp_c_min,
                     r.track_temp_c_max, r.air_temp_c_mean, r.fuel_start_litres,
                     r.fuel_end_litres, r.fuel_level_integral_litre_seconds,
                     r.fuel_added_litres_observed, r.abs_lat_accel_integral_g_seconds,
                     r.lat_accel_squared_integral_g2_seconds, r.max_abs_lat_accel_g,
                     r.abs_long_accel_integral_g_seconds, r.valid_duration_seconds,
                     r.sample_count, r.max_gap_seconds, r.pit_visit_ids,
                     r.wear_observation_ids, r.coverage, r.record_revision, r.content_hash,
                     r.supersedes_summary_uid
                from jsonb_populate_recordset(null::public.simhub_lap_summaries, lp_ins) r;
            end if;
            if jsonb_array_length(lp_upd) > 0 then
              update public.simhub_lap_summaries l
                 set summary_id = u.summary_id,
                     observed_session_id = u.observed_session_id,
                     delivered_session_id = u.delivered_session_id,
                     transport_session_id = u.transport_session_id,
                     segment_id = u.segment_id,
                     lap_number = u.lap_number,
                     started_at = u.started_at,
                     ended_at = u.ended_at,
                     current_driver_id = u.current_driver_id,
                     current_driver_name = u.current_driver_name,
                     aggregation_version = u.aggregation_version,
                     complete = u.complete,
                     invalid_reasons = u.invalid_reasons,
                     pit_lap = u.pit_lap,
                     driver_changed = u.driver_changed,
                     track_temp_c_mean = u.track_temp_c_mean,
                     track_temp_c_min = u.track_temp_c_min,
                     track_temp_c_max = u.track_temp_c_max,
                     air_temp_c_mean = u.air_temp_c_mean,
                     fuel_start_litres = u.fuel_start_litres,
                     fuel_end_litres = u.fuel_end_litres,
                     fuel_level_integral_litre_seconds = u.fuel_level_integral_litre_seconds,
                     fuel_added_litres_observed = u.fuel_added_litres_observed,
                     abs_lat_accel_integral_g_seconds = u.abs_lat_accel_integral_g_seconds,
                     lat_accel_squared_integral_g2_seconds = u.lat_accel_squared_integral_g2_seconds,
                     max_abs_lat_accel_g = u.max_abs_lat_accel_g,
                     abs_long_accel_integral_g_seconds = u.abs_long_accel_integral_g_seconds,
                     valid_duration_seconds = u.valid_duration_seconds,
                     sample_count = u.sample_count,
                     max_gap_seconds = u.max_gap_seconds,
                     pit_visit_ids = u.pit_visit_ids,
                     wear_observation_ids = u.wear_observation_ids,
                     coverage = u.coverage,
                     record_revision = u.record_revision,
                     supersedes_summary_uid = coalesce(u.supersedes_summary_uid, l.supersedes_summary_uid),
                     content_hash = u.content_hash,
                     received_at = now()
                from jsonb_populate_recordset(null::public.simhub_lap_summaries, lp_upd) u
               where l.device_id = u.device_id and l.summary_uid = u.summary_uid;
              get diagnostics v_updated = row_count;
              if v_updated <> jsonb_array_length(lp_upd) then
                raise exception 'fast_path_incomplete' using errcode = 'P0001';
              end if;
            end if;
          exception when others then
            lp_acc := '[]'::jsonb;
            lp_sup := '[]'::jsonb;
            for v_apply in select value as row from jsonb_array_elements(lp_ins)
            loop
              begin
                insert into public.simhub_lap_summaries (
                  id, summary_uid, summary_id, device_id, observed_session_id, delivered_session_id,
                  transport_session_id, segment_id, lap_number, started_at, ended_at,
                  current_driver_id, current_driver_name, aggregation_version, complete,
                  invalid_reasons, pit_lap, driver_changed, track_temp_c_mean, track_temp_c_min,
                  track_temp_c_max, air_temp_c_mean, fuel_start_litres, fuel_end_litres,
                  fuel_level_integral_litre_seconds, fuel_added_litres_observed,
                  abs_lat_accel_integral_g_seconds, lat_accel_squared_integral_g2_seconds,
                  max_abs_lat_accel_g, abs_long_accel_integral_g_seconds, valid_duration_seconds,
                  sample_count, max_gap_seconds, pit_visit_ids, wear_observation_ids, coverage,
                  record_revision, content_hash, supersedes_summary_uid)
                select r.id, r.summary_uid, r.summary_id, r.device_id, r.observed_session_id,
                       r.delivered_session_id, r.transport_session_id, r.segment_id, r.lap_number,
                       r.started_at, r.ended_at, r.current_driver_id, r.current_driver_name,
                       r.aggregation_version, r.complete, r.invalid_reasons, r.pit_lap,
                       r.driver_changed, r.track_temp_c_mean, r.track_temp_c_min,
                       r.track_temp_c_max, r.air_temp_c_mean, r.fuel_start_litres,
                       r.fuel_end_litres, r.fuel_level_integral_litre_seconds,
                       r.fuel_added_litres_observed, r.abs_lat_accel_integral_g_seconds,
                       r.lat_accel_squared_integral_g2_seconds, r.max_abs_lat_accel_g,
                       r.abs_long_accel_integral_g_seconds, r.valid_duration_seconds,
                       r.sample_count, r.max_gap_seconds, r.pit_visit_ids,
                       r.wear_observation_ids, r.coverage, r.record_revision, r.content_hash,
                       r.supersedes_summary_uid
                  from jsonb_populate_record(null::public.simhub_lap_summaries,
                                             v_apply.row - '_label' - '_index') r
                 on conflict (device_id, summary_uid) do nothing;
                if found then
                  lp_acc := lp_acc || jsonb_build_object('id', v_apply.row->>'summary_uid',
                                                         'record_revision', (v_apply.row->>'record_revision')::integer);
                else
                  select l.record_revision, l.content_hash into v_prev_rev, v_prev_hash
                    from public.simhub_lap_summaries l
                   where l.device_id = v_device and l.summary_uid = (v_apply.row->>'summary_uid')::uuid;
                  if v_prev_rev = (v_apply.row->>'record_revision')::integer
                     and v_prev_hash = v_apply.row->>'content_hash' then
                    lp_dup := lp_dup || jsonb_build_object('id', v_apply.row->>'summary_uid',
                                                           'record_revision', v_prev_rev);
                  elsif v_prev_rev = (v_apply.row->>'record_revision')::integer then
                    lp_rej := public.simhub_ack_reject(lp_rej, v_apply.row->>'_label',
                                                       (v_apply.row->>'_index')::integer, 'revision_conflict', v_max_rejects);
                  else
                    lp_rej := public.simhub_ack_reject(lp_rej, v_apply.row->>'_label',
                                                       (v_apply.row->>'_index')::integer, 'stale_revision', v_max_rejects);
                  end if;
                end if;
              exception when others then
                lp_rej := public.simhub_ack_reject(lp_rej, v_apply.row->>'_label',
                                                   (v_apply.row->>'_index')::integer,
                                                   'row_failed:' || sqlstate, v_max_rejects);
              end;
            end loop;
            for v_apply in select value as row from jsonb_array_elements(lp_upd)
            loop
              begin
                update public.simhub_lap_summaries l
                   set summary_id = u.summary_id,
                       observed_session_id = u.observed_session_id,
                       delivered_session_id = u.delivered_session_id,
                       transport_session_id = u.transport_session_id,
                       segment_id = u.segment_id,
                       lap_number = u.lap_number,
                       started_at = u.started_at,
                       ended_at = u.ended_at,
                       current_driver_id = u.current_driver_id,
                       current_driver_name = u.current_driver_name,
                       aggregation_version = u.aggregation_version,
                       complete = u.complete,
                       invalid_reasons = u.invalid_reasons,
                       pit_lap = u.pit_lap,
                       driver_changed = u.driver_changed,
                       track_temp_c_mean = u.track_temp_c_mean,
                       track_temp_c_min = u.track_temp_c_min,
                       track_temp_c_max = u.track_temp_c_max,
                       air_temp_c_mean = u.air_temp_c_mean,
                       fuel_start_litres = u.fuel_start_litres,
                       fuel_end_litres = u.fuel_end_litres,
                       fuel_level_integral_litre_seconds = u.fuel_level_integral_litre_seconds,
                       fuel_added_litres_observed = u.fuel_added_litres_observed,
                       abs_lat_accel_integral_g_seconds = u.abs_lat_accel_integral_g_seconds,
                       lat_accel_squared_integral_g2_seconds = u.lat_accel_squared_integral_g2_seconds,
                       max_abs_lat_accel_g = u.max_abs_lat_accel_g,
                       abs_long_accel_integral_g_seconds = u.abs_long_accel_integral_g_seconds,
                       valid_duration_seconds = u.valid_duration_seconds,
                       sample_count = u.sample_count,
                       max_gap_seconds = u.max_gap_seconds,
                       pit_visit_ids = u.pit_visit_ids,
                       wear_observation_ids = u.wear_observation_ids,
                       coverage = u.coverage,
                       record_revision = u.record_revision,
                       supersedes_summary_uid = coalesce(u.supersedes_summary_uid, l.supersedes_summary_uid),
                       content_hash = u.content_hash,
                       received_at = now()
                  from jsonb_populate_record(null::public.simhub_lap_summaries,
                                             v_apply.row - '_label' - '_index') u
                 where l.device_id = u.device_id and l.summary_uid = u.summary_uid;
                lp_sup := lp_sup || jsonb_build_object('id', v_apply.row->>'summary_uid',
                                                       'record_revision', (v_apply.row->>'record_revision')::integer);
              exception when others then
                lp_rej := public.simhub_ack_reject(lp_rej, v_apply.row->>'_label',
                                                   (v_apply.row->>'_index')::integer,
                                                   'row_failed:' || sqlstate, v_max_rejects);
              end;
            end loop;
          end;
        end if;
      end if;
    exception when others then
      lp_block := 'series_failed:' || sqlstate;
      lp_acc := '[]'::jsonb;
      lp_dup := '[]'::jsonb;
      lp_sup := '[]'::jsonb;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device,
    'delivered_session_id', v_delivered,
    'events', jsonb_build_object(
      'received', ev_recv,
      'accepted', ev_acc,
      'duplicates', ev_dup,
      'superseded', ev_sup,
      'rejected', ev_rej,
      'block_error', ev_block),
    'laps', jsonb_build_object(
      'received', lp_recv,
      'accepted', lp_acc,
      'duplicates', lp_dup,
      'superseded', lp_sup,
      'rejected', lp_rej,
      'block_error', lp_block));
end;
$function$;



comment on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) is
  'Interne schrijver voor meetgebeurtenissen en rondeaggregaten. Set-based snelpad voor nieuwe rijen en hogere revisies, met een rij-voor-rij terugval. Elke bevestiging is {id, record_revision}.';

revoke all on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) to service_role;
