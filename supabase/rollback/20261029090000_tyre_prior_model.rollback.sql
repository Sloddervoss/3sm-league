-- Rollback van 20261029090000_tyre_prior_model.sql
--
-- Volgorde: eerst de leesfunctie terug naar de versie van 20261028140000 (die
-- geen tyre_prior() kent), dan de onderhoudskant weg (trigger, functie, tabel),
-- dan de accumulatietrigger terug naar de sleutelregel van 20261027220000.
-- Anders verwijst een functie naar een tabel die al weg is en faalt de eerste
-- frame na de rollback.
--
-- Wat blijft staan:
--   * de kolommen car_key/track_key op de samples en de accumulator;
--   * de sleutels die deze migratie bij de ingest of met de backfill heeft
--     gevuld. Dat zijn gegevens, geen schema, en ze zijn niet te onderscheiden
--     van sleutels die een eerdere versie schreef. Let op: ze staan in de vorm
--     `trackId:config` (bijvoorbeeld '218:'), terwijl de oude trigger weer
--     genormaliseerde trackName schrijft. Beide kunnen naast elkaar bestaan —
--     de oude leesfunctie vergelijkt alleen gelijkheid — maar een gemengde
--     tabel is een reden om de rollback niet lang te laten staan. Wil je
--     helemaal terug, zet de sleutels dan op NULL:
--       update public.simhub_tyre_lap_samples set car_key = null, track_key = null;
--
-- Wat verdwijnt: tyre_prior_stats (de gepoolde cijfers), tyre_prior(),
-- tyre_prior_refresh(), tyre_prior_touch(), tyre_backfill_keys() en de
-- hulpfuncties tyre_car_key()/tyre_track_key(). De leerhistorie is daarmee weg;
-- de stints zelf blijven in tyre_stint_deltas staan.

begin;

-- 1. De schatting terug naar de versie zonder prior.
create or replace function public.pitwall_tyre_estimate_v2(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
    v_user       uuid := auth.uid();
    v_toegestaan boolean;
    v_totaal     bigint := 0;
    v_aantal     bigint := 0;   -- alleen stints met een gemeten helling
    v_grade      text := 'D';
    v_label      text;
    v_provenance text := 'unavailable';
    v_voorlopig  boolean := true;
    v_usable     boolean := false;
    v_rate       numeric;
    v_wear_now   numeric;
    v_wear_car   text;
    v_wear_track text;
    v_remaining  numeric;
    v_laps       numeric;
    v_low        numeric;
    v_high       numeric;
    v_fac_laag   numeric;
    v_fac_hoog   numeric;
    v_schaal     numeric;
    v_span       numeric;
    -- De meetbasis van het getal: de span van de hoek waar de helling vandaan
    -- komt. Die is per definitie niet groter dan de stintspan en kan veel
    -- kleiner zijn (een hoek die maar twee rondes meeliep).
    v_span_hoek  integer;
    v_basis_car   text;
    v_basis_track text;
    v_basis      jsonb;
    v_range      jsonb;
    v_best       public.tyre_stint_deltas%rowtype;
    v_stand      public.tyre_stint_deltas%rowtype;
    v_ctx_car    text;
    v_ctx_track  text;
    v_threshold  constant numeric := 40;
    -- Onder deze basislengte is een helling niet meer dan een indicatie: de
    -- pit- en out-lapruis weegt dan zwaarder dan de slijtage zelf. De maat is
    -- de span van de gebruikte hoek, niet die van de hele stint.
    v_min_basis  constant integer := 8;
begin
    if p_device_id is null then
        raise exception 'device_id is verplicht' using errcode = '22023';
    end if;

    if v_user is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    -- Zelfde apparaatpoort als tyre_rounds_for_device() en tyre_data_coverage():
    -- eigen apparaat, of beheerder. Geen teamcheck: een apparaat hangt niet aan
    -- een event/team, en deze functie wordt niet breder opengesteld dan v1.
    v_toegestaan := exists (
        select 1
          from public.simhub_devices d
         where d.id = p_device_id
           and (d.owner_user_id = v_user or public.can_manage_simhub())
    );
    if not v_toegestaan then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    -- De graad rust op stints met een gemeten helling; het totaal blijft
    -- beschikbaar zodat zichtbaar is hoeveel blokken er wél zijn.
    select count(*) filter (where v.heeft_helling), count(*)
      into v_aantal, v_totaal
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id;

    if coalesce(v_totaal, 0) = 0 then
        return jsonb_build_object(
            'grade', 'D',
            'grade_label', 'geen stints',
            'usable', false,
            'voorlopig', true,
            'stints', 0,
            'stints_totaal', 0,
            'wear_per_lap', null,
            'zwakste_hoek', null,
            'range_laps', null,
            'wear_now', null,
            'wear_now_car_key', null,
            'wear_now_track_key', null,
            'threshold_pct', v_threshold,
            'basis', null,
            'provenance', 'unavailable'
        );
    end if;

    v_grade := case when v_aantal >= 3 then 'A'
                    when v_aantal = 2 then 'B'
                    when v_aantal = 1 then 'C'
                    else 'D' end;

    -- Huidige context: de laatst bekende auto en baan van dit apparaat. Null is
    -- "niet bekend", geen mismatch. Alleen de nieuwste honderd rijen: de
    -- pitwall pollt dit en hoeft geen hele historie te sorteren.
    select (array_agg(c.car_key order by c.captured_at desc, c.lap_number desc)
              filter (where c.car_key is not null))[1],
           (array_agg(c.track_key order by c.captured_at desc, c.lap_number desc)
              filter (where c.track_key is not null))[1]
      into v_ctx_car, v_ctx_track
      from (
        select s.car_key, s.track_key, s.captured_at, s.lap_number
          from public.simhub_tyre_lap_samples s
         where s.device_id = p_device_id
         order by s.captured_at desc, s.lap_number desc
         limit 100
      ) c;

    -- Beste stint: de meest recente met een gemeten helling over minstens drie
    -- rondes; bij gelijke tijd de langste. "Best beschikbaar" is dus niet "de
    -- mooiste", maar de meest recente meting waar een helling uit volgt.
    select * into v_best
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id
       and v.heeft_helling
       and v.wear_span is not null
       and v.wear_span >= 3
     order by v.laatste_meting desc, v.wear_span desc
     limit 1;

    if found then
        -- De helling van de steilste hoek: hetzelfde getal als zwakste_hoek
        -- aanwijst. Zo kunnen tabel en getal niet uit elkaar lopen.
        v_rate := case v_best.zwakste_hoek
                    when 'fl' then -v_best.wear_per_lap_fl
                    when 'fr' then -v_best.wear_per_lap_fr
                    when 'rl' then -v_best.wear_per_lap_rl
                    when 'rr' then -v_best.wear_per_lap_rr
                  end;
        -- De noemer van dát getal, niet die van de stint. Een hoek die maar
        -- twee rondes meeliep levert een helling over één ronde; die mag de
        -- schatting niet als "basis van negen rondes" presenteren.
        v_span_hoek := case v_best.zwakste_hoek
                         when 'fl' then v_best.wear_span_fl
                         when 'fr' then v_best.wear_span_fr
                         when 'rl' then v_best.wear_span_rl
                         when 'rr' then v_best.wear_span_rr
                       end;
        v_basis_car   := v_best.car_key;
        v_basis_track := v_best.track_key;
        v_basis := jsonb_build_object(
            'car_key', v_best.car_key,
            'track_key', v_best.track_key,
            'track_temp_c', v_best.track_temp_c,
            'rondes_in_basis', coalesce(v_span_hoek, 0),
            'rondes_in_stint', v_best.wear_span,
            'set_number', v_best.set_number,
            'set_bron', v_best.set_bron,
            'lap_from', v_best.lap_from,
            'lap_to', v_best.lap_to,
            'zwakste_hoek', v_best.zwakste_hoek
        );
        v_provenance := case when v_best.set_bron = 'payload'
                             then 'measured' else 'estimated' end;
    else
        -- Geen helling. Welke stand is er dan? De laatste stint met een
        -- wear-meting, zonder er een tempo aan te hangen.
        select * into v_stand
          from public.tyre_stint_deltas v
         where v.device_id = p_device_id
           and v.wear_metingen > 0
         order by v.laatste_meting desc
         limit 1;
        if found then
            v_basis_car   := v_stand.car_key;
            v_basis_track := v_stand.track_key;
            v_provenance := 'last_known';
            v_basis := jsonb_build_object(
                'car_key', v_stand.car_key,
                'track_key', v_stand.track_key,
                'track_temp_c', v_stand.track_temp_c,
                'rondes_in_basis', coalesce(v_stand.wear_span, 0),
                'rondes_in_stint', v_stand.wear_span,
                'set_number', v_stand.set_number,
                'set_bron', v_stand.set_bron,
                'lap_from', v_stand.lap_from,
                'lap_to', v_stand.lap_to,
                'zwakste_hoek', v_stand.zwakste_hoek
            );
        end if;
    end if;

    -- Huidige wear-stand: de zwakste hoek van de laatste meting. NaN is geen
    -- meting (nullif), en een rij die bij de basis past krijgt voorrang boven
    -- een rij van een andere auto of baan. Dat geldt nu ook in het
    -- last_known-pad: de voorkeur hing aan v_best en deed daar dus niets.
    select w.wear_min, w.car_key, w.track_key
      into v_wear_now, v_wear_car, v_wear_track
      from (
        select least(nullif(s.wear_fl, 'NaN'::numeric),
                     nullif(s.wear_fr, 'NaN'::numeric),
                     nullif(s.wear_rl, 'NaN'::numeric),
                     nullif(s.wear_rr, 'NaN'::numeric)) as wear_min,
               s.car_key,
               s.track_key,
               s.captured_at,
               s.lap_number
          from public.simhub_tyre_lap_samples s
         where s.device_id = p_device_id
      ) w
     where w.wear_min is not null
     order by case
                when v_basis_car is not null
                 and w.car_key = v_basis_car
                 and (v_basis_track is null
                      or w.track_key is null
                      or w.track_key = v_basis_track) then 0
                else 1
              end,
              w.captured_at desc,
              w.lap_number desc
     limit 1;

    -- Een helling of stand van een andere auto of baan dan de basis is een
    -- schatting, geen meting voor deze combinatie. De controle geldt voor beide
    -- paden: in het last_known-pad bleef de herkomst anders staan terwijl de
    -- wear-stand uit een andere auto kwam.
    if v_provenance in ('measured', 'last_known') and v_basis_car is not null then
        if (v_ctx_car is not null and v_basis_car is not null
            and v_ctx_car <> v_basis_car)
           or (v_ctx_track is not null and v_basis_track is not null
               and v_ctx_track <> v_basis_track)
           or (v_wear_car is not null and v_basis_car is not null
               and v_wear_car <> v_basis_car)
           or (v_wear_track is not null and v_basis_track is not null
               and v_wear_track <> v_basis_track) then
            v_provenance := 'estimated';
        end if;
    end if;

    if v_rate is not null and v_rate > 0 and v_wear_now is not null then
        v_remaining := v_wear_now - v_threshold;
        if v_remaining > 0 then
            v_laps := v_remaining / v_rate;
            -- Basislengte stuurt de breedte: 8 rondes van de gebruikte hoek is
            -- de nominale marge, korter wordt breder (tot 4x), langer smaller
            -- (tot 0,5x). De stintspan zegt hier niets: een hoek van één ronde
            -- tussen negen gemeten rondes is nog steeds een basis van één.
            v_span := greatest(coalesce(v_span_hoek, 0), 1)::numeric;
            v_schaal := least(greatest(v_min_basis::numeric / v_span, 0.5), 4.0);
            case v_grade
                when 'A' then v_fac_laag := 1.10; v_fac_hoog := 0.90;
                when 'B' then v_fac_laag := 1.30; v_fac_hoog := 0.75;
                else          v_fac_laag := 2.00; v_fac_hoog := 0.50;
            end case;
            v_fac_laag := 1 + (v_fac_laag - 1) * v_schaal;
            v_fac_hoog := greatest(1 - (1 - v_fac_hoog) * v_schaal, 0.20);
            v_low  := greatest(floor(v_laps / v_fac_laag), 0);
            v_high := ceil(v_laps / v_fac_hoog);
            -- Guard vóór de casts: NaN of NULL mag nooit op ::integer klappen.
            if v_laps is null or v_laps = 'NaN'::numeric
               or v_low is null or v_low = 'NaN'::numeric
               or v_high is null or v_high = 'NaN'::numeric then
                v_range := null;
            else
                v_range := jsonb_build_object('low', v_low::integer, 'high', v_high::integer);
            end if;
        else
            -- Wear staat al op of onder de drempel: geen bereik verzinnen.
            v_range := jsonb_build_object('low', 0, 'high', 0);
        end if;
    end if;

    v_label := case v_grade
        when 'A' then 'drie of meer onafhankelijke stints'
        when 'B' then 'twee onafhankelijke stints'
        when 'C' then 'één stint, ruime marge'
        else 'geen stint met een gemeten helling'
    end;

    -- Bruikbaar = er is een getal, de graad is A of B, er is nog wear over en de
    -- meetbasis van de gebruikte hoek is lang genoeg (acht rondes) om de
    -- helling boven de ruis uit te tillen. Voorlopig = dat getal is nog niet
    -- bevestigd.
    v_usable := v_rate is not null
                and v_grade in ('A', 'B')
                and coalesce(v_remaining, 0) > 0
                and coalesce(v_span_hoek, 0) >= v_min_basis
                and v_range is not null;
    v_voorlopig := (not v_usable)
                   or v_provenance <> 'measured'
                   or coalesce(v_span_hoek, 0) < v_min_basis;

    return jsonb_build_object(
        'grade', v_grade,
        'grade_label', v_label,
        'usable', v_usable,
        'voorlopig', v_voorlopig,
        'stints', v_aantal,
        'stints_totaal', v_totaal,
        'wear_per_lap', case when v_rate is not null then round(v_rate, 4) end,
        'zwakste_hoek', case when v_rate is not null then v_best.zwakste_hoek end,
        'range_laps', v_range,
        'wear_now', v_wear_now,
        'wear_now_car_key', v_wear_car,
        'wear_now_track_key', v_wear_track,
        'threshold_pct', v_threshold,
        'basis', v_basis,
        'provenance', v_provenance
    );
end;
$function$;

comment on function public.pitwall_tyre_estimate_v2(uuid) is
  'Stintschatting per apparaat: graad op stints met een gemeten helling, wear_per_lap van de steilste hoek (procentpunt per ronde, positief = slijt), range_laps met een marge die meeschaalt met graad en de meetbasis van die hoek (basis.rondes_in_basis) plus de stintspan (basis.rondes_in_stint), herkomst en een expliciete voorlopig-vlag. usable pas bij een basis van acht rondes van de gebruikte hoek; wijkt auto of baan van basis, context of wear-stand af, dan is de herkomst estimated.';

revoke all on function public.pitwall_tyre_estimate_v2(uuid) from public, anon;
grant execute on function public.pitwall_tyre_estimate_v2(uuid) to authenticated;

-- 2. De accumulatietrigger terug naar de sleutelregel van 20261027220000:
--    carId/carName en trackName, zonder trackId of config.
create or replace function public.simhub_tyre_lap_accumulate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle jsonb;
  v_tyres jsonb;
  v_lap integer;
  v_sessie text;
  v_car_key text;
  v_track_key text;
  v_rij public.simhub_tyre_lap_accum;
begin
  -- Zonder voertuigblok valt er niets te middelen; slijtage alleen is te weinig.
  v_vehicle := new.v3_normalized->'vehicle';
  if v_vehicle is null or jsonb_typeof(v_vehicle) <> 'object' then
    return new;
  end if;

  if new.device_id is null then
    return new;
  end if;

  v_lap := nullif(new.v3_normalized->'timing'->>'completedLaps', '')::integer;
  if v_lap is null or v_lap < 1 then
    return new;
  end if;

  v_sessie := coalesce(nullif(new.session_id, ''), 'onbekend');

  -- Frames met completedLaps = k horen bij ronde k+1.
  v_lap := v_lap + 1;

  -- Auto en baan: eerst de afgeleide kolommen (die de persist-route al vult),
  -- dan de ruwe payload als fallback. Leeg of ontbrekend blijft NULL.
  --
  -- De normalisatie staat hier inline en roept endurance_normalise_key() niet aan:
  -- dit is een trigger op de ingest, en die mag niet stukgaan op een functie die
  -- in een andere migratie is gemaakt. De regel is identiek (kleine letters, alleen
  -- a-z en 0-9), zodat de sleutels uit beide routes hetzelfde zijn.
  v_car_key := nullif(regexp_replace(lower(coalesce(
    nullif(btrim(coalesce(new.car_id, '')), ''),
    nullif(btrim(coalesce(new.car_name, '')), ''),
    nullif(btrim(coalesce(new.v3_normalized#>>'{identity,carId}', '')), ''),
    nullif(btrim(coalesce(new.v3_normalized#>>'{identity,carName}', '')), '')
  )), '[^a-z0-9]', '', 'g'), '');
  v_track_key := nullif(regexp_replace(lower(coalesce(
    nullif(btrim(coalesce(new.track_name, '')), ''),
    nullif(btrim(coalesce(new.v3_normalized#>>'{identity,trackName}', '')), '')
  )), '[^a-z0-9]', '', 'g'), '');

  select * into v_rij from public.simhub_tyre_lap_accum where device_id = new.device_id;

  if found and (v_rij.session_key <> v_sessie or v_rij.lap_number <> v_lap) then
    -- De rondetijd van de zojuist afgeronde ronde zit in dit frame, niet in het
    -- laatste frame van die ronde (dat nog de tijd van de vorige ronde droeg).
    v_rij.env := jsonb_set(coalesce(v_rij.env, '{}'::jsonb), '{lapSeconds}',
                 to_jsonb(new.v3_normalized->'timing'->>'lastLapTimeSeconds'));
    perform public.simhub_tyre_lap_flush_row(v_rij);
    delete from public.simhub_tyre_lap_accum where device_id = new.device_id;
    v_rij := null;
  end if;

  v_tyres := new.v3_normalized->'tyres';

  insert into public.simhub_tyre_lap_accum as a (
    device_id, connector_id, session_key, lap_number, n,
    n_fl, sum_fl, max_fl, n_fr, sum_fr, max_fr,
    n_rl, sum_rl, max_rl, n_rr, sum_rr, max_rr,
    wear, env, driver, car_key, track_key, last_frame_at)
  values (
    new.device_id, new.connector_id, v_sessie, v_lap, 1,
    case when (v_vehicle->'frontLeft'->>'temperature') is not null then 1 else 0 end,
    coalesce((v_vehicle->'frontLeft'->>'temperature')::numeric, 0),
    coalesce((v_vehicle->'frontLeft'->>'temperature')::numeric, 0),
    case when (v_vehicle->'frontRight'->>'temperature') is not null then 1 else 0 end,
    coalesce((v_vehicle->'frontRight'->>'temperature')::numeric, 0),
    coalesce((v_vehicle->'frontRight'->>'temperature')::numeric, 0),
    case when (v_vehicle->'rearLeft'->>'temperature') is not null then 1 else 0 end,
    coalesce((v_vehicle->'rearLeft'->>'temperature')::numeric, 0),
    coalesce((v_vehicle->'rearLeft'->>'temperature')::numeric, 0),
    case when (v_vehicle->'rearRight'->>'temperature') is not null then 1 else 0 end,
    coalesce((v_vehicle->'rearRight'->>'temperature')::numeric, 0),
    coalesce((v_vehicle->'rearRight'->>'temperature')::numeric, 0),
    jsonb_build_object(
      'fl', least((v_tyres->'wearPercent'->'fl'->>'l')::numeric,
                  (v_tyres->'wearPercent'->'fl'->>'m')::numeric,
                  (v_tyres->'wearPercent'->'fl'->>'r')::numeric,
                  (v_vehicle->'frontLeft'->>'wearPercent')::numeric),
      'fr', least((v_tyres->'wearPercent'->'fr'->>'l')::numeric,
                  (v_tyres->'wearPercent'->'fr'->>'m')::numeric,
                  (v_tyres->'wearPercent'->'fr'->>'r')::numeric,
                  (v_vehicle->'frontRight'->>'wearPercent')::numeric),
      'rl', least((v_tyres->'wearPercent'->'rl'->>'l')::numeric,
                  (v_tyres->'wearPercent'->'rl'->>'m')::numeric,
                  (v_tyres->'wearPercent'->'rl'->>'r')::numeric,
                  (v_vehicle->'rearLeft'->>'wearPercent')::numeric),
      'rr', least((v_tyres->'wearPercent'->'rr'->>'l')::numeric,
                  (v_tyres->'wearPercent'->'rr'->>'m')::numeric,
                  (v_tyres->'wearPercent'->'rr'->>'r')::numeric,
                  (v_vehicle->'rearRight'->>'wearPercent')::numeric)),
    jsonb_build_object(
      'trackTempC', v_tyres->'environment'->>'trackTempC',
      'airTempC', v_tyres->'environment'->>'airTempC',
      'rubberState', v_tyres->'environment'->>'rubberState',
      'compoundId', v_tyres->>'compoundId',
      'tyreSet', v_tyres->'sets'->>'used',
      'lapSeconds', new.v3_normalized->'timing'->>'lastLapTimeSeconds'),
    new.current_driver_name, v_car_key, v_track_key, new.captured_at)
  on conflict (device_id) do update set
    session_key = excluded.session_key,
    lap_number  = excluded.lap_number,
    connector_id = excluded.connector_id,
    n = a.n + 1,
    n_fl = a.n_fl + excluded.n_fl,
    sum_fl = a.sum_fl + excluded.sum_fl, max_fl = greatest(a.max_fl, excluded.max_fl),
    n_fr = a.n_fr + excluded.n_fr,
    sum_fr = a.sum_fr + excluded.sum_fr, max_fr = greatest(a.max_fr, excluded.max_fr),
    n_rl = a.n_rl + excluded.n_rl,
    sum_rl = a.sum_rl + excluded.sum_rl, max_rl = greatest(a.max_rl, excluded.max_rl),
    n_rr = a.n_rr + excluded.n_rr,
    sum_rr = a.sum_rr + excluded.sum_rr, max_rr = greatest(a.max_rr, excluded.max_rr),
    wear = coalesce(excluded.wear, a.wear),
    env  = coalesce(excluded.env, a.env),
    driver = coalesce(excluded.driver, a.driver),
    -- Een frame zonder identiteit mag de sleutel van deze ronde niet wissen.
    car_key = coalesce(excluded.car_key, a.car_key),
    track_key = coalesce(excluded.track_key, a.track_key),
    last_frame_at = greatest(a.last_frame_at, excluded.last_frame_at);

  return new;
exception
  when others then
    return new;  -- nooit de ingest blokkeren om een meting
end;
$$;

-- 3. De onderhoudskant weg.
drop trigger if exists simhub_tyre_lap_samples_prior_trg on public.simhub_tyre_lap_samples;
drop function if exists public.tyre_prior_touch();
drop function if exists public.tyre_prior_refresh(text, text);
drop function if exists public.tyre_prior(text, text);
drop table if exists public.tyre_prior_stats;
drop function if exists public.tyre_backfill_keys();
drop function if exists public.tyre_car_key(text, text);
drop function if exists public.tyre_track_key(text, text, text);

commit;
