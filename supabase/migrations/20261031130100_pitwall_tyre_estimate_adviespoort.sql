-- ============================================================================
-- Endurance — de adviespoort: verse stand, graad op de combinatie, gemeten band
-- Datum: 2026-10-31
-- Vorige migratie: 20261031130000_pitwall_prior_pool_privacy.sql
--
-- Contractpunten 1 t/m 4. De functie heet nog steeds pitwall_tyre_estimate_v2
-- (de client roept die naam aan) maar de inhoud is op vier punten herzien. Elk
-- punt is een echte regel in de functie, geen label:
--
--   1. ADVIESPOORT. Een resterend aantal rondes is een uitspraak over de band
--      die NU onder de auto zit. Is de wear-stand niet vers, dan zegt de functie
--      dat: usable = false, grade hooguit C, range_laps = null, en de reden
--      staat in basis.redenen. Vers betekent hier drie dingen tegelijk:
--        * de nieuwste wear-meting is hooguit 10 minuten oud;
--        * die meting komt uit dezelfde sessie als het laatste frame;
--        * die meting valt binnen de stint (set) die nu onder de auto zit.
--      Twee van de drie is niet genoeg: een meting van tien minuten geleden uit
--      de vorige sessie is een historische stand, geen bandenstand.
--
--   2. GRAAD OP DE GEBRUIKTE COMBINATIE. De graad telde voorheen elke eigen
--      stint met een helling, ongeacht auto of baan. Daardoor kon een apparaat
--      graad A krijgen van drie stints op drie circuits en daarna op een vierde
--      circuit een "A" presenteren zonder één meting daar. Nu telt alleen
--      car_key + track_key van de gebruikte combinatie, met per stint minstens
--      drie rondes meetbasis. Stints zonder sleutels vallen af: die zijn niet
--      op een combinatie te plaatsen en dus geen bewijs voor deze combinatie.
--
--   3. BAND UIT GEMETEN SPREDING. De oude band was een vaste factor (1,10 /
--      1,30 / 2,00) maal een schaal op rondes. Dat is een aanname, geen meting.
--      Nu komt de breedte uit de gemeten spreiding van de helling tussen de
--      stints op deze combinatie (dezelfde hoek voor elke stint), plus de
--      meetonzekerheid van de eigen meting.
--
--      Let op wat "breedte" hier betekent: niet de spreiding van één stint
--      (die zegt hoe verschillend twee stints zijn), maar de onzekerheid van
--      het gemiddelde dat we doorgeven. Die is dezelfde spreiding, gedeeld door
--      de effectieve meetbasis: 1/som(w_i) met w_i = 1/(tau^2 + var_i). Twee
--      stints die het eens zijn geven dus een smalle band; twee die tien keer
--      van elkaar verschillen een brede. Zo groeit "meer data = smaller" op de
--      meting in plaats van op een constante.
--
--      Zijn er minder dan twee stints op de combinatie, dan is de band onbekend
--      en blijft range_laps null — geen kunstmatig smalle band uit één meting.
--      Raakt de onderkant van de band nul (rate - sigma <= 0), dan is er geen
--      bovengrens aan het aantal rondes; ook dan is de band onbekend en staat
--      zero_slope in de redenen.
--
--      Publicatie: de spreiding over andermans stints wordt alleen gebruikt als
--      de cel publiceerbaar is volgens de regel van 20261031130000 (minimaal
--      twee accounts na uitsluiting van het eigen apparaat). Is dat niet zo,
--      dan komt de band uit de eigen stints op de combinatie; zijn die er ook
--      minder dan twee, dan is de band onbekend.
--
--   4. n_eff ALS KISH-MAAT. Voorheen was rondes_effectief = eigen rondes +
--      de gewogen priorbasis (som van w x n). Dat telt de eigen stint als een
--      extra onafhankelijke waarneming terwijl hij al in de blend zit, en het
--      telt dezelfde rondes per trap op alsof elke trap nieuwe informatie is.
--      Nu: a_i = rondes_i / (tau^2 + var_i) met tau^2 de gemeten spreiding
--      tussen stints en var_i de meetonzekerheid van stint i, en
--      n_eff = (som a_i)^2 / som (a_i^2 / rondes_i).
--
--      De deling door rondes_i in de noemer is wat n_eff in RONDES houdt: bij
--      gelijke gewichten is de uitkomst exact het totale aantal rondes, en bij
--      ongelijke gewichten telt een lange, precieze stint zwaarder dan een
--      korte, ruizige. Zonder die deling zou n_eff het aantal stints zijn en
--      zou de band tien rondes als "tien stints" lezen.
--
--      De eigen stint zit één keer in de som: de pool sluit het eigen apparaat
--      bij de bron uit (20261029120000), dus eigen en gedeeld zijn een partitie.
--
-- Wat NIET verandert: alle bestaande sleutels in de uitvoer (grade, usable,
-- voorlopig, stints, stints_totaal, wear_per_lap, zwakste_hoek, range_laps,
-- wear_now, wear_now_car_key, wear_now_track_key, threshold_pct, basis,
-- provenance) en in basis (car_key, track_key, track_temp_c, rondes_in_basis,
-- rondes_in_stint, set_number, set_bron, lap_from, lap_to, zwakste_hoek,
-- rondes_effectief, bron, prior_rate, prior_n, prior_rondes, prior_stints,
-- prior_level, prior_bron). Nieuw in basis: actualiteit, gedeeld, eigen,
-- redenen en n_eff.
--
-- Eén bestaande sleutel krijgt een scherpere betekenis: `stints` is vanaf nu
-- het aantal eigen stints waar de GRaad op rust (dus op de gebruikte
-- combinatie), niet meer het aantal stints met een helling over alle circuits.
-- Anders zou de uitvoer "A" en "1 stint" naast elkaar kunnen zetten. Het totale
-- aantal eigen stints staat in stints_totaal, ongewijzigd.
-- ============================================================================

begin;

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

    -- Graad en tellingen
    v_grade      text := 'D';
    v_stints_graad   integer := 0;  -- eigen stints op de gebruikte combinatie
    v_stints_totaal  integer := 0;  -- alle eigen stints

    -- Actualiteit van de wear-stand
    v_frame_sess   text;
    v_frame_lap    integer;
    v_wear_sess    text;
    v_wear_lap     integer;
    v_wear_at      timestamptz;
    v_huidige      public.tyre_stint_deltas%rowtype;
    v_ouderheid    integer;
    v_sessie_match boolean := false;
    v_set_match    boolean := false;
    v_vers         boolean := false;

    -- Basis en puntsschatting
    v_provenance text := 'unavailable';
    v_label      text;
    v_voorlopig  boolean := true;
    v_usable     boolean := false;
    v_own_rate   numeric;
    v_own_n      integer;
    v_hoek       text;          -- steilste hoek van de eigen stint
    v_hoek_band  text;          -- hoek waar de spreiding over meet
    v_rate       numeric;
    v_w_eigen    numeric;
    v_prior      jsonb;
    v_prior_rate numeric;
    v_prior_n    numeric;
    v_prior_rondes integer;
    v_prior_stints integer;
    v_prior_level text;
    v_prior_bron text;
    v_prior_hoek text;
    v_prior_accounts integer;
    v_prior_publiek  boolean;
    v_bron       text;
    v_wear_now   numeric;
    v_wear_car   text;
    v_wear_track text;
    v_remaining  numeric;
    v_laps       numeric;
    v_low        numeric;
    v_high       numeric;
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
    v_context_mismatch boolean := false;

    -- Band en effectieve basis
    v_band_stints integer := 0;
    v_sigma_tot   numeric;      -- onzekerheid van de blend (pp per ronde)
    v_var_est     numeric;      -- variantie van het gewogen gemiddelde
    v_u_meet      numeric;
    v_rate_lo     numeric;
    v_rate_hi     numeric;
    v_n_eff       numeric := 0;
    v_eigen_rondes  integer := 0;
    v_eigen_stints  integer := 0;

    -- Redenen
    v_redenen    text[] := '{}'::text[];

    v_threshold  constant numeric := 40;
    v_min_basis  constant integer := 8;
    v_k          constant numeric := 8;
    -- De kleinste stap waarin de connector wear doorgeeft is 0,001 pp; de
    -- leesruis per meting is de halve stap. Deze waarde weegt alleen mee in
    -- var_i en in de meetonzekerheid van de eigen helling — hij is bewust
    -- klein, want de gemeten spreiding tussen stints hoort de band te bepalen,
    -- niet de resolutie van één getal.
    v_lees       constant numeric := 0.0005;
    -- Eén standaardafwijking. Geen vaste factor op de bandbreedte, maar de
    -- schaal waarop een meting normaal varieert.
    v_z          constant numeric := 1.0;
    -- Hoeveel minuten een wear-meting mag oud zijn om "vers" te heten.
    v_vers_min   constant integer := 10;
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

    -- Het totaal blijft beschikbaar zodat zichtbaar is hoeveel blokken er zijn;
    -- de graad zelf wordt verderop op de combinatie geteld.
    select count(*) into v_stints_totaal
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id;

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
    -- mooiste", maar de meest recente meting waar een helling uit volgt. Deze
    -- stint bepaalt de GEBRUIKTE COMBINATIE (auto + baan).
    -- Een helling van precies nul is geen meting van slijtage maar een ronde
    -- waarin de wear-teller niet verschoof; zo'n stint mag de schatting niet
    -- dragen (zie ook de reden zero_slope). Daarom minstens één hoek die
    -- werkelijk daalt.
    select * into v_best
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id
       and v.heeft_helling
       and v.wear_span is not null
       and v.wear_span >= 3
       and (v.wear_per_lap_fl < 0 or v.wear_per_lap_fr < 0
            or v.wear_per_lap_rl < 0 or v.wear_per_lap_rr < 0)
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
        -- De noemer van dát getal, niet die van de stint.
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
    -- een rij van een andere auto of baan.
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
    -- schatting, geen meting voor deze combinatie.
    if v_provenance in ('measured', 'last_known') and v_basis_car is not null then
        if (v_ctx_car is not null and v_ctx_car <> v_basis_car)
           or (v_ctx_track is not null and v_basis_track is not null
               and v_ctx_track <> v_basis_track)
           or (v_wear_car is not null and v_wear_car <> v_basis_car)
           or (v_wear_track is not null and v_basis_track is not null
               and v_wear_track <> v_basis_track) then
            v_context_mismatch := true;
            v_provenance := 'estimated';
        end if;
    end if;

    --------------------------------------------------------------------------
    -- 1. Actualiteit: is de wear-stand die we gebruiken nog de stand van nu?
    --------------------------------------------------------------------------
    -- Het laatste frame van dit apparaat: de sessie en de ronde die nu lopen.
    select s.session_key, s.lap_number
      into v_frame_sess, v_frame_lap
      from public.simhub_tyre_lap_samples s
     where s.device_id = p_device_id
     order by s.captured_at desc, s.lap_number desc
     limit 1;

    -- De nieuwste echte wear-meting (NaN telt niet mee). Leeftijd in hele
    -- minuten; een klokscheefstand mag nooit negatief worden.
    select s.session_key, s.lap_number, s.captured_at
      into v_wear_sess, v_wear_lap, v_wear_at
      from public.simhub_tyre_lap_samples s
     where s.device_id = p_device_id
       and greatest(nullif(s.wear_fl, 'NaN'::numeric),
                    nullif(s.wear_fr, 'NaN'::numeric),
                    nullif(s.wear_rl, 'NaN'::numeric),
                    nullif(s.wear_rr, 'NaN'::numeric)) is not null
     order by s.captured_at desc, s.lap_number desc
     limit 1;

    if v_wear_at is not null then
        v_ouderheid := greatest(
            floor(extract(epoch from (now() - v_wear_at)) / 60)::integer, 0);
    end if;

    -- De stint (set) die nu onder de auto zit: die van het laatste frame.
    select * into v_huidige
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id
       and v.session_key = v_frame_sess
       and v.lap_from <= v_frame_lap
       and v.lap_to   >= v_frame_lap
     order by v.lap_from desc
     limit 1;

    v_sessie_match := v_wear_at is not null
                      and v_frame_sess is not null
                      and v_wear_sess = v_frame_sess;

    -- De meting hoort bij de huidige set als hij in de stint valt die nu loopt.
    -- Dat is precies de set die onder de auto zit; een meting van de vorige set
    -- valt in een andere stint en telt dus niet als "de stand van nu".
    v_set_match := v_sessie_match
                   and v_huidige.set_number is not null
                   and v_wear_lap between v_huidige.lap_from and v_huidige.lap_to;

    v_vers := v_ouderheid is not null
              and v_ouderheid <= v_vers_min
              and v_sessie_match
              and v_set_match;

    --------------------------------------------------------------------------
    -- 2. De graad: alleen eigen stints op precies deze combinatie
    --------------------------------------------------------------------------
    -- Zonder sleutels is er geen combinatie en dus geen graad: een stint die
    -- nergens is geplaatst is geen bewijs voor deze auto op deze baan. De
    -- vergelijking met een NULL-sleutel levert nooit een treffer, dus die
    -- stints vallen hier vanzelf af.
    select count(*) into v_stints_graad
      from public.tyre_stint_deltas v
     where v.device_id   = p_device_id
       and v.car_key     = v_basis_car
       and v.track_key   = v_basis_track
       and v.heeft_helling
       and v.wear_span  >= 3;

    v_grade := case when v_stints_graad >= 3 then 'A'
                    when v_stints_graad = 2 then 'B'
                    when v_stints_graad = 1 then 'C'
                    else 'D' end;

    -- Een verouderde stand is geen advies over de banden die er nu op liggen.
    -- De graad blijft staan (hij gaat over de metingen), maar niet hoger dan C.
    if not v_vers and v_grade in ('A', 'B') then
        v_grade := 'C';
    end if;

    --------------------------------------------------------------------------
    -- 3a. De prior: de pool zonder dit apparaat, met de publicatieregel
    --------------------------------------------------------------------------
    -- Auto en baan blijven bij elkaar: een auto van de ene bron met een baan
    -- van de andere zou een combinatie verzinnen die niemand reed.
    if v_basis_car is not null or v_basis_track is not null then
        v_prior_car := v_basis_car;   v_prior_track := v_basis_track;
    elsif v_wear_car is not null or v_wear_track is not null then
        v_prior_car := v_wear_car;    v_prior_track := v_wear_track;
    else
        v_prior_car := v_ctx_car;     v_prior_track := v_ctx_track;
    end if;

    v_prior := public.tyre_prior_core(v_prior_car, v_prior_track,
                                      array[p_device_id]::uuid[]);
    v_prior_rate     := (v_prior->>'rate')::numeric;
    v_prior_n        := (v_prior->>'n_eff')::numeric;
    v_prior_rondes   := (v_prior->>'rondes')::integer;
    v_prior_stints   := (v_prior->>'stints')::integer;
    v_prior_accounts := (v_prior->>'accounts')::integer;
    v_prior_level    := v_prior->>'level';
    v_prior_bron     := v_prior->>'bron';
    v_prior_hoek     := v_prior->>'hoek';
    v_prior_publiek  := coalesce((v_prior->>'publicatie')::boolean, false);

    -- Bijwerken met de eigen stint, met dezelfde formule als in de prior:
    -- w = n/(n+8). Zonder prior is w_eigen het enige gewicht; zonder eigen
    -- stint is de prior het getal en heet de bron exact/auto/circuit/algemeen.
    if v_own_rate is not null and v_own_rate > 0 then
        v_w_eigen := coalesce(v_own_n, 0)::numeric / (coalesce(v_own_n, 0)::numeric + v_k);
        if v_prior_rate is not null and v_prior_rate > 0 then
            v_rate := v_w_eigen * v_own_rate + (1 - v_w_eigen) * v_prior_rate;
        else
            v_rate := v_own_rate;
        end if;
        v_bron := 'eigen';
    elsif v_prior_rate is not null and v_prior_rate > 0 then
        v_rate := v_prior_rate;
        v_bron := coalesce(v_prior_level, 'algemeen');
        -- Geen eigen meting: dit getal komt uit de pool, niet uit een stand van
        -- dit apparaat. Ook een wear-stand alleen wordt hier dus 'geschat'.
        v_provenance := 'estimated';
    end if;

    --------------------------------------------------------------------------
    -- 3b + 4. De band uit de gemeten spreiding, en n_eff als Kish-maat
    --------------------------------------------------------------------------
    -- De hoek: die van de eigen stint (daar hoort het getal bij). Zonder eigen
    -- helling die van de prior, zodat de spreiding over dezelfde hoek gaat als
    -- het getal dat we doorgeven.
    v_hoek_band := coalesce(v_hoek, v_prior_hoek);

    if v_hoek_band is not null and v_basis_car is not null and v_basis_track is not null then
        -- Kandidaten: elke stint op deze combinatie met een helling over
        -- minstens drie rondes in DEZELFDE hoek. Andermans stints tellen alleen
        -- mee als de cel publiceerbaar is; anders is de "spreiding" de rit van
        -- één iemand en die hoort niet in een band te zitten.
        with kandidaten as (
            select case v_hoek_band
                     when 'fl' then -v.wear_per_lap_fl
                     when 'fr' then -v.wear_per_lap_fr
                     when 'rl' then -v.wear_per_lap_rl
                     when 'rr' then -v.wear_per_lap_rr
                   end as rate,
                   case v_hoek_band
                     when 'fl' then v.wear_span_fl
                     when 'fr' then v.wear_span_fr
                     when 'rl' then v.wear_span_rl
                     when 'rr' then v.wear_span_rr
                   end as n,
                   v.device_id
              from public.tyre_stint_deltas v
             where v.car_key   = v_basis_car
               and v.track_key = v_basis_track
               and v.heeft_helling
               and (case v_hoek_band
                      when 'fl' then v.wear_span_fl
                      when 'fr' then v.wear_span_fr
                      when 'rl' then v.wear_span_rl
                      when 'rr' then v.wear_span_rr
                    end) >= 3
               and (v_prior_publiek or v.device_id = p_device_id)
        ),
        bruikbaar as (
            select k.* from kandidaten k where k.rate is not null and k.rate > 0
        ),
        stats as (
            select count(*)::integer                      as k,
                   stddev_samp(b.rate)                    as sd,
                   (sum(b.n) filter (where b.device_id = p_device_id))::integer as eigen_rondes,
                   (count(*) filter (where b.device_id = p_device_id))::integer as eigen_stints
              from bruikbaar b
        ),
        gewicht as (
            -- tau^2 = de gemeten spreiding TUSSEN stints; 0 als er maar één
            -- stint is (dan is er geen tussen-spreiding om te schatten).
            select s.*, coalesce(power(s.sd, 2), 0) as tau2 from stats s
        ),
        gew as (
            -- Twee maten uit dezelfde gewichten:
            --
            --   * n_eff (contractpunt 4): Kish over a_i = rondes_i/(tau^2+var_i).
            --     De noemer deelt door rondes_i, zodat de uitkomst in RONDES is:
            --     bij gelijke gewichten precies het totale aantal rondes.
            --   * var_est: de variantie van het gewogen gemiddelde. Die gebruikt
            --     het stint-gewicht w_i = 1/(tau^2+var_i) zonder de factor
            --     rondes (die hoort bij de onzekerheid van één meting, niet bij
            --     het gemiddelde van stints). 1/som(w_i) is de variantie van de
            --     blend in pp^2 per ronde^2.
            --
            -- var_i = 2*leesruis^2/n_i^2: twee lezingen (begin en eind), elk met
            -- de leesruis, gedeeld door de noemer van de helling in het kwadraat.
            select g.k, g.sd, g.tau2, g.eigen_rondes, g.eigen_stints,
                   sum(1 / (g.tau2 + 2 * power(v_lees, 2) / power(b.n, 2))) as sw,
                   sum(power(b.n / (g.tau2 + 2 * power(v_lees, 2) / power(b.n, 2)), 2) / b.n) as kish_noemer,
                   sum(b.n / (g.tau2 + 2 * power(v_lees, 2) / power(b.n, 2))) as kish_teller
              from gewicht g
              join bruikbaar b on true
             group by g.k, g.sd, g.tau2, g.eigen_rondes, g.eigen_stints
        )
        select w.k, w.eigen_rondes, w.eigen_stints,
               case when w.kish_noemer > 0 then power(w.kish_teller, 2) / w.kish_noemer end,
               case when w.sw > 0 then 1 / w.sw end
          into v_band_stints, v_eigen_rondes, v_eigen_stints, v_n_eff, v_var_est
          from gew w;
    end if;

    -- Meetonzekerheid van de eigen helling: twee lezingen over de eigen basis.
    v_u_meet := case when coalesce(v_own_n, 0) > 0
                     then sqrt(2 * power(v_lees, 2)) / v_own_n end;

    if v_rate is not null and v_rate > 0 and v_wear_now is not null then
        v_remaining := v_wear_now - v_threshold;
        if v_remaining > 0 then
            v_laps := v_remaining / v_rate;

            -- De band: alleen als er minstens twee stints op de combinatie zijn
            -- EN de stand vers is. De breedte komt uit de gemeten spreiding
            -- tussen stints plus de meetonzekerheid van de eigen meting; er zit
            -- geen vaste factor meer in.
            if v_vers
               and v_band_stints >= 2
               and v_var_est is not null
               and v_sigma_tot is null then
                -- De bandbreedte is de onzekerheid van de blend: de gemeten
                -- spreiding tussen stints, gedeeld door de effectieve meetbasis
                -- (1/som w_i), plus de meetonzekerheid van de eigen helling.
                -- Niet de spreiding van één stint: die zegt hoe verschillend
                -- twee stints zijn, niet hoe goed het gemiddelde vastligt.
                v_sigma_tot := sqrt(v_var_est + power(coalesce(v_u_meet, 0), 2));
                v_rate_lo := v_rate - v_z * v_sigma_tot;
                v_rate_hi := v_rate + v_z * v_sigma_tot;
            end if;

            if v_vers
               and v_band_stints >= 2
               and v_sigma_tot is not null
               and v_rate_lo is not null
               and v_rate_lo > 0 then
                v_low  := greatest(floor(v_remaining / v_rate_hi), 0);
                v_high := ceil(v_remaining / v_rate_lo);
                if v_low is null or v_low = 'NaN'::numeric
                   or v_high is null or v_high = 'NaN'::numeric then
                    v_range := null;
                else
                    v_range := jsonb_build_object('low', v_low::integer,
                                                  'high', greatest(v_high, v_low)::integer);
                end if;
            end if;
        else
            -- Wear staat al op of onder de drempel: geen bereik verzinnen. Ook
            -- hier geldt de poort: zonder verse stand is 0-0 geen advies.
            if v_vers then
                v_range := jsonb_build_object('low', 0, 'high', 0);
            end if;
        end if;
    end if;

    --------------------------------------------------------------------------
    -- De redenen: waarom het antwoord is zoals het is
    --------------------------------------------------------------------------
    -- Altijd gesorteerd en zonder dubbelen; een twijfelgeval is nooit stil.
    if coalesce(v_span_hoek, 0) < v_min_basis then
        v_redenen := v_redenen || 'short_basis'::text;
    end if;
    if coalesce(v_basis->>'set_bron', '') = 'afgeleid' then
        v_redenen := v_redenen || 'inferred_boundary'::text;
    end if;
    if v_context_mismatch then
        v_redenen := v_redenen || 'context_mismatch'::text;
    end if;
    if not v_vers then
        v_redenen := v_redenen || 'stale_state'::text;
    end if;
    if coalesce((v_prior->>'thin_pool')::boolean, false) then
        v_redenen := v_redenen || 'thin_pool'::text;
    end if;
    -- zero_slope: geen helling, of een band waarvan de onderkant nul raakt. In
    -- beide gevallen is de helling te klein om er een aantal rondes op te
    -- baseren: bij rate - z*sigma <= 0 is er geen bovengrens aan het aantal
    -- rondes, en een bereik zonder bovengrens is geen bereik.
    if v_rate is null or v_rate <= 0
       or (v_sigma_tot is not null and v_rate_lo is not null and v_rate_lo <= 0) then
        v_redenen := v_redenen || 'zero_slope'::text;
    end if;

    v_redenen := (select coalesce(array_agg(distinct r order by r), '{}'::text[])
                    from unnest(v_redenen) as r);

    v_label := case
        when v_stints_totaal = 0 then 'geen stints'
        when v_grade = 'A' then 'drie of meer stints op deze combinatie'
        when v_grade = 'B' then 'twee stints op deze combinatie'
        when v_grade = 'C' then 'één stint op deze combinatie, of een verouderde stand'
        else 'geen stint met een gemeten helling op deze combinatie'
    end;

    -- Bruikbaar = verse stand, graad A of B op deze combinatie, nog wear over,
    -- een meetbasis van minstens acht rondes in de gebruikte hoek en een band
    -- die echt gemeten is. Een prior maakt een apparaat niet bruikbaar; hij
    -- verschuift het getal en de band alleen als de cel publiceerbaar is.
    v_usable := v_vers
                and v_grade in ('A', 'B')
                and coalesce(v_remaining, 0) > 0
                and coalesce(v_span_hoek, 0) >= v_min_basis
                and v_range is not null;
    v_voorlopig := (not v_usable)
                   or v_provenance <> 'measured'
                   or coalesce(v_span_hoek, 0) < v_min_basis
                   or coalesce(v_bron, 'algemeen') <> 'eigen';

    -- De basis blijft wat hij was (de eigen stint), met daaronder de herkomst
    -- van het startpunt. Ontbreekt een eigen stint, dan is er geen basis om te
    -- tonen behalve de context en de prior — geen verzonnen stintgegevens.
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
        -- rondes_effectief blijft bestaan maar is nu de Kish-maat: de
        -- rondes die de uitkomst werkelijk dragen, niet de som van gewichten.
        'rondes_effectief', round(coalesce(v_n_eff, 0), 2),
        'n_eff', round(coalesce(v_n_eff, 0), 2),
        'bron', v_bron,
        'prior_rate', case when v_prior_rate is null then null else round(v_prior_rate, 4) end,
        'prior_n', v_prior_n,
        'prior_rondes', coalesce(v_prior_rondes, 0),
        'prior_stints', coalesce(v_prior_stints, 0),
        'prior_level', v_prior_level,
        'prior_bron', v_prior_bron,
        'actualiteit', jsonb_build_object(
            'wear_ouderheid_min', v_ouderheid,
            'sessie_match', v_sessie_match,
            'set_match', v_set_match,
            'vers', v_vers
        ),
        'gedeeld', jsonb_build_object(
            'rate', case when v_prior_rate is null then null else round(v_prior_rate, 4) end,
            'rondes', coalesce(v_prior_rondes, 0),
            'stints', coalesce(v_prior_stints, 0),
            'accounts', coalesce(v_prior_accounts, 0)
        ),
        'eigen', jsonb_build_object(
            'rate', case when v_own_rate is null then null else round(v_own_rate, 4) end,
            'rondes', coalesce(v_eigen_rondes, 0),
            'stints', coalesce(v_eigen_stints, 0)
        ),
        'redenen', to_jsonb(v_redenen)
    );

    return jsonb_build_object(
        'grade', v_grade,
        'grade_label', v_label,
        'usable', v_usable,
        'voorlopig', v_voorlopig,
        'stints', v_stints_graad,
        'stints_totaal', v_stints_totaal,
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
  'Stintschatting per apparaat met een adviespoort. De graad telt alleen eigen stints op de gebruikte car_key + track_key (minimaal 3 rondes meetbasis per stint; stints zonder sleutels tellen niet). range_laps komt uit de gemeten spreiding van wear_per_lap tussen stints op die combinatie (zelfde hoek) plus de meetonzekerheid van de eigen meting, en is null zonder twee stints. Is de wear-stand niet vers (ouder dan 10 minuten, andere sessie of andere set), dan is usable false, de graad hooguit C en range_laps null; de redenen staan in basis.redenen (short_basis, inferred_boundary, context_mismatch, stale_state, thin_pool, zero_slope). basis.n_eff/rondes_effectief is de Kish-maat over a_i = rondes_i/(tau^2+var_i), zodat de eigen stint één keer meetelt. basis.gedeeld is de pool zonder dit apparaat (rate, rondes, stints, accounts), basis.eigen de eigen metingen op deze combinatie.';

revoke all on function public.pitwall_tyre_estimate_v2(uuid) from public, anon;
grant execute on function public.pitwall_tyre_estimate_v2(uuid) to authenticated;

commit;
