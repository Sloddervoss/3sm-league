-- ============================================================================
-- Endurance — stintdelta's, dekkingsoverzicht en een eerlijke schatting (v2)
-- Datum: 2026-10-28
--
-- simhub_tyre_lap_samples bewaart per ronde een wear-momentopname, maar geen
-- stint: er is geen rij die zegt "deze bandenset liep van ronde 12 tot 38".
-- Zonder die eenheid kun je geen slijtage per ronde uitrekenen (je weet niet
-- welke twee metingen bij dezelfde set horen) en dus ook geen bandbreedte
-- geven. Deze migratie voegt drie lagen toe, van ruw naar presentabel:
--
--   1. view public.tyre_stint_deltas — per apparaat, sessie en opeenvolgende
--      bandenset: rondes, wear begin/eind per hoek, wear_per_lap per hoek,
--      zwakste hoek, gemiddelde baantemperatuur, auto en baan;
--   2. RPC public.tyre_coverage(p_limit) — dekkingsoverzicht per auto en baan:
--      hoeveel stints, hoeveel daarvan hebben een bruikbare wear-meting, en een
--      graad A/B/C/D;
--   3. RPC public.pitwall_tyre_estimate_v2(p_device_id) — de schatting voor de
--      pitwall, met herkomst, bandbreedte en een expliciete `voorlopig`-vlag.
--
-- Waarom de set-grens zo bepaald wordt
-- ------------------------------------
-- `tyre_set` komt uit het tyres-blok (`sets.used`), en dat is de iRacing-teller
-- TireSetsUsed: die loopt alleen op als er echt een nieuwe set onder de auto
-- gaat. Daarom is de teller leidend. Ontbreekt hij (oudere rijen, of frames
-- zonder sets-blok), dan is er één observeerbaar bewijs: wear kan binnen
-- dezelfde set niet omhoog, want wearPercent ververst alleen in de pitstraat.
-- Een sprong omhoog van meer dan 0,5 pp is dus een setwissel. Die drempel is
-- bewust ruim: kleine fluctuaties in een verversing mogen geen nieuwe stint
-- verzinnen. Staat de teller wél in de rij, dan wordt er niet op wear
-- gesplitst — anders maakt ruizige testtelemetrie (wear die op en neer springt
-- terwijl TireSetsUsed op 1 blijft) drie stints waar er één is, en dat is
-- precies de verzonnen precisie die deze migratie moet voorkomen.
--
-- Waarom wear_per_lap NULL mag zijn
-- ----------------------------------
-- Een helling bestaat alleen als beide metingen er zijn, de tweede lager is
-- (wear kan niet stijgen binnen één set) en er minstens één ronde tussen zit.
-- Anders is er geen getal, geen 0 en geen schatting: NULL. De view zegt dus
-- eerder "dit weet ik niet" dan "dit slijt niet".
--
-- Rechten
-- -------
-- De view heeft geen RLS-policies op de brontabel en wordt daarom niet aan
-- authenticated gegrond: alleen de SECURITY DEFINER-RPC's erboven lezen hem.
-- tyre_coverage en pitwall_tyre_estimate_v2 geven nooit execute aan anon.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Index: de stintvraag is "deze sessie, op volgorde van ronde"
-- ---------------------------------------------------------------------------
create index if not exists simhub_tyre_lap_samples_session_lap_idx
  on public.simhub_tyre_lap_samples (device_id, session_key, lap_number);

-- ---------------------------------------------------------------------------
-- 2. De stintview
-- ---------------------------------------------------------------------------
create or replace view public.tyre_stint_deltas as
with basis as (
  select s.device_id,
         s.session_key,
         s.lap_number,
         s.captured_at,
         s.tyre_set,
         s.wear_fl, s.wear_fr, s.wear_rl, s.wear_rr,
         s.track_temp_c,
         s.car_key,
         s.track_key,
         greatest(s.wear_fl, s.wear_fr, s.wear_rl, s.wear_rr) as wear_max,
         lag(s.tyre_set) over w as vorige_set,
         lag(greatest(s.wear_fl, s.wear_fr, s.wear_rl, s.wear_rr)) over w as vorige_wear_max
    from public.simhub_tyre_lap_samples s
  window w as (partition by s.device_id, s.session_key order by s.lap_number)
),
grens as (
  select b.*,
         case
           -- De teller is leidend: iRacing verhoogt TireSetsUsed alleen bij een
           -- echte nieuwe set.
           when b.tyre_set is not null
                and b.vorige_set is not null
                and b.tyre_set <> b.vorige_set then true
           -- Zonder teller (beide randen NULL): wear die omhoog springt kan
           -- alleen van een nieuwe set komen. 0,5 pp marge tegen ruis.
           when b.tyre_set is null
                and b.vorige_set is null
                and b.wear_max is not null
                and b.vorige_wear_max is not null
                and b.wear_max > b.vorige_wear_max + 0.5 then true
           else false
         end as nieuwe_set
    from basis b
),
genummerd as (
  select g.*,
         1 + sum(case when g.nieuwe_set then 1 else 0 end) over (
               partition by g.device_id, g.session_key order by g.lap_number
             ) as set_volgnr
    from grens g
),
blok as (
  select b.device_id,
         b.session_key,
         b.set_volgnr,
         min(b.lap_number)                                    as lap_from,
         max(b.lap_number)                                    as lap_to,
         count(*)::integer                                    as rondes,
         max(b.tyre_set)                                      as set_payload,
         count(b.tyre_set)::integer                           as set_metingen,
         min(b.lap_number) filter (where b.wear_max is not null) as wear_van_lap,
         max(b.lap_number) filter (where b.wear_max is not null) as wear_tot_lap,
         count(b.wear_max)::integer                           as wear_metingen,
         (array_agg(b.wear_fl order by b.lap_number)
            filter (where b.wear_fl is not null))[1]         as wear_begin_fl,
         (array_agg(b.wear_fr order by b.lap_number)
            filter (where b.wear_fr is not null))[1]         as wear_begin_fr,
         (array_agg(b.wear_rl order by b.lap_number)
            filter (where b.wear_rl is not null))[1]         as wear_begin_rl,
         (array_agg(b.wear_rr order by b.lap_number)
            filter (where b.wear_rr is not null))[1]         as wear_begin_rr,
         (array_agg(b.wear_fl order by b.lap_number desc)
            filter (where b.wear_fl is not null))[1]         as wear_end_fl,
         (array_agg(b.wear_fr order by b.lap_number desc)
            filter (where b.wear_fr is not null))[1]         as wear_end_fr,
         (array_agg(b.wear_rl order by b.lap_number desc)
            filter (where b.wear_rl is not null))[1]         as wear_end_rl,
         (array_agg(b.wear_rr order by b.lap_number desc)
            filter (where b.wear_rr is not null))[1]         as wear_end_rr,
         round(avg(b.track_temp_c), 2)                        as track_temp_c,
         (array_agg(b.car_key order by b.lap_number desc)
            filter (where b.car_key is not null))[1]         as car_key,
         (array_agg(b.track_key order by b.lap_number desc)
            filter (where b.track_key is not null))[1]       as track_key,
         max(b.captured_at)                                   as laatste_meting
    from genummerd b
   group by b.device_id, b.session_key, b.set_volgnr
),
met_span as (
  select b.*,
         -- Rondes tussen de eerste en de laatste wear-meting: de noemer van de
         -- helling. Null als er minder dan twee metingen zijn.
         case when b.wear_van_lap is not null and b.wear_tot_lap is not null
              then b.wear_tot_lap - b.wear_van_lap end as wear_span
    from blok b
)
select m.device_id,
       m.session_key,
       coalesce(m.set_payload, m.set_volgnr)      as set_number,
       case when m.set_metingen = 0 then 'afgeleid' else 'payload' end as set_bron,
       m.lap_from,
       m.lap_to,
       m.rondes,
       m.wear_span,
       m.wear_metingen,
       m.wear_begin_fl, m.wear_begin_fr, m.wear_begin_rl, m.wear_begin_rr,
       m.wear_end_fl, m.wear_end_fr, m.wear_end_rl, m.wear_end_rr,
       -- Helling per hoek: alleen met twee metingen, minimaal één ronde
       -- ertussen en niet stijgend. Anders NULL — geen 0, geen interpolatie.
       case when m.wear_begin_fl is not null and m.wear_end_fl is not null
                 and m.wear_span >= 1 and m.wear_end_fl <= m.wear_begin_fl
            then round((m.wear_end_fl - m.wear_begin_fl) / m.wear_span, 4) end as wear_per_lap_fl,
       case when m.wear_begin_fr is not null and m.wear_end_fr is not null
                 and m.wear_span >= 1 and m.wear_end_fr <= m.wear_begin_fr
            then round((m.wear_end_fr - m.wear_begin_fr) / m.wear_span, 4) end as wear_per_lap_fr,
       case when m.wear_begin_rl is not null and m.wear_end_rl is not null
                 and m.wear_span >= 1 and m.wear_end_rl <= m.wear_begin_rl
            then round((m.wear_end_rl - m.wear_begin_rl) / m.wear_span, 4) end as wear_per_lap_rl,
       case when m.wear_begin_rr is not null and m.wear_end_rr is not null
                 and m.wear_span >= 1 and m.wear_end_rr <= m.wear_begin_rr
            then round((m.wear_end_rr - m.wear_begin_rr) / m.wear_span, 4) end as wear_per_lap_rr,
       -- Zwakste hoek = laagste resterende wear aan het eind van de stint.
       case least(m.wear_end_fl, m.wear_end_fr, m.wear_end_rl, m.wear_end_rr)
         when m.wear_end_fl then 'fl'
         when m.wear_end_fr then 'fr'
         when m.wear_end_rl then 'rl'
         when m.wear_end_rr then 'rr'
       end                                        as zwakste_hoek,
       m.track_temp_c,
       m.car_key,
       m.track_key,
       m.laatste_meting
  from met_span m;

comment on view public.tyre_stint_deltas is
  'Per apparaat, sessie en opeenvolgende bandenset: rondes, wear begin/eind per hoek, wear_per_lap per hoek (NULL zonder twee metingen), zwakste hoek, gemiddelde baantemperatuur, auto en baan. Niet gegrond aan authenticated; lees via tyre_coverage() of pitwall_tyre_estimate_v2().';
comment on column public.tyre_stint_deltas.set_bron is
  'payload = set_number uit de iRacing-teller TireSetsUsed (tyres.sets.used); afgeleid = bepaald uit een wear-sprong omhoog, omdat de teller in deze rijen ontbrak.';
comment on column public.tyre_stint_deltas.wear_per_lap_fl is
  'Procentpunt wear per ronde, negatief = slijt. NULL als een van beide metingen ontbreekt, de stint korter is dan één ronde of de wear steeg.';

revoke all on public.tyre_stint_deltas from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Dekkingsoverzicht per auto en baan
-- ---------------------------------------------------------------------------
create or replace function public.tyre_coverage(p_limit integer default 50)
returns table (
  car_key text,
  track_key text,
  stints bigint,
  wear_labels bigint,
  grade text,
  laatste_meting timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  -- Zelfde poort als tyre_data_coverage(): alleen eigen of beheerde
  -- apparaten. Zo lekt een dekkingsoverzicht geen banden van een ander team,
  -- en ziet een beheerder (can_manage_simhub) wel alles.
  select v.car_key,
         v.track_key,
         count(*)::bigint as stints,
         count(*) filter (
           where v.wear_begin_fl is not null and v.wear_end_fl is not null
         )::bigint as wear_labels,
         case when count(*) >= 3 then 'A'
              when count(*) = 2 then 'B'
              when count(*) = 1 then 'C'
              else 'D' end as grade,
         max(v.laatste_meting) as laatste_meting
    from public.tyre_stint_deltas v
   where exists (
           select 1
             from public.simhub_devices d
            where d.id = v.device_id
              and (d.owner_user_id = auth.uid() or public.can_manage_simhub())
         )
   group by v.car_key, v.track_key
   order by max(v.laatste_meting) desc nulls last
   limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

comment on function public.tyre_coverage(integer) is
  'Dekking per auto en baan: aantal stints, aantal met een bruikbare wear-meting en graad A (3+ stints), B (2), C (1), D (0). Alleen eigen of beheerde apparaten.';

revoke all on function public.tyre_coverage(integer) from public, anon;
grant execute on function public.tyre_coverage(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. De schatting voor de pitwall (v2)
-- ---------------------------------------------------------------------------
-- Graad  : A = 3+ onafhankelijke stints, B = 2, C = 1, D = 0.
-- Getal  : alleen als de beste stint twee wear-metingen heeft over minstens
--          drie rondes; wear_per_lap is dan de helling van de zwakste hoek in
--          procentpunt per ronde (positief = slijt).
-- Bereik : resterende wear tot 40 % gedeeld door die helling, met een marge die
--          meegroeit met de onzekerheid: A ±10 %, B ±25 %, C de helft tot het
--          dubbele. Zonder helling of zonder wear-stand: geen bereik.
-- Herkomst: measured (eigen gemeten helling met teller als setgrens),
--          estimated (helling wel gemeten, maar setgrens afgeleid of context
--          wijkt af), last_known (alleen een wear-stand, geen helling),
--          unavailable (geen enkele stint).
-- usable : het getal mag als getal in de pitwall. voorlopig: het is nog niet
--          over genoeg onafhankelijke stops bevestigd, of de basis is korter
--          dan acht rondes. Die twee zijn bewust apart: een A met een gemeten
--          setgrens maar een korte basis is bruikbaar maar voorlopig.
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
    v_aantal     bigint := 0;
    v_grade      text := 'D';
    v_label      text;
    v_provenance text := 'unavailable';
    v_voorlopig  boolean := true;
    v_usable     boolean := false;
    v_rate       numeric;
    v_wear_now   numeric;
    v_remaining  numeric;
    v_laps       numeric;
    v_low        numeric;
    v_high       numeric;
    v_fac_laag   numeric;
    v_fac_hoog   numeric;
    v_basis      jsonb;
    v_range      jsonb;
    v_best       public.tyre_stint_deltas%rowtype;
    v_stand      public.tyre_stint_deltas%rowtype;
    v_ctx_car    text;
    v_ctx_track  text;
    v_threshold  constant numeric := 40;
    -- Onder deze basislengte is een helling niet meer dan een indicatie: de
    -- pit- en out-lapruis weegt dan zwaarder dan de slijtage zelf.
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

    select count(*) into v_aantal
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id;

    if coalesce(v_aantal, 0) = 0 then
        return jsonb_build_object(
            'grade', 'D',
            'grade_label', 'geen stints',
            'usable', false,
            'voorlopig', true,
            'stints', 0,
            'wear_per_lap', null,
            'zwakste_hoek', null,
            'range_laps', null,
            'wear_now', null,
            'threshold_pct', v_threshold,
            'basis', null,
            'provenance', 'unavailable'
        );
    end if;

    v_grade := case when v_aantal >= 3 then 'A'
                    when v_aantal = 2 then 'B'
                    else 'C' end;

    -- Huidige context: de laatst bekende auto en baan van dit apparaat. Null is
    -- "niet bekend", geen mismatch. Alleen de nieuwste honderd rijen: de
    -- pitwall pollt dit en hoeft geen hele historie te sorteren.
    select (array_agg(c.car_key order by c.captured_at desc)
              filter (where c.car_key is not null))[1],
           (array_agg(c.track_key order by c.captured_at desc)
              filter (where c.track_key is not null))[1]
      into v_ctx_car, v_ctx_track
      from (
        select s.car_key, s.track_key, s.captured_at
          from public.simhub_tyre_lap_samples s
         where s.device_id = p_device_id
         order by s.captured_at desc
         limit 100
      ) c;

    -- Huidige wear-stand: de zwakste hoek van de laatste meting.
    select least(s.wear_fl, s.wear_fr, s.wear_rl, s.wear_rr)
      into v_wear_now
      from public.simhub_tyre_lap_samples s
     where s.device_id = p_device_id
       and s.wear_fl is not null
     order by s.captured_at desc, s.lap_number desc
     limit 1;

    -- Beste stint: de meest recente met een bruikbare helling (minstens drie
    -- rondes tussen de metingen); bij gelijke tijd de langste. "Best
    -- beschikbaar" is dus niet "de mooiste", maar de meest recente meting waar
    -- een helling uit volgt.
    select * into v_best
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id
       and v.wear_span is not null
       and v.wear_span >= 3
       and least(v.wear_per_lap_fl, v.wear_per_lap_fr,
                 v.wear_per_lap_rl, v.wear_per_lap_rr) is not null
     order by v.laatste_meting desc, v.wear_span desc
     limit 1;

    if found then
        v_rate := -least(v_best.wear_per_lap_fl, v_best.wear_per_lap_fr,
                         v_best.wear_per_lap_rl, v_best.wear_per_lap_rr);
        v_basis := jsonb_build_object(
            'car_key', v_best.car_key,
            'track_key', v_best.track_key,
            'track_temp_c', v_best.track_temp_c,
            'rondes_in_basis', v_best.wear_span,
            'set_number', v_best.set_number,
            'set_bron', v_best.set_bron,
            'lap_from', v_best.lap_from,
            'lap_to', v_best.lap_to
        );
        v_provenance := case when v_best.set_bron = 'payload'
                             then 'measured' else 'estimated' end;

        -- Een helling van een andere auto of baan is een schatting, geen
        -- meting voor deze combinatie.
        if v_provenance = 'measured'
           and ((v_ctx_car is not null and v_best.car_key is not null
                 and v_ctx_car <> v_best.car_key)
             or (v_ctx_track is not null and v_best.track_key is not null
                 and v_ctx_track <> v_best.track_key)) then
            v_provenance := 'estimated';
        end if;
    else
        -- Geen helling. Welke stand is er dan? De laatste stint met een
        -- wear-meting, zonder er een tempo aan te hangen.
        select * into v_stand
          from public.tyre_stint_deltas v
         where v.device_id = p_device_id
           and v.wear_begin_fl is not null
         order by v.laatste_meting desc
         limit 1;
        if found then
            v_provenance := 'last_known';
            v_basis := jsonb_build_object(
                'car_key', v_stand.car_key,
                'track_key', v_stand.track_key,
                'track_temp_c', v_stand.track_temp_c,
                'rondes_in_basis', coalesce(v_stand.wear_span, 0),
                'set_number', v_stand.set_number,
                'set_bron', v_stand.set_bron,
                'lap_from', v_stand.lap_from,
                'lap_to', v_stand.lap_to
            );
        end if;
    end if;

    if v_rate is not null and v_rate > 0 and v_wear_now is not null then
        v_remaining := v_wear_now - v_threshold;
        if v_remaining > 0 then
            v_laps := v_remaining / v_rate;
            case v_grade
                when 'A' then v_fac_laag := 1.10; v_fac_hoog := 0.90;
                when 'B' then v_fac_laag := 1.30; v_fac_hoog := 0.75;
                else          v_fac_laag := 2.00; v_fac_hoog := 0.50;
            end case;
            -- low = resterende wear bij een snellere slijtage (grotere deler),
            -- high = bij een tragere. Zo wordt de band breder naarmate de
            -- graad lager is, zonder de meting zelf te veranderen.
            v_low  := greatest(floor(v_laps / v_fac_laag), 0);
            v_high := ceil(v_laps / v_fac_hoog);
            v_range := jsonb_build_object('low', v_low::integer, 'high', v_high::integer);
        else
            -- Wear staat al op of onder de drempel: geen bereik verzinnen.
            v_range := jsonb_build_object('low', 0, 'high', 0);
        end if;
    end if;

    v_label := case v_grade
        when 'A' then 'drie of meer onafhankelijke stints'
        when 'B' then 'twee onafhankelijke stints'
        else 'één stint, ruime marge'
    end;

    -- Bruikbaar = er is een getal en er zijn minstens twee stints en de band
    -- heeft nog wear over. Voorlopig = dat getal is nog niet bevestigd: geen
    -- gemeten setgrens, geen getal, of een basis die te kort is om de helling
    -- boven de ruis uit te tillen.
    v_usable := v_rate is not null
                and v_grade in ('A', 'B')
                and coalesce(v_remaining, 0) > 0
                and v_range is not null;
    v_voorlopig := (not v_usable)
                   or v_provenance <> 'measured'
                   or coalesce(v_best.wear_span, 0) < v_min_basis;

    return jsonb_build_object(
        'grade', v_grade,
        'grade_label', v_label,
        'usable', v_usable,
        'voorlopig', v_voorlopig,
        'stints', v_aantal,
        'wear_per_lap', case when v_rate is not null then round(v_rate, 4) end,
        'zwakste_hoek', case when v_rate is not null then v_best.zwakste_hoek end,
        'range_laps', v_range,
        'wear_now', v_wear_now,
        'threshold_pct', v_threshold,
        'basis', v_basis,
        'provenance', v_provenance
    );
end;
$function$;

comment on function public.pitwall_tyre_estimate_v2(uuid) is
  'Stintschatting per apparaat: graad, wear_per_lap (procentpunt per ronde, positief = slijt), range_laps met marge naar graad, basis, herkomst en een expliciete voorlopig-vlag. Geen getal of bereik zonder bruikbare stint.';

revoke all on function public.pitwall_tyre_estimate_v2(uuid) from public, anon;
grant execute on function public.pitwall_tyre_estimate_v2(uuid) to authenticated;

commit;
