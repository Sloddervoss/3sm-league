-- ============================================================================
-- Endurance — meetbasis van de gebruikte hoek en contextcheck in het
-- last_known-pad
-- Datum: 2026-10-28
-- Vorige migratie: 20261028120000_tyre_stint_model_fixes.sql
--
-- Twee rekenkundige gaten uit de herkeuring. Beide zitten alleen in
-- pitwall_tyre_estimate_v2(); de view, tyre_coverage() en de brontabel blijven
-- ongewijzigd.
--
-- 1. De bruikbaarheidstoets keek naar de span van de hele stint, terwijl het
--    getal uit één hoek komt. Scenario: FR valt 5 pp tussen ronde 1 en 2 en
--    wordt daarna niet meer gemeten (eigen span 1), FL/RL/RR meten 9 rondes.
--    De stintspan is 9, dus `rondes_in_basis` was 9 en `usable` werd true —
--    terwijl de gebruikte helling op één ronde rust. Nu rekent de toets met de
--    span van de hoek waar `wear_per_lap` vandaan komt:
--      * `basis.rondes_in_basis` = die hoekspan (de echte noemer);
--      * `basis.rondes_in_stint` = de stintspan, apart en gelijk aan vroeger;
--      * `usable` en `voorlopig` en de bandbreedte (`v_schaal`) hangen aan
--        de hoekspan, niet aan de stintspan.
--    De keuze van de hoek verandert niet: `zwakste_hoek` blijft de steilste
--    hoek (dezelfde als in de view), dus tabel en getal blijven gelijk. Alleen
--    het oordeel over de basis wordt eerlijk.
--
-- 2. In het last_known-pad (geen enkele stint met een helling) werd `wear_now`
--    niet tegen de context gecontroleerd. Stond de basis op auto A en kwam de
--    nieuwste wear-meting uit auto B, dan bleef `provenance` `last_known`
--    terwijl die stand niet bij de basis hoort. Nu geldt dezelfde
--    auto/baancontrole voor beide paden: wijkt de wear-rij (of de laatst
--    bekende context) af van de basis, dan wordt de herkomst `estimated`.
--    Bovendien krijgt in het last_known-pad een wear-rij die bij de basisauto
--    past nu ook voorrang, net als in het measured-pad — anders zou de
--    voorkeur asymmetrisch zijn.
--
-- Waarom `estimated` en niet `last_known`: `last_known` zegt "de laatste stand
-- van deze auto/baan, zonder tempo". Klopt de auto of baan niet, dan is het
-- geen stand van deze combinatie maar een schatting daarvan. `estimated` is dan
-- het eerlijke woord, ook zonder getal erachter.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- De schatting voor de pitwall (v2)
-- ---------------------------------------------------------------------------
-- Graad  : A = 3+ stints met een gemeten helling, B = 2, C = 1, D = 0.
-- Getal  : alleen als de beste stint een gemeten helling heeft over minstens
--          drie rondes; wear_per_lap is de helling van de steilste hoek
--          (procentpunt per ronde, positief = slijt).
-- Basis  : `rondes_in_basis` is de span van de hoek waar dat getal vandaan
--          komt — de echte noemer. `rondes_in_stint` is de span van de hele
--          stint ernaast, zodat zichtbaar blijft hoeveel er gemeten is.
-- Bereik : resterende wear tot 40 % gedeeld door die helling, met een marge die
--          meegroeit met de graad én met een korte meetbasis: onder acht rondes
--          (van de gebruikte hoek) wordt de band breder, boven acht smaller.
--          usable pas bij acht rondes van die hoek.
-- Herkomst: measured (eigen helling met teller als setgrens), estimated (helling
--          wel gemeten maar setgrens afgeleid, of auto/baan van de basis, de
--          context of de wear-stand wijkt af), last_known (alleen een wear-stand
--          die bij de basis past), unavailable (geen stint).
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

commit;
