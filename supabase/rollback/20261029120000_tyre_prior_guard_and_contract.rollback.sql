-- Rollback van 20261029120000_tyre_prior_guard_and_contract.sql
--
-- Volgorde: eerst de leesfuncties terug naar de versie van 20261029090000 (die
-- geen apparaat kent en de pool niet uitsluit), dan de trigger terug naar de
-- statement-trigger die alles opnieuw berekent, dan de boekhouding weg.
-- Anders verwijst een functie naar een tabel die al weg is.
--
-- Wat blijft staan, en waarom:
--   * de rechten op tyre_prior_stats blijven ingetrokken. De rollback zet het
--     model terug, niet het truncate-gat: anon en authenticated kregen via de
--     default privileges TRUNCATE en dat is een fout, geen eigenschap van deze
--     migratie. Wil je ze tóch terug (bijvoorbeeld om een oude client te
--     bedienen), dan is dat een bewuste keuze met een eigen grant:
--       grant select on public.tyre_prior_stats to authenticated;
--   * tyre_prior_stats houdt de cijfers die de nieuwe trigger heeft
--     bijgehouden; tyre_prior_refresh() hieronder bouwt ze op naar de oude
--     betekenis (alle stints, ook de lopende).
--
-- Wat verdwijnt: tyre_prior_contrib (de per-stint-boekhouding), de drie
-- statement-triggers met overgangstabellen, tyre_prior_sync_session(),
-- tyre_prior_closed_session(), de 3-arg tyre_prior() en de velden
-- basis.prior_rondes/prior_stints in de schatting.

begin;

-- ---------------------------------------------------------------------------
-- 1. De prior terug naar twee argumenten (zonder uitsluiting van een apparaat)
-- ---------------------------------------------------------------------------
drop function if exists public.tyre_prior(text, text, uuid);

create or replace function public.tyre_prior(p_car_key text, p_track_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_k        constant numeric := 8;
  v_min      constant integer := 3;
  v_traps    jsonb;
  v_rate     numeric;
  v_n_eff    numeric := 0;
  v_niveau   text;          -- fijnste trap die meedeed
  v_trap     text;          -- lusteller
  v_bron     text[] := '{}';
  v_w        numeric;
  v_deel     jsonb;
begin
  -- De vier traps in één keer: per trap de som per hoek, en daaruit de
  -- steilste hoek met een meetbasis van minstens drie rondes. De hoekkeuze is
  -- dezelfde als in de stintview (steilste helling), zodat prior en eigen
  -- meting hetzelfde soort getal zijn.
  with scoped as (
    select 'exact'::text as trap, s.*
      from public.tyre_prior_stats s
     where p_car_key is not null and p_track_key is not null
       and s.car_key = p_car_key and s.track_key = p_track_key
    union all
    select 'auto'::text, s.*
      from public.tyre_prior_stats s
     where p_car_key is not null
       and s.car_key = p_car_key
       and (p_track_key is null or s.track_key <> p_track_key)
    union all
    select 'circuit'::text, s.*
      from public.tyre_prior_stats s
     where p_track_key is not null
       and s.track_key = p_track_key
       and (p_car_key is null or s.car_key <> p_car_key)
    union all
    select 'algemeen'::text, s.*
      from public.tyre_prior_stats s
     where (p_car_key is null or s.car_key <> p_car_key)
       and (p_track_key is null or s.track_key <> p_track_key)
  ),
  total as (
    select trap,
           sum(stints)::integer as stints,
           sum(rondes)::integer as rondes,
           sum(sum_wear_fl) as w_fl, sum(rondes_fl)::integer as n_fl,
           sum(sum_wear_fr) as w_fr, sum(rondes_fr)::integer as n_fr,
           sum(sum_wear_rl) as w_rl, sum(rondes_rl)::integer as n_rl,
           sum(sum_wear_rr) as w_rr, sum(rondes_rr)::integer as n_rr
      from scoped
     group by trap
  ),
  hoek as (
    select t.trap, t.stints, t.rondes, h.rate, h.n
      from total t
      cross join lateral (
        select x.wear / x.rondes as rate, x.rondes as n
          from (values
                 ('fl', t.w_fl, t.n_fl),
                 ('fr', t.w_fr, t.n_fr),
                 ('rl', t.w_rl, t.n_rl),
                 ('rr', t.w_rr, t.n_rr)
               ) as x(hoek, wear, rondes)
         where x.rondes >= v_min
         order by x.wear / x.rondes desc, x.rondes desc
         limit 1
      ) h
  )
  select coalesce(jsonb_object_agg(
           h.trap,
           jsonb_build_object('rate', h.rate, 'n', h.n,
                              'stints', h.stints, 'rondes', h.rondes)), '{}'::jsonb)
    into v_traps
    from hoek h;

  -- Van grof naar fijn. Een trap zonder data laat de lopende waarde staan:
  -- geen data is geen mening, en null mag nooit een getal wegpoetsen.
  v_deel := v_traps->'algemeen';
  if v_deel is not null then
    v_rate := (v_deel->>'rate')::numeric;
    v_w := (v_deel->>'n')::numeric / ((v_deel->>'n')::numeric + v_k);
    v_n_eff := v_n_eff + v_w * (v_deel->>'n')::numeric;
    v_niveau := 'algemeen';
    v_bron := v_bron || format('algemeen: %s stints, %s rondes over alle auto''s en circuits',
                               v_deel->>'stints', v_deel->>'rondes');
  end if;

  foreach v_trap in array array['circuit', 'auto', 'exact'] loop
    v_deel := v_traps->v_trap;
    if v_deel is null then
      continue;
    end if;
    v_w := (v_deel->>'n')::numeric / ((v_deel->>'n')::numeric + v_k);
    v_rate := case when v_rate is null then (v_deel->>'rate')::numeric
                   else v_w * (v_deel->>'rate')::numeric + (1 - v_w) * v_rate end;
    v_n_eff := v_n_eff + v_w * (v_deel->>'n')::numeric;
    v_niveau := v_trap;
    v_bron := v_bron || format('%s: %s stints, %s rondes',
                               case v_trap when 'circuit' then 'andere auto''s op dit circuit'
                                           when 'auto'    then 'deze auto op andere circuits'
                                           else 'eigen data: deze auto op dit circuit' end,
                               v_deel->>'stints', v_deel->>'rondes');
  end loop;

  return jsonb_build_object(
    'rate', case when v_rate is null then null else round(v_rate, 4) end,
    'n_eff', round(coalesce(v_n_eff, 0), 2),
    'level', v_niveau,
    'bron', case when v_rate is null then 'nog geen gedeelde stints voor deze combinatie'
                 else array_to_string(v_bron, ' · ') end
  );
end;
$$;

comment on function public.tyre_prior(text, text) is
  'Hiërarchische bandenprior: exact (auto+circuit) -> auto -> circuit -> algemeen, per trap gewicht w=n/(n+8) op rondes, van grof naar fijn geblend. Geeft alleen rate (pp per ronde), n_eff (gedragen rondes), level en een mensleesbare bron met aantallen. Geen apparaat, sessie of coureur.';

revoke all on function public.tyre_prior(text, text) from public, anon;
grant execute on function public.tyre_prior(text, text) to authenticated;

comment on function public.tyre_prior(text, text) is
  'Hiërarchische bandenprior: exact (auto+circuit) -> auto -> circuit -> algemeen, per trap gewicht w=n/(n+8) op rondes, van grof naar fijn geblend. Geeft alleen rate (pp per ronde), n_eff (gedragen rondes), level en een mensleesbare bron met aantallen. Geen apparaat, sessie of coureur.';

revoke all on function public.tyre_prior(text, text) from public, anon;
grant execute on function public.tyre_prior(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. De schatting terug naar de versie zonder uitsluiting
-- ---------------------------------------------------------------------------
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
    v_own_rate   numeric;
    v_own_n      integer;
    v_hoek       text;          -- steilste hoek van de eigen stint
    v_rate       numeric;
    v_w_eigen    numeric;
    v_prior      jsonb;
    v_prior_rate numeric;
    v_prior_n    numeric;
    v_prior_level text;
    v_prior_bron text;
    v_bron       text;
    v_n_eff      numeric;
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
    v_prior_car   text;
    v_prior_track text;
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
    v_k          constant numeric := 8;
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
        v_own_rate := case v_best.zwakste_hoek
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
        v_own_n       := v_span_hoek;
        v_hoek        := v_best.zwakste_hoek;
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

    -- Welke combinatie vragen we de prior naar? De basis van de eigen meting
    -- is de eerlijkste vraag (daar hoort het getal bij). Zonder eigen stint de
    -- laatste wear-stand, en zonder die de context. Auto en baan blijven bij
    -- elkaar: een auto van de ene bron met een baan van de andere zou een
    -- combinatie verzinnen die niemand reed.
    if v_basis_car is not null or v_basis_track is not null then
        v_prior_car := v_basis_car;   v_prior_track := v_basis_track;
    elsif v_wear_car is not null or v_wear_track is not null then
        v_prior_car := v_wear_car;    v_prior_track := v_wear_track;
    else
        v_prior_car := v_ctx_car;     v_prior_track := v_ctx_track;
    end if;

    v_prior := public.tyre_prior(v_prior_car, v_prior_track);
    v_prior_rate  := (v_prior->>'rate')::numeric;
    v_prior_n     := (v_prior->>'n_eff')::numeric;
    v_prior_level := v_prior->>'level';
    v_prior_bron  := v_prior->>'bron';

    -- Bijwerken met de eigen stint, met dezelfde formule als in de prior:
    -- w = n/(n+8). Zonder prior is w_eigen het enige gewicht en verandert er
    -- niets aan het getal; zonder eigen stint is de prior het getal en heet de
    -- bron auto/circuit/algemeen.
    if v_own_rate is not null and v_own_rate > 0 then
        v_w_eigen := coalesce(v_own_n, 0)::numeric / (coalesce(v_own_n, 0)::numeric + v_k);
        if v_prior_rate is not null and v_prior_rate > 0 then
            v_rate  := v_w_eigen * v_own_rate + (1 - v_w_eigen) * v_prior_rate;
            v_n_eff := coalesce(v_own_n, 0) + coalesce(v_prior_n, 0);
        else
            v_rate  := v_own_rate;
            v_n_eff := coalesce(v_own_n, 0);
        end if;
        v_bron := 'eigen';
    elsif v_prior_rate is not null and v_prior_rate > 0 then
        v_rate  := v_prior_rate;
        v_n_eff := coalesce(v_prior_n, 0);
        v_bron  := coalesce(v_prior_level, 'algemeen');
        -- Geen eigen meting: dit getal komt uit de pool, niet uit een stand van
        -- dit apparaat. Ook een wear-stand alleen (last_known) wordt hier dus
        -- 'geschat', want de helling is geleend.
        v_provenance := 'estimated';
    end if;

    if v_rate is not null and v_rate > 0 and v_wear_now is not null then
        v_remaining := v_wear_now - v_threshold;
        if v_remaining > 0 then
            v_laps := v_remaining / v_rate;
            -- De bandbreedte hangt aan de effectieve basis: acht rondes is de
            -- nominale marge, korter wordt breder (tot 4x), langer smaller
            -- (tot 0,5x). Die 0,5 is de vloer: de helling blijft een meting
            -- met ruis, dus meer data maakt de band niet willekeurig smal.
            v_span := greatest(coalesce(v_n_eff, 0), 1);
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
            -- De eigen meting valt altijd binnen de band. Een prior mag het
            -- gemeten getal niet wegduwen: wijkt de pool af van wat dit
            -- apparaat zelf zag, dan wordt de band breder in plaats van dat de
            -- meting erbuiten valt. Zonder prior is dit een no-op, want dan is
            -- rate de eigen helling en ligt die per definitie in het midden.
            if v_own_rate is not null and v_own_rate > 0 then
                v_low  := least(v_low, floor(v_remaining / v_own_rate));
                v_high := greatest(v_high, ceil(v_remaining / v_own_rate));
            end if;
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

    v_label := case
        when v_totaal = 0 then 'geen stints'
        when v_grade = 'A' then 'drie of meer onafhankelijke stints'
        when v_grade = 'B' then 'twee onafhankelijke stints'
        when v_grade = 'C' then 'één stint, ruime marge'
        else 'geen stint met een gemeten helling'
    end;

    -- Bruikbaar = er is een getal, de graad is A of B, er is nog wear over en de
    -- meetbasis van de gebruikte hoek is lang genoeg (acht rondes) om de
    -- helling boven de ruis uit te tillen. Dat blijft een uitspraak over de
    -- eigen meting: een prior maakt een apparaat niet bruikbaar, hij maakt het
    -- bereik alleen smaller of breder. Voorlopig = dat getal is nog niet
    -- bevestigd, of het startpunt was niet de eigen stint.
    v_usable := v_rate is not null
                and v_grade in ('A', 'B')
                and coalesce(v_remaining, 0) > 0
                and coalesce(v_span_hoek, 0) >= v_min_basis
                and v_range is not null;
    v_voorlopig := (not v_usable)
                   or v_provenance <> 'measured'
                   or coalesce(v_span_hoek, 0) < v_min_basis
                   or coalesce(v_bron, 'algemeen') <> 'eigen';

    -- De basis blijft exact wat hij was (de eigen stint), met daaronder de
    -- herkomst van het startpunt. Ontbreekt een eigen stint, dan is er geen
    -- basis om te tonen behalve de context en de prior — geen verzonnen
    -- stintgegevens, alleen wat we werkelijk weten.
    if v_basis is null then
        v_basis := jsonb_build_object(
            'car_key', v_prior_car,
            'track_key', v_prior_track,
            'track_temp_c', null,
            'rondes_in_basis', 0,
            'rondes_in_stint', null,
            'set_number', null,
            'set_bron', null,
            'lap_from', null,
            'lap_to', null,
            'zwakste_hoek', null
        );
    end if;
    v_basis := v_basis || jsonb_build_object(
        'rondes_effectief', coalesce(v_n_eff, 0),
        'bron', v_bron,
        'prior_rate', case when v_prior_rate is null then null else round(v_prior_rate, 4) end,
        'prior_n', v_prior_n,
        'prior_level', v_prior_level,
        'prior_bron', v_prior_bron
    );

    return jsonb_build_object(
        'grade', v_grade,
        'grade_label', v_label,
        'usable', v_usable,
        'voorlopig', v_voorlopig,
        'stints', v_aantal,
        'stints_totaal', v_totaal,
        'wear_per_lap', case when v_rate is not null then round(v_rate, 4) end,
        'zwakste_hoek', case when v_own_rate is not null then v_hoek end,
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
  'Stintschatting per apparaat: graad op de eigen stints met een gemeten helling, wear_per_lap van de steilste hoek (procentpunt per ronde, positief = slijt), bijgewerkt met de hiërarchische prior (tyre_prior) via w = n/(n+8) op rondes. basis.bron zegt waar het startpunt vandaan kwam (eigen|auto|circuit|algemeen), basis.prior_rate/prior_n/prior_level de prior zelf en basis.rondes_effectief de basis achter de bandbreedte. range_laps schaalt met rate en die effectieve basis, met 0,5x als meetruisvloer; usable blijft een uitspraak over de eigen meting.';

revoke all on function public.pitwall_tyre_estimate_v2(uuid) from public, anon;
grant execute on function public.pitwall_tyre_estimate_v2(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. De triggers terug naar één statement-trigger die alles herberekent
-- ---------------------------------------------------------------------------
drop trigger if exists simhub_tyre_lap_samples_prior_ins on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_prior_upd on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_prior_del on public.simhub_tyre_lap_samples;

drop function if exists public.tyre_prior_on_insert();
drop function if exists public.tyre_prior_on_update();
drop function if exists public.tyre_prior_on_delete();
drop function if exists public.tyre_prior_sync_session(uuid, text);
drop function if exists public.tyre_prior_closed_session(uuid, text, integer, timestamptz, integer, numeric);

create or replace function public.tyre_prior_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tyre_prior_refresh();
  return null;
exception
  when others then
    -- Een statistiek mag nooit een meting blokkeren. De ingest gaat door; het
    -- signaal staat in het PG-log en de volgende flush herberekent alles.
    raise warning 'tyre_prior_refresh faalde: %', sqlerrm;
    return null;
end;
$$;

drop trigger if exists simhub_tyre_lap_samples_prior_trg on public.simhub_tyre_lap_samples;
create trigger simhub_tyre_lap_samples_prior_trg
after insert or update or delete on public.simhub_tyre_lap_samples
for each statement execute function public.tyre_prior_touch();

create or replace function public.tyre_prior_refresh(p_car_key text default null, p_track_key text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rijen integer;
begin
  -- Groepen die hun laatste bruikbare stint kwijt zijn, verdwijnen. Anders
  -- blijft een verwijderde of gecorrigeerde stint voor altijd meewegen.
  delete from public.tyre_prior_stats s
   where (p_car_key is null or s.car_key = p_car_key)
     and (p_track_key is null or s.track_key = p_track_key)
     and not exists (
       select 1
         from public.tyre_stint_deltas v
        where v.car_key = s.car_key
          and v.track_key = s.track_key
          and v.heeft_helling
          and v.wear_span >= 3
     );

  with bron as (
    select v.car_key,
           v.track_key,
           v.wear_span,
           case when v.wear_span_fl >= 3 and v.wear_per_lap_fl is not null
                then v.wear_begin_fl - v.wear_end_fl end as d_fl,
           case when v.wear_span_fr >= 3 and v.wear_per_lap_fr is not null
                then v.wear_begin_fr - v.wear_end_fr end as d_fr,
           case when v.wear_span_rl >= 3 and v.wear_per_lap_rl is not null
                then v.wear_begin_rl - v.wear_end_rl end as d_rl,
           case when v.wear_span_rr >= 3 and v.wear_per_lap_rr is not null
                then v.wear_begin_rr - v.wear_end_rr end as d_rr,
           v.wear_span_fl as n_fl,
           v.wear_span_fr as n_fr,
           v.wear_span_rl as n_rl,
           v.wear_span_rr as n_rr
      from public.tyre_stint_deltas v
     where v.car_key is not null
       and v.track_key is not null
       and v.heeft_helling
       and v.wear_span >= 3
       and (p_car_key is null or v.car_key = p_car_key)
       and (p_track_key is null or v.track_key = p_track_key)
  ),
  agg as (
    select b.car_key,
           b.track_key,
           count(*) filter (
             where b.d_fl is not null or b.d_fr is not null
                or b.d_rl is not null or b.d_rr is not null
           )::integer as stints,
           coalesce(sum(b.wear_span) filter (
             where b.d_fl is not null or b.d_fr is not null
                or b.d_rl is not null or b.d_rr is not null
           ), 0)::integer as rondes,
           coalesce(sum(b.d_fl), 0) as sum_wear_fl,
           coalesce(sum(b.d_fr), 0) as sum_wear_fr,
           coalesce(sum(b.d_rl), 0) as sum_wear_rl,
           coalesce(sum(b.d_rr), 0) as sum_wear_rr,
           coalesce(sum(b.n_fl) filter (where b.d_fl is not null), 0)::integer as rondes_fl,
           coalesce(sum(b.n_fr) filter (where b.d_fr is not null), 0)::integer as rondes_fr,
           coalesce(sum(b.n_rl) filter (where b.d_rl is not null), 0)::integer as rondes_rl,
           coalesce(sum(b.n_rr) filter (where b.d_rr is not null), 0)::integer as rondes_rr
      from bron b
     group by b.car_key, b.track_key
  )
  insert into public.tyre_prior_stats as s (
    car_key, track_key, stints, rondes,
    sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
    rondes_fl, rondes_fr, rondes_rl, rondes_rr, bijgewerkt_op)
  select a.car_key, a.track_key, a.stints, a.rondes,
         a.sum_wear_fl, a.sum_wear_fr, a.sum_wear_rl, a.sum_wear_rr,
         a.rondes_fl, a.rondes_fr, a.rondes_rl, a.rondes_rr, now()
    from agg a
  on conflict (car_key, track_key) do update set
    stints      = excluded.stints,
    rondes      = excluded.rondes,
    sum_wear_fl = excluded.sum_wear_fl,
    sum_wear_fr = excluded.sum_wear_fr,
    sum_wear_rl = excluded.sum_wear_rl,
    sum_wear_rr = excluded.sum_wear_rr,
    rondes_fl   = excluded.rondes_fl,
    rondes_fr   = excluded.rondes_fr,
    rondes_rl   = excluded.rondes_rl,
    rondes_rr   = excluded.rondes_rr,
    bijgewerkt_op = excluded.bijgewerkt_op;

  select count(*) into v_rijen
    from public.tyre_prior_stats s
   where (p_car_key is null or s.car_key = p_car_key)
     and (p_track_key is null or s.track_key = p_track_key);
  return v_rijen;
end;
$$;

comment on function public.tyre_prior_refresh(text, text) is
  'Herberekent tyre_prior_stats uit tyre_stint_deltas. Zonder argumenten alles; met argumenten alleen die cel(len). Idempotent en set-based: één aanroep per schrijfopdracht is genoeg.';

revoke all on function public.tyre_prior_refresh(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. De boekhouding weg
-- ---------------------------------------------------------------------------
drop table if exists public.tyre_prior_contrib;

-- De cijfers weer op de oude betekenis brengen: alle stints, ook de lopende.
select public.tyre_prior_refresh();

commit;
