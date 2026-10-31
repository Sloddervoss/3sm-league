-- ============================================================================
-- Endurance — bandenprior: de pool publiceren achter een wrapper
-- Datum: 2026-10-31
-- Vorige migratie: 20261029120000_tyre_prior_guard_and_contract.sql
--
-- Contractpunt 6 (privacy). Drie dingen veranderen, en ze hangen samen:
--
--   1. authenticated mag public.tyre_prior() niet meer direct uitvoeren. Die
--      functie neemt een apparaat-id aan waarmee de aanroeper zelf kan bepalen
--      wiens stints buiten de pool blijven — en dus kan afleiden wie wat reed.
--      Het recht gaat eraf; de functie blijft bestaan als interne schakel.
--
--   2. Er komt een wrapper public.pitwall_prior_v1(car_key, track_key) zonder
--      exclude-parameter. De wrapper bepaalt zelf het eigen apparaat via
--      auth.uid() en de device-relatie (simhub_devices.owner_user_id) en sluit
--      ALLE apparaten van die gebruiker uit. Niet één: een coureur met twee
--      pc's hoort met geen van beide in de pool te zitten, anders telt zijn
--      eigen data als "andermans" bewijs.
--
--   3. Een cel wordt pas gepubliceerd bij minimaal 2 verschillende accounts én
--      minimaal 2 stints. Anders is de cel geen gedeelde kennis maar de rit van
--      één iemand, en zou de wrapper die als groepscijfer teruggeven. Een cel
--      die niet publiceerbaar is valt weg uit de traps; de traps erboven
--      (auto, circuit, algemeen) blijven werken en de uitvoer meldt thin_pool.
--
-- Waarom de kern in een aparte functie (tyre_prior_core)
-- -----------------------------------------------------
-- De wrapper en pitwall_tyre_estimate_v2 hebben dezelfde rekenregel nodig. De
-- wrapper haalt de uitsluiting uit auth.uid(); v2 kent het apparaat dat hij
-- beschrijft en moet precies dat apparaat uitsluiten — ook als een beheerder
-- voor een ander apparaat kijkt en de aanroeper dus niet de eigenaar is. Twee
-- keer dezelfde query schrijven zou betekenen dat de publicatieregel op twee
-- plekken kan verschillen; daarom één kern met een expliciete lijst van uit te
-- sluiten apparaten, en twee dunne schillen eromheen.
--
-- Wat NIET verandert: de traps (exact -> auto -> circuit -> algemeen), de
-- disjunctie daartussen, w = n/(n+8), de drempel van drie rondes, de uitsluiting
-- van het eigen apparaat en de bestaande sleutels in de uitvoer (rate, n_eff,
-- rondes, stints, level, bron). Nieuw zijn accounts, thin_pool en hoek.
--
-- Waarom accounts een getal is en geen lijst
-- -----------------------------------------
-- `accounts` telt verschillende eigenaren, niet hun namen of id's. Dat is
-- precies genoeg om te kunnen zeggen "dit is door twee mensen gemeten" en te
-- weinig om te weten door wie. De drempel van twee is daarmee ook de grens van
-- wat deze functie over een individu kan prijsgeven: bij één account komt er
-- geen getal naar buiten, ook niet als je de wrapper met andermans auto en baan
-- aanroept.
--
-- De drempel telt NA de uitsluiting, en dat is een bewuste lezing van het
-- contract. Een cel met twee accounts waarvan de aanroeper er één is, houdt na
-- uitsluiting één account over; publiceren zou dan precies de data van die ene
-- ander teruggeven (de aanroeper kent zijn eigen bijdrage). "Minimaal twee
-- accounts" moet dus over de gepubliceerde populatie gaan, niet over de
-- populatie inclusief de vrager.
--
-- Gevolg voor de huidige league (3 apparaten, 2 accounts): deelnemers krijgen
-- geen publiceerbare cel meer en vallen terug op de trap erboven; alleen een
-- derde partij ziet de cel. Zodra er een derde account bij komt, publiceert de
-- cel weer voor iedereen. Dat is de prijs van de regel, niet een fout: met twee
-- mensen is "gedeelde kennis" niet te onderscheiden van "de rit van de ander".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. De kern: de traps, de uitsluiting en de publicatieregel op één plek
-- ---------------------------------------------------------------------------
-- De uitsluiting is ongewijzigd: per cel worden de sommen en tellingen van de
-- opgegeven apparaten eraf getrokken. Dat blijft exact zolang de contributies
-- per stint kloppen (zie tyre_prior_sync_session), en het houdt de drempel van
-- drie rondes op de juiste populatie: een cel die na aftrek nul rondes overhoudt
-- doet niet mee in plaats van "bijna leeg" te blijven.
--
-- Nieuw is de publicatiepoort. Die staat NA de aftrek: een cel met twee accounts
-- waarvan er één de aanroeper is, houdt één account over en wordt niet
-- gepubliceerd. Dat is de bedoeling — anders zou de aanroeper zijn eigen bijdrage
-- als bevestiging van een ander kunnen lezen.
--
-- `hoek` in de uitvoer is de hoek waar de helling vandaan komt. v2 heeft die
-- nodig om de spreiding tussen stints over dezelfde hoek te meten; zonder dat
-- getal zou de band van hoek kunnen wisselen zonder dat iemand het ziet.
create or replace function public.tyre_prior_core(
  p_car_key text,
  p_track_key text,
  p_exclude_devices uuid[] default '{}'::uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_k          constant numeric := 8;
  v_min        constant integer := 3;   -- rondes per trap
  v_min_stints constant integer := 2;   -- stints per cel om te publiceren
  v_min_accounts constant integer := 2; -- accounts per cel om te publiceren
  v_weg        uuid[] := coalesce(p_exclude_devices, '{}'::uuid[]);
  v_traps      jsonb;
  v_rate       numeric;
  v_n_eff      numeric := 0;
  v_rondes     integer := 0;
  v_stints     integer := 0;
  v_eigenaren  uuid[] := '{}'::uuid[];
  v_niveau     text;
  v_trap       text;
  v_bron       text[] := '{}';
  v_w          numeric;
  v_deel       jsonb;
  v_onderdrukt integer;
  v_cel_publiek boolean := false;
  v_cel_aanwezig boolean := false;
begin
  -- Per cel: de sommen van tyre_prior_stats, de eigen bijdragen eraf, en de
  -- eigenaren van wat overblijft. De eigenaren komen uit de contributies en niet
  -- uit de somtabel: alleen daar is bekend welk apparaat welke stint bijdroeg.
  with eigen as (
    select c.car_key,
           c.track_key,
           count(*)::integer              as stints,
           sum(c.rondes)::integer         as rondes,
           sum(c.sum_wear_fl)             as w_fl, sum(c.rondes_fl)::integer as n_fl,
           sum(c.sum_wear_fr)             as w_fr, sum(c.rondes_fr)::integer as n_fr,
           sum(c.sum_wear_rl)             as w_rl, sum(c.rondes_rl)::integer as n_rl,
           sum(c.sum_wear_rr)             as w_rr, sum(c.rondes_rr)::integer as n_rr
      from public.tyre_prior_contrib c
     where c.device_id = any(v_weg)
     group by c.car_key, c.track_key
  ),
  cel as (
    select s.car_key,
           s.track_key,
           s.stints - coalesce(e.stints, 0)   as stints,
           s.rondes - coalesce(e.rondes, 0)   as rondes,
           s.sum_wear_fl - coalesce(e.w_fl, 0) as w_fl,
           s.rondes_fl - coalesce(e.n_fl, 0)   as n_fl,
           s.sum_wear_fr - coalesce(e.w_fr, 0) as w_fr,
           s.rondes_fr - coalesce(e.n_fr, 0)   as n_fr,
           s.sum_wear_rl - coalesce(e.w_rl, 0) as w_rl,
           s.rondes_rl - coalesce(e.n_rl, 0)   as n_rl,
           s.sum_wear_rr - coalesce(e.w_rr, 0) as w_rr,
           s.rondes_rr - coalesce(e.n_rr, 0)   as n_rr,
           -- Wie zaten er in deze cel? Alleen de eigenaren van apparaten die
           -- na uitsluiting overblijven. Een apparaat zonder eigenaar telt niet
           -- mee: een onbekende is geen tweede account.
           (select coalesce(array_agg(distinct d.owner_user_id), '{}'::uuid[])
              from public.tyre_prior_contrib c2
              join public.simhub_devices d on d.id = c2.device_id
             where c2.car_key = s.car_key
               and c2.track_key = s.track_key
               and not (c2.device_id = any(v_weg))
               and d.owner_user_id is not null) as eigenaren
      from public.tyre_prior_stats s
      left join eigen e on e.car_key = s.car_key and e.track_key = s.track_key
  ),
  publiek as (
    select * from cel
     where stints >= v_min_stints
       and cardinality(eigenaren) >= v_min_accounts
  ),
  -- De vier disjuncte traps, ongewijzigd ten opzichte van 20261029120000. Ze
  -- lezen nu uit `publiek`, dus een niet-publiceerbare cel doet nergens mee.
  trap_cel as (
    select 'exact'::text as trap, p.*
      from publiek p
     where p_car_key is not null and p_track_key is not null
       and p.car_key = p_car_key and p.track_key = p_track_key
    union all
    select 'auto'::text, p.*
      from publiek p
     where p_car_key is not null
       and p.car_key = p_car_key
       and (p_track_key is null or p.track_key <> p_track_key)
    union all
    select 'circuit'::text, p.*
      from publiek p
     where p_track_key is not null
       and p.track_key = p_track_key
       and (p_car_key is null or p.car_key <> p_car_key)
    union all
    select 'algemeen'::text, p.*
      from publiek p
     where (p_car_key is null or p.car_key <> p_car_key)
       and (p_track_key is null or p.track_key <> p_track_key)
  ),
  total as (
    select t.trap,
           sum(t.stints)::integer as stints,
           sum(t.rondes)::integer as rondes,
           sum(t.w_fl) as w_fl, sum(t.n_fl)::integer as n_fl,
           sum(t.w_fr) as w_fr, sum(t.n_fr)::integer as n_fr,
           sum(t.w_rl) as w_rl, sum(t.n_rl)::integer as n_rl,
           sum(t.w_rr) as w_rr, sum(t.n_rr)::integer as n_rr,
           array_agg(t.eigenaren)   as cel_eigenaren
      from trap_cel t
     group by t.trap
  ),
  -- array_agg over een uuid[] houdt de dimensie (een trap met twee cellen wordt
  -- een tweedimensionale array). unnest() vlakt die af, en distinct maakt er één
  -- lijst van: iemand die in twee cellen van dezelfde trap zit, telt één keer.
  total2 as (
    select t.trap, t.stints, t.rondes,
           t.w_fl, t.n_fl, t.w_fr, t.n_fr, t.w_rl, t.n_rl, t.w_rr, t.n_rr,
           (select coalesce(array_agg(distinct o), '{}'::uuid[])
              from unnest(t.cel_eigenaren) as o) as eigenaren
      from total t
  ),
  hoek as (
    select t.trap, t.stints, t.rondes, t.eigenaren, h.hoek, h.rate, h.n
      from total2 t
      cross join lateral (
        select x.hoek, x.wear / x.rondes as rate, x.rondes as n
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
  -- De drie uitkomsten in één statement, want de CTE's leven alleen binnen dit
  -- statement. De scalar-subqueries verwijzen naar `publiek` en `cel` en niet
  -- naar gegroepeerde kolommen, dus ze mogen naast de aggregate staan.
  select coalesce(jsonb_object_agg(
           h.trap,
           jsonb_build_object('rate', h.rate, 'n', h.n,
                              'stints', h.stints, 'rondes', h.rondes,
                              'hoek', h.hoek, 'eigenaren', to_jsonb(h.eigenaren))), '{}'::jsonb),
         -- Is de gevraagde cel publiceerbaar? v2 gebruikt dat om te beslissen of
         -- de spreiding over andermans stints mag worden gebruikt of alleen de
         -- eigen metingen.
         exists (
           select 1 from publiek p
            where p_car_key is not null and p_track_key is not null
              and p.car_key = p_car_key and p.track_key = p_track_key
         ),
         -- Is de gevraagde combinatie überhaupt gemeten (na uitsluiting)? Dan
         -- zegt thin_pool of die meting te dun was om te publiceren.
         exists (
           select 1 from cel c
            where p_car_key is not null and p_track_key is not null
              and c.car_key = p_car_key and c.track_key = p_track_key
              and c.stints > 0
         ),
         -- Diagnostiek: hoeveel cellen in de hele pool zijn onderdrukt? Niet
         -- hetzelfde als thin_pool, want een onderdrukte cel ver weg zegt niets
         -- over de bruikbaarheid van déze vraag.
         (select count(*) from cel c
           where not (c.stints >= v_min_stints
                      and cardinality(c.eigenaren) >= v_min_accounts))
    into v_traps, v_cel_publiek, v_cel_aanwezig, v_onderdrukt
    from hoek h;

  -- Van grof naar fijn. Een trap zonder data laat de lopende waarde staan.
  v_deel := v_traps->'algemeen';
  if v_deel is not null then
    v_rate := (v_deel->>'rate')::numeric;
    v_w := (v_deel->>'n')::numeric / ((v_deel->>'n')::numeric + v_k);
    v_n_eff := v_n_eff + v_w * (v_deel->>'n')::numeric;
    v_rondes := v_rondes + (v_deel->>'n')::integer;
    v_stints := v_stints + (v_deel->>'stints')::integer;
    v_eigenaren := v_eigenaren || coalesce(
      (select array_agg((x)::uuid) from jsonb_array_elements_text(v_deel->'eigenaren') as x), '{}'::uuid[]);
    v_niveau := 'algemeen';
    v_bron := v_bron || format('alle auto''s en circuits: %s stints, %s rondes (stints van andere apparaten)',
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
    v_rondes := v_rondes + (v_deel->>'n')::integer;
    v_stints := v_stints + (v_deel->>'stints')::integer;
    v_eigenaren := v_eigenaren || coalesce(
      (select array_agg((x)::uuid) from jsonb_array_elements_text(v_deel->'eigenaren') as x), '{}'::uuid[]);
    v_niveau := v_trap;
    v_bron := v_bron || format('%s: %s stints, %s rondes (stints van andere apparaten)',
                               case v_trap when 'circuit' then 'andere auto''s op dit circuit'
                                           when 'auto'    then 'deze auto op andere circuits'
                                           else 'deze auto op dit circuit' end,
                               v_deel->>'stints', v_deel->>'rondes');
  end loop;

  return jsonb_build_object(
    'rate',     case when v_rate is null then null else round(v_rate, 4) end,
    'n_eff',    round(coalesce(v_n_eff, 0), 2),
    'rondes',   v_rondes,
    'stints',   v_stints,
    'accounts', (select count(distinct x) from unnest(v_eigenaren) as x),
    'level',    v_niveau,
    'hoek',     case when v_niveau is null then null else v_traps->v_niveau->>'hoek' end,
    'publicatie', v_cel_publiek,
    'thin_pool', v_cel_aanwezig and not v_cel_publiek,
    'thin_pool_cellen', coalesce(v_onderdrukt, 0),
    'bron',     case when v_rate is null then 'nog geen gedeelde stints voor deze combinatie'
                     else array_to_string(v_bron, ' · ') end
  );
end;
$$;

comment on function public.tyre_prior_core(text, text, uuid[]) is
  'Interne kern van de bandenprior: vier disjuncte traps (exact, auto, circuit, algemeen), w = n/(n+8) op rondes, de opgegeven apparaten (p_exclude_devices) bij de bron uitgesloten en een cel pas gepubliceerd bij minimaal 2 accounts en 2 stints. Geeft rate, n_eff, rondes, stints, accounts (verschillende eigenaren over de traps die het getal dragen), level, hoek (de hoek van de helling), publicatie (is de gevraagde cel publiceerbaar), thin_pool (de gevraagde cel is gemeten maar niet gepubliceerd), thin_pool_cellen (diagnostiek) en bron. Nooit een apparaat, sessie of naam.';

revoke all on function public.tyre_prior_core(text, text, uuid[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. De wrapper: het eigen apparaat komt uit auth.uid(), niet uit een argument
-- ---------------------------------------------------------------------------
-- Waarom de wrapper geen p_exclude_device aanneemt: een parameter die de
-- uitsluiting bepaalt is een parameter die je kunt kiezen. Wie hem op een ander
-- apparaat zet, ziet de pool inclusief de eigen stint en kan met twee aanroepen
-- het verschil herleiden. De wrapper kent maar één bron voor de uitsluiting:
-- de gebruiker achter het token.
--
-- Waarom alle apparaten van die gebruiker: een coureur met een test-pc en een
-- race-pc is één persoon. Alleen het "hoofdapparaat" uitsluiten zou de eigen
-- data van de tweede pc als andermans bewijs laten meetellen — en dat is precies
-- de dubbeltelling die 20261029120000 repareerde, maar dan via een andere deur.
create or replace function public.pitwall_prior_v1(p_car_key text, p_track_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_eigen  uuid[];
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select coalesce(array_agg(d.id), '{}'::uuid[])
    into v_eigen
    from public.simhub_devices d
   where d.owner_user_id = v_user;

  return public.tyre_prior_core(p_car_key, p_track_key, v_eigen);
end;
$$;

comment on function public.pitwall_prior_v1(text, text) is
  'Bandenvoorprior voor de pitwall: dezelfde traps en publicatieregel als tyre_prior_core, maar het eigen apparaat (alle apparaten van auth.uid()) wordt zonder parameter uitgesloten. Een cel wordt pas gepubliceerd bij minimaal 2 accounts en 2 stints; anders valt de functie terug op de trap erboven en staat thin_pool op true.';

revoke all on function public.pitwall_prior_v1(text, text) from public, anon;
grant execute on function public.pitwall_prior_v1(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. De oude deur dicht
-- ---------------------------------------------------------------------------
-- tyre_prior(text, text, uuid) blijft bestaan: tyre_prior_core en de oude
-- aanroepers binnen de database gebruiken hem niet meer, maar een rollback en
-- een beheerder-psql wel. Wat weg moet is het recht van een clientrol om zelf
-- een apparaat mee te geven.
revoke all on function public.tyre_prior(text, text, uuid) from public, anon, authenticated, service_role;

-- En de tweeargumentversie uit de allereerste versie: die naam bestaat niet meer
-- sinds 20261029120000, maar een grant op een niet-bestaande functie is een
-- stille verrassing als iemand hem later terugzet. De revoke is daarom
-- voorwaardelijk.
do $$
begin
  if to_regprocedure('public.tyre_prior(text, text)') is not null then
    execute 'revoke all on function public.tyre_prior(text, text) from public, anon, authenticated, service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Controle: de deur is dicht en de wrapper is de enige ingang
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.tyre_prior(text, text, uuid)', 'EXECUTE') then
    raise exception 'authenticated kan tyre_prior(text, text, uuid) nog uitvoeren';
  end if;
  if has_function_privilege('anon', 'public.tyre_prior(text, text, uuid)', 'EXECUTE') then
    raise exception 'anon kan tyre_prior(text, text, uuid) nog uitvoeren';
  end if;
  if has_function_privilege('authenticated', 'public.tyre_prior_core(text, text, uuid[])', 'EXECUTE') then
    raise exception 'authenticated kan tyre_prior_core() uitvoeren';
  end if;
  if not has_function_privilege('authenticated', 'public.pitwall_prior_v1(text, text)', 'EXECUTE') then
    raise exception 'authenticated kan pitwall_prior_v1() niet uitvoeren';
  end if;
end $$;

commit;
