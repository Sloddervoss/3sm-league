-- ============================================================================
-- Endurance — correcties op het bandenstintmodel
-- Datum: 2026-10-28
-- Vorige migratie: 20261028090000_tyre_stint_model.sql
--
-- Die migratie zette de stint als eerste-klas object neer, maar op acht punten
-- was het model te ruim of te optimistisch. Deze migratie corrigeert dat en
-- wijzigt niets aan de brontabel of aan v1:
--
--   1. Graad telt alleen stints met een gemeten helling (minstens één hoek met
--      twee metingen en een eigen span van minstens één ronde). Een blok zonder
--      bruikbare helling is geen bewijs van dekking en telt dus niet mee in
--      A/B/C — niet in tyre_coverage en niet in pitwall_tyre_estimate_v2.
--      tyre_coverage.wear_labels telt dezelfde stints (was: alleen FL).
--   2. NaN in een wear-kolom laat de schatting niet meer crashen. NaN wordt bij
--      binnenkomst NULL (nullif), en vóór elke ::integer-cast staat een guard.
--   3. De setgrens gebruikt niet langer lag(tyre_set) — die pakt de vorige rij,
--      ook als die geen teller heeft, waardoor een pitstop naast een NULL-rij
--      stil verdwijnt (65 % van de productierijen heeft geen teller). In plaats
--      daarvan: de laatste niet-NULL tyre_set binnen de partitie. Zonder enige
--      tellerhistorie blijft de wear-sprong het bewijs.
--   4. wear_per_lap gebruikt per hoek de eigen span (eerste en laatste meting
--      van die hoek), niet de span van de hele stint. Een hoek die later
--      begint of eerder ophoudt, krijgt zo zijn eigen noemer.
--   5. De bandbreedte schaalt mee met de meetbasis: korter dan acht rondes geeft
--      een bredere band, langer geeft een smallere. usable wordt pas true bij
--      wear_span >= 8; daaronder is het getal een indicatie, geen belofte.
--   6. zwakste_hoek is de hoek met de steilste helling — precies de hoek waar
--      pitwall_tyre_estimate_v2 zijn wear_per_lap vandaan haalt.
--   7. wear_now mag niet uit een andere auto of baan komen dan de basis. Bij een
--      mismatch wordt de herkomst estimated; een passende rij krijgt voorrang.
--   8. captured_at staat in elke window-ordening, zodat twee rijen met hetzelfde
--      rondenummer deterministisch ordenen.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. De stintview
-- ---------------------------------------------------------------------------
-- Kolommen erbij (achteraan, zodat create or replace de bestaande lezers houdt):
--   wear_span_fl/fr/rl/rr — de meetbasis per hoek
--   heeft_helling         — ten minste één hoek met een bruikbare helling
create or replace view public.tyre_stint_deltas as
with bron as (
  select s.device_id,
         s.session_key,
         s.lap_number,
         s.captured_at,
         s.tyre_set,
         -- NaN is geen meting. nullif maakt er NULL van, zodat het niet als
         -- "grootste waarde" door greatest()/least() heen glipt en later op een
         -- ::integer-cast klapt.
         nullif(s.wear_fl, 'NaN'::numeric) as wear_fl,
         nullif(s.wear_fr, 'NaN'::numeric) as wear_fr,
         nullif(s.wear_rl, 'NaN'::numeric) as wear_rl,
         nullif(s.wear_rr, 'NaN'::numeric) as wear_rr,
         greatest(nullif(s.wear_fl, 'NaN'::numeric),
                  nullif(s.wear_fr, 'NaN'::numeric),
                  nullif(s.wear_rl, 'NaN'::numeric),
                  nullif(s.wear_rr, 'NaN'::numeric)) as wear_max,
         s.track_temp_c,
         s.car_key,
         s.track_key
    from public.simhub_tyre_lap_samples s
),
basis0 as (
  select b.*,
         -- Groepsnummer per niet-NULL waarde: de klassieke last-observation-
         -- carried-forward. max() binnen de groep is dan precies de laatst
         -- bekende waarde (de groep bevat één gevulde rij en de lege erna).
         count(b.tyre_set) over w_kop as set_groep,
         count(b.wear_max) over w_kop as wear_groep
    from bron b
  window w_kop as (partition by b.device_id, b.session_key
                   order by b.lap_number, b.captured_at
                   rows between unbounded preceding and current row)
),
gevuld as (
  select b.*,
         max(b.tyre_set) over (partition by b.device_id, b.session_key, b.set_groep)   as set_carried,
         max(b.wear_max) over (partition by b.device_id, b.session_key, b.wear_groep)  as wear_carried
    from basis0 b
),
basis as (
  select g.*,
         -- Laatste niet-NULL teller vóór deze rij. lag() gaf de vorige rij en
         -- verloor daarmee elke setwissel die naast een rij zonder teller lag.
         lag(g.set_carried) over w as vorige_set,
         -- Zelfde carry-forward voor wear: een rij zonder wear mag het
         -- wear-sprongbewijs niet wissen.
         lag(g.wear_carried) over w as vorige_wear_max
    from gevuld g
  window w as (partition by g.device_id, g.session_key
               order by g.lap_number, g.captured_at)
),
grens as (
  select b.*,
         case
           -- De teller is leidend: iRacing verhoogt TireSetsUsed alleen bij een
           -- echte nieuwe set.
           when b.tyre_set is not null
                and b.vorige_set is not null
                and b.tyre_set <> b.vorige_set then true
           -- Geen tellerhistorie vóór deze rij: wear die omhoog springt kan
           -- alleen van een nieuwe set komen. 0,5 pp marge tegen ruis.
           when b.vorige_set is null
                and b.wear_max is not null
                and b.vorige_wear_max is not null
                and b.wear_max > b.vorige_wear_max + 0.5 then true
           else false
         end as nieuwe_set
    from basis b
),
genummerd as (
  select g.*,
         1 + sum(case when g.nieuwe_set then 1 else 0 end) over w as set_volgnr
    from grens g
  window w as (partition by g.device_id, g.session_key
               order by g.lap_number, g.captured_at
               rows between unbounded preceding and current row)
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
         -- Per hoek de eigen eerste en laatste meetronde: de noemer van die hoek.
         min(b.lap_number) filter (where b.wear_fl is not null) as fl_van_lap,
         max(b.lap_number) filter (where b.wear_fl is not null) as fl_tot_lap,
         min(b.lap_number) filter (where b.wear_fr is not null) as fr_van_lap,
         max(b.lap_number) filter (where b.wear_fr is not null) as fr_tot_lap,
         min(b.lap_number) filter (where b.wear_rl is not null) as rl_van_lap,
         max(b.lap_number) filter (where b.wear_rl is not null) as rl_tot_lap,
         min(b.lap_number) filter (where b.wear_rr is not null) as rr_van_lap,
         max(b.lap_number) filter (where b.wear_rr is not null) as rr_tot_lap,
         (array_agg(b.wear_fl order by b.lap_number, b.captured_at)
            filter (where b.wear_fl is not null))[1]         as wear_begin_fl,
         (array_agg(b.wear_fr order by b.lap_number, b.captured_at)
            filter (where b.wear_fr is not null))[1]         as wear_begin_fr,
         (array_agg(b.wear_rl order by b.lap_number, b.captured_at)
            filter (where b.wear_rl is not null))[1]         as wear_begin_rl,
         (array_agg(b.wear_rr order by b.lap_number, b.captured_at)
            filter (where b.wear_rr is not null))[1]         as wear_begin_rr,
         (array_agg(b.wear_fl order by b.lap_number desc, b.captured_at desc)
            filter (where b.wear_fl is not null))[1]         as wear_end_fl,
         (array_agg(b.wear_fr order by b.lap_number desc, b.captured_at desc)
            filter (where b.wear_fr is not null))[1]         as wear_end_fr,
         (array_agg(b.wear_rl order by b.lap_number desc, b.captured_at desc)
            filter (where b.wear_rl is not null))[1]         as wear_end_rl,
         (array_agg(b.wear_rr order by b.lap_number desc, b.captured_at desc)
            filter (where b.wear_rr is not null))[1]         as wear_end_rr,
         round(avg(b.track_temp_c), 2)                        as track_temp_c,
         (array_agg(b.car_key order by b.lap_number desc, b.captured_at desc)
            filter (where b.car_key is not null))[1]         as car_key,
         (array_agg(b.track_key order by b.lap_number desc, b.captured_at desc)
            filter (where b.track_key is not null))[1]       as track_key,
         max(b.captured_at)                                   as laatste_meting
    from genummerd b
   group by b.device_id, b.session_key, b.set_volgnr
),
met_span as (
  select b.*,
         -- Rondes tussen de eerste en de laatste wear-meting van de stint.
         case when b.wear_van_lap is not null and b.wear_tot_lap is not null
              then b.wear_tot_lap - b.wear_van_lap end       as wear_span,
         case when b.fl_van_lap is not null then b.fl_tot_lap - b.fl_van_lap end as wear_span_fl,
         case when b.fr_van_lap is not null then b.fr_tot_lap - b.fr_van_lap end as wear_span_fr,
         case when b.rl_van_lap is not null then b.rl_tot_lap - b.rl_van_lap end as wear_span_rl,
         case when b.rr_van_lap is not null then b.rr_tot_lap - b.rr_van_lap end as wear_span_rr
    from blok b
),
met_helling as (
  select m.*,
         -- Helling per hoek over die hoek se eigen span. NULL zonder twee
         -- metingen, zonder minstens één ronde ertussen, of als de wear steeg.
         case when m.wear_span_fl >= 1 and m.wear_end_fl <= m.wear_begin_fl
              then round((m.wear_end_fl - m.wear_begin_fl) / m.wear_span_fl, 4) end as wear_per_lap_fl,
         case when m.wear_span_fr >= 1 and m.wear_end_fr <= m.wear_begin_fr
              then round((m.wear_end_fr - m.wear_begin_fr) / m.wear_span_fr, 4) end as wear_per_lap_fr,
         case when m.wear_span_rl >= 1 and m.wear_end_rl <= m.wear_begin_rl
              then round((m.wear_end_rl - m.wear_begin_rl) / m.wear_span_rl, 4) end as wear_per_lap_rl,
         case when m.wear_span_rr >= 1 and m.wear_end_rr <= m.wear_begin_rr
              then round((m.wear_end_rr - m.wear_begin_rr) / m.wear_span_rr, 4) end as wear_per_lap_rr
    from met_span m
)
select h.device_id,
       h.session_key,
       coalesce(h.set_payload, h.set_volgnr)      as set_number,
       case when h.set_metingen = 0 then 'afgeleid' else 'payload' end as set_bron,
       h.lap_from,
       h.lap_to,
       h.rondes,
       h.wear_span,
       h.wear_metingen,
       h.wear_begin_fl, h.wear_begin_fr, h.wear_begin_rl, h.wear_begin_rr,
       h.wear_end_fl, h.wear_end_fr, h.wear_end_rl, h.wear_end_rr,
       h.wear_per_lap_fl, h.wear_per_lap_fr, h.wear_per_lap_rl, h.wear_per_lap_rr,
       -- Zwakste hoek = steilste helling (meest negatief). Dat is precies de
       -- hoek waarvan pitwall_tyre_estimate_v2 zijn wear_per_lap neemt; de
       -- laagste resterende wear zegt niets over het tempo van slijten.
       case least(h.wear_per_lap_fl, h.wear_per_lap_fr, h.wear_per_lap_rl, h.wear_per_lap_rr)
         when h.wear_per_lap_fl then 'fl'
         when h.wear_per_lap_fr then 'fr'
         when h.wear_per_lap_rl then 'rl'
         when h.wear_per_lap_rr then 'rr'
       end                                        as zwakste_hoek,
       h.track_temp_c,
       h.car_key,
       h.track_key,
       h.laatste_meting,
       h.wear_span_fl,
       h.wear_span_fr,
       h.wear_span_rl,
       h.wear_span_rr,
       (h.wear_per_lap_fl is not null
        or h.wear_per_lap_fr is not null
        or h.wear_per_lap_rl is not null
        or h.wear_per_lap_rr is not null)         as heeft_helling
  from met_helling h;

comment on view public.tyre_stint_deltas is
  'Per apparaat, sessie en opeenvolgende bandenset: rondes, wear begin/eind per hoek, wear_per_lap per hoek over die hoek se eigen span (NULL zonder twee metingen), steilste hoek, gemiddelde baantemperatuur, auto en baan. Niet gegrond aan authenticated; lees via tyre_coverage() of pitwall_tyre_estimate_v2().';
comment on column public.tyre_stint_deltas.set_bron is
  'payload = set_number uit de iRacing-teller TireSetsUsed (tyres.sets.used); afgeleid = bepaald uit een wear-sprong omhoog, omdat er vóór deze rij geen teller was.';
comment on column public.tyre_stint_deltas.wear_span is
  'Rondes tussen de eerste en de laatste wear-meting van de hele stint (welke hoek dan ook).';
comment on column public.tyre_stint_deltas.wear_span_fl is
  'Rondes tussen de eerste en de laatste meting van de linker voorhoek: de noemer van wear_per_lap_fl.';
comment on column public.tyre_stint_deltas.wear_per_lap_fl is
  'Procentpunt wear per ronde over de eigen span van deze hoek, negatief = slijt. NULL als een van beide metingen ontbreekt, de hoek korter dan één ronde meet of de wear steeg.';
comment on column public.tyre_stint_deltas.zwakste_hoek is
  'Hoek met de steilste helling (meest negatieve wear_per_lap); dezelfde hoek die pitwall_tyre_estimate_v2 als wear_per_lap teruggeeft.';
comment on column public.tyre_stint_deltas.heeft_helling is
  'True als minstens één hoek een bruikbare helling heeft. Alleen deze stints tellen mee voor de graad en voor tyre_coverage.wear_labels.';

revoke all on public.tyre_stint_deltas from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Dekkingsoverzicht: graad op wear_labels met helling, niet op count(*)
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
  select v.car_key,
         v.track_key,
         count(*)::bigint as stints,
         -- Een stint telt als label alleen met een gemeten helling; een stint
         -- zonder twee metingen is geen dekking.
         count(*) filter (where v.heeft_helling)::bigint as wear_labels,
         case when count(*) filter (where v.heeft_helling) >= 3 then 'A'
              when count(*) filter (where v.heeft_helling) = 2 then 'B'
              when count(*) filter (where v.heeft_helling) = 1 then 'C'
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
  'Dekking per auto en baan: aantal stints, aantal met een gemeten helling (wear_labels) en graad A (3+), B (2), C (1), D (0) op dat aantal. Alleen eigen of beheerde apparaten.';

revoke all on function public.tyre_coverage(integer) from public, anon;
grant execute on function public.tyre_coverage(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. De schatting voor de pitwall (v2)
-- ---------------------------------------------------------------------------
-- Graad  : A = 3+ stints met een gemeten helling, B = 2, C = 1, D = 0.
-- Getal  : alleen als de beste stint een gemeten helling heeft over minstens
--          drie rondes; wear_per_lap is de helling van de steilste hoek
--          (procentpunt per ronde, positief = slijt).
-- Bereik : resterende wear tot 40 % gedeeld door die helling, met een marge die
--          meegroeit met de graad én met een korte meetbasis: onder acht rondes
--          wordt de band breder, boven acht smaller. usable pas bij acht rondes.
-- Herkomst: measured (eigen helling met teller als setgrens), estimated (helling
--          wel gemeten, maar setgrens afgeleid of auto/baan wijkt af),
--          last_known (alleen een wear-stand), unavailable (geen stint).
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
        v_basis := jsonb_build_object(
            'car_key', v_best.car_key,
            'track_key', v_best.track_key,
            'track_temp_c', v_best.track_temp_c,
            'rondes_in_basis', v_best.wear_span,
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
            v_provenance := 'last_known';
            v_basis := jsonb_build_object(
                'car_key', v_stand.car_key,
                'track_key', v_stand.track_key,
                'track_temp_c', v_stand.track_temp_c,
                'rondes_in_basis', coalesce(v_stand.wear_span, 0),
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
                when v_best.car_key is not null
                 and w.car_key = v_best.car_key
                 and (v_best.track_key is null
                      or w.track_key is null
                      or w.track_key = v_best.track_key) then 0
                else 1
              end,
              w.captured_at desc,
              w.lap_number desc
     limit 1;

    -- Een helling of stand van een andere auto of baan is een schatting, geen
    -- meting voor deze combinatie.
    if v_provenance = 'measured' then
        if (v_ctx_car is not null and v_best.car_key is not null
            and v_ctx_car <> v_best.car_key)
           or (v_ctx_track is not null and v_best.track_key is not null
               and v_ctx_track <> v_best.track_key)
           or (v_wear_car is not null and v_best.car_key is not null
               and v_wear_car <> v_best.car_key)
           or (v_wear_track is not null and v_best.track_key is not null
               and v_wear_track <> v_best.track_key) then
            v_provenance := 'estimated';
        end if;
    end if;

    if v_rate is not null and v_rate > 0 and v_wear_now is not null then
        v_remaining := v_wear_now - v_threshold;
        if v_remaining > 0 then
            v_laps := v_remaining / v_rate;
            -- Basislengte stuurt de breedte: 8 rondes = de nominale marge,
            -- korter wordt breder (tot 4x), langer smaller (tot 0,5x).
            v_span := greatest(coalesce(v_best.wear_span, 0), 1)::numeric;
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
    -- meetbasis is lang genoeg (acht rondes) om de helling boven de ruis uit te
    -- tillen. Voorlopig = dat getal is nog niet bevestigd.
    v_usable := v_rate is not null
                and v_grade in ('A', 'B')
                and coalesce(v_remaining, 0) > 0
                and coalesce(v_best.wear_span, 0) >= v_min_basis
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
  'Stintschatting per apparaat: graad op stints met een gemeten helling, wear_per_lap van de steilste hoek (procentpunt per ronde, positief = slijt), range_laps met een marge die meeschaalt met graad en meetbasis, basis, herkomst en een expliciete voorlopig-vlag. usable pas bij een basis van acht rondes.';

revoke all on function public.pitwall_tyre_estimate_v2(uuid) from public, anon;
grant execute on function public.pitwall_tyre_estimate_v2(uuid) to authenticated;

commit;
