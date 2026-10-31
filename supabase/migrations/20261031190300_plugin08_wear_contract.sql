-- ============================================================================
-- Plugin 0.7.2.0 — inhoudelijk contract voor wear en bewijs (wear_v1)
-- Datum: 2026-10-31
-- Vorige migratie: 20261031190200_plugin08_measurement_ack.sql
-- Reviewpunt: 4 (wear-schema)
-- Status: voorstel. Niet toegepast op productie.
--
-- Wear en setgeneratie hadden alleen een vormcontrole: {"fl": "banana"} met
-- confidence 1 en evidence {} kwam erdoor. Zonder inhoudelijk contract is achteraf
-- niet te repareren wat een getal betekende.
--
-- wear_v1 legt de vier hoeken, de schaal (remaining_percent) en het bereik 0..100
-- vast; evidence_v1 eist een bron en kanalen; setGeneration eist vier integers. Een
-- waarneming met wear maar zonder bewijs of confidence wordt geweigerd, niet als
-- zeker opgeslagen.
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- wear_v1, setGeneration en evidence_v1: een inhoudelijk contract
-- ---------------------------------------------------------------------------
-- Wear is een percentage van de band dat NOG OVER IS, 0..100, met verplichte
-- hoeken. De schaal staat expliciet in het object, zodat "12" nooit als
-- "12 procent versleten" gelezen kan worden.
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

-- Setgeneratie per hoek: vier integers, geen halve set, geen vrije vorm.
create or replace function public.simhub_set_generation_valid(p jsonb)
returns boolean
language sql
immutable
as $$
  select case
           when p is null or p = 'null'::jsonb then true
           when jsonb_typeof(p) <> 'object' then false
           when exists (select 1 from jsonb_object_keys(p) k
                         where k not in ('version', 'fl', 'fr', 'rl', 'rr')) then false
           when coalesce(p->>'version', '1') <> '1' then false
           when jsonb_typeof(p->'fl') <> 'number' or jsonb_typeof(p->'fr') <> 'number'
             or jsonb_typeof(p->'rl') <> 'number' or jsonb_typeof(p->'rr') <> 'number' then false
           else coalesce(
             (p->>'fl') ~ '^[0-9]+$' and (p->>'fl')::numeric between 0 and 1000
             and (p->>'fr') ~ '^[0-9]+$' and (p->>'fr')::numeric between 0 and 1000
             and (p->>'rl') ~ '^[0-9]+$' and (p->>'rl')::numeric between 0 and 1000
             and (p->>'rr') ~ '^[0-9]+$' and (p->>'rr')::numeric between 0 and 1000,
             false)
         end
$$;

-- Bewijsgrond: waar komt dit getal vandaan? Zonder bron en kanalen is een
-- confidence-getal niet te controleren.
create or replace function public.simhub_evidence_v1_valid(p jsonb)
returns boolean
language sql
immutable
as $$
  select case
           when p is null or p = 'null'::jsonb then true
           when jsonb_typeof(p) <> 'object' then false
           when exists (select 1 from jsonb_object_keys(p) k
                         where k not in ('version', 'source', 'channels', 'note')) then false
           when coalesce(p->>'version', '1') <> '1' then false
           -- Ontbreken is niet hetzelfde als null: een ontbrekende sleutel
           -- geeft jsonb_typeof(NULL) = NULL en zou anders stil doorvallen.
           when not (p ? 'source') or not (p ? 'channels') then false
           when jsonb_typeof(p->'source') <> 'string'
             or (p->>'source') !~ '^[a-z0-9._:-]{1,64}$' then false
           when jsonb_typeof(p->'channels') <> 'array' then false
           when jsonb_array_length(p->'channels') not between 1 and 8 then false
           when exists (select 1 from jsonb_array_elements(p->'channels') c
                         where jsonb_typeof(c) <> 'string'
                            or (c #>> '{}') !~ '^[a-z0-9._:-]{1,64}$') then false
           when p ? 'note' and (jsonb_typeof(p->'note') <> 'string' or char_length(p->>'note') > 200) then false
           else true
         end
$$;

revoke all on function public.simhub_wear_v1_valid(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_set_generation_valid(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_evidence_v1_valid(jsonb) from public, anon, authenticated;
grant execute on function public.simhub_wear_v1_valid(jsonb) to service_role;
grant execute on function public.simhub_set_generation_valid(jsonb) to service_role;
grant execute on function public.simhub_evidence_v1_valid(jsonb) to service_role;

-- De CHECK is de tweede wachter: ook een rechtstreekse service_role-insert moet
-- aan het contract voldoen.
alter table public.simhub_measurement_events
  add constraint simhub_measurement_events_wear_before_v1
    check (public.simhub_wear_v1_valid(wear_before)),
  add constraint simhub_measurement_events_wear_after_v1
    check (public.simhub_wear_v1_valid(wear_after)),
  add constraint simhub_measurement_events_set_generation_v1
    check (public.simhub_set_generation_valid(set_generation)),
  add constraint simhub_measurement_events_evidence_v1
    check (public.simhub_evidence_v1_valid(evidence)),
  -- Een wear-waarneming zonder bewijsgrond of confidence is geen waarneming.
  add constraint simhub_measurement_events_wear_needs_evidence
    check (wear_before is null and wear_after is null or (evidence is not null and confidence is not null));

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
