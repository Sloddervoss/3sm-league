-- ============================================================================
-- Endurance — band om dezelfde schatter, prior_n als Kish-maat
-- Datum: 2026-10-31
-- Vorige migratie: 20261031150100_tyre_kish_n_eff.sql
--
-- Repareert reviewpunt 2.2b (HOOG): de band lag om een andere schatter dan
-- de gerapporteerde rate, en de prior hield zijn oude som van w x rondes.
--
-- Voorheen was wear_per_lap een blend van de laatste eigen stint met de prior
-- (w = n/(n+8)), maar kwam de band uit 1/som(w_i) over alle geselecteerde
-- stints: de onzekerheid van een inverse-variantiegewogen gemiddelde dat
-- nergens gerapporteerd werd. Puntschatting en onzekerheid gingen dus over
-- verschillende schatters. Bovendien was prior_n = som(w_trap x rondes): voor
-- CAT-PC 179,33 uit twintig stints.
--
-- Nu:
--   * De band ligt om v_rate zelf, met dezelfde blendgewichten:
--     sigma^2 = w^2 * (tau^2 + meetruis) + (1-w)^2 * (tau^2 / priorstints).
--     tau^2 is de gemeten spreiding tussen stints op de combinatie; zonder
--     twee stints is er geen band en blijft range_laps null.
--   * De band heet in de uitvoer wat hij is: een modelmarge (basis.band.soort),
--     geen gekalibreerd voorspellingsinterval. Met twee stints rust tau^2 op
--     één vrijheidsgraad; dat is te weinig voor een betrouwbaarheidsclaim.
--   * prior_n is de Kish-maat over de stintgewichten per trap, gecombineerd
--     over de traps: (som a)^2/som a^2 met a_t = w_t * kish_t. Twintig
--     gelijkwaardige stints geven ongeveer 20, niet 179.
-- ============================================================================

begin;

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
                      and cardinality(c.eigenaren) >= v_min_accounts)),
         -- n_eff als Kish-maat over de stintgewichten: a_s = w_trap *
         -- rondes_s voor elke stint, en n_eff = (som a)^2/som a^2. Zo is
         -- prior_n een effectieve meetbasis (bij gelijke stints ongeveer het
         -- aantal stints) en niet langer de som van w x rondes, die met
         -- twintig stints 179,33 kon worden.
         (select case when sum(power(z.a, 2)) > 0
                      then power(sum(z.a), 2) / sum(power(z.a, 2)) end
            from (
              -- Eén rij per stint, met het gewicht van de trap waarin hij
              -- valt. Zo telt elke stint één keer mee en is de uitkomst bij
              -- gelijke stints ongeveer hun aantal.
              select (h2.n::numeric / (h2.n::numeric + v_k)) * sc.rondes::numeric as a
                from hoek h2
                join trap_cel u on u.trap = h2.trap
                join public.tyre_prior_contrib sc
                  on sc.car_key is not distinct from u.car_key
                 and sc.track_key is not distinct from u.track_key
                 and not (sc.device_id = any(v_weg))
            ) z)
    into v_traps, v_cel_publiek, v_cel_aanwezig, v_onderdrukt, v_n_eff
    from hoek h;

  -- Van grof naar fijn. Een trap zonder data laat de lopende waarde staan.
  v_deel := v_traps->'algemeen';
  if v_deel is not null then
    v_rate := (v_deel->>'rate')::numeric;
    v_w := (v_deel->>'n')::numeric / ((v_deel->>'n')::numeric + v_k);
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
  'Interne kern van de bandenprior: vier disjuncte traps (exact, auto, circuit, algemeen), w = n/(n+8) op rondes, de opgegeven apparaten (p_exclude_devices) bij de bron uitgesloten en een cel pas gepubliceerd bij minimaal 2 accounts en 2 stints. n_eff is de Kish-maat over de stintgewichten per trap ((som a)^2/som a^2). Geeft rate, n_eff, rondes, stints, accounts (verschillende eigenaren over de traps die het getal dragen), level, hoek (de hoek van de helling), publicatie (is de gevraagde cel publiceerbaar), thin_pool (de gevraagde cel is gemeten maar niet gepubliceerd), thin_pool_cellen (diagnostiek) en bron. Nooit een apparaat, sessie of naam.';

revoke all on function public.tyre_prior_core(text, text, uuid[]) from public, anon, authenticated, service_role;

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

    -- Actuele context en de ene wear-bron
    v_ctx_sess   text;          -- sessie van het nieuwste telemetrieframe
    v_ctx_lap    integer;       -- laatste ronde in die sessie (uit de samples)
    v_wear_sess  text;
    v_wear_lap   integer;
    v_wear_at    timestamptz;
    v_wear_set   bigint;
    v_huidige    public.tyre_stint_deltas%rowtype;
    v_ouderheid  integer;
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
    v_w_eigen    numeric := 0;
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

    -- Uitsluiting: de apparaten die niet in de pool mogen meetellen
    v_owner      uuid;
    v_exclude    uuid[];

    -- Band en effectieve basis
    v_band_stints integer := 0;
    v_sigma_tot   numeric;      -- onzekerheid van de blend (pp per ronde)
    v_var_est     numeric;      -- variantie van het gewogen gemiddelde
    v_tau2        numeric;      -- gemeten spreiding tussen stints (pp^2)
    v_var_own     numeric;
    v_var_prior   numeric;
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
    -- var_i en in de meetonzekerheid van de eigen helling.
    v_lees       constant numeric := 0.0005;
    -- Eén standaardafwijking op de modelmarge. Geen vaste factor op de
    -- bandbreedte, maar de schaal waarop een meting normaal varieert.
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

    select count(*) into v_stints_totaal
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id;

    --------------------------------------------------------------------------
    -- Huidige context: het nieuwste telemetrieframe, niet de rondesamples
    --------------------------------------------------------------------------
    -- De samples lopen één ronde achter op de auto: een nieuwe transportsessie
    -- staat daar pas in als de eerste ronde is geflusht. De pitwall vraagt zijn
    -- advies echter al bij de eerste meters. De auto, de baan en de sessie
    -- komen daarom uit simhub_telemetry_latest, met dezelfde normalisatie als
    -- de ingest (tyre_car_key/tyre_track_key), zodat de sleutels identiek zijn
    -- aan die in simhub_tyre_lap_samples en tyre_stint_deltas.
    select t.session_id,
           public.tyre_car_key(
             coalesce(nullif(btrim(coalesce(t.v3_normalized#>>'{identity,carId}', '')), ''), t.car_id),
             coalesce(nullif(btrim(coalesce(t.v3_normalized#>>'{identity,carName}', '')), ''), t.car_name)),
           public.tyre_track_key(
             t.v3_normalized#>>'{identity,trackId}',
             coalesce(nullif(btrim(coalesce(t.v3_normalized#>>'{identity,trackName}', '')), ''), t.track_name),
             coalesce(nullif(btrim(coalesce(t.v3_normalized#>>'{identity,trackConfig}', '')), ''), t.track_config))
      into v_ctx_sess, v_ctx_car, v_ctx_track
      from public.simhub_telemetry_latest t
     where t.device_id = p_device_id;

    -- Beste stint: de meest recente met een gemeten helling over minstens drie
    -- rondes; bij gelijke tijd de langste. Deze stint bepaalt de GEBRUIKTE
    -- COMBINATIE (auto + baan) en de eigen helling. Een helling van precies nul
    -- is geen meting van slijtage maar een ronde waarin de wear-teller niet
    -- verschoof; zo'n stint mag de schatting niet dragen (zero_slope).
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

    --------------------------------------------------------------------------
    -- De ene wear-bron: één rij, voor de berekening én voor de poort
    --------------------------------------------------------------------------
    -- Voorheen werden hier twee verschillende rijen gekozen: de berekening nam
    -- de nieuwste meting die bij de historische basis past, de actualiteits-
    -- poort nam onafhankelijk de nieuwste meting van het apparaat (met een
    -- andere hoek: greatest in plaats van least). Een verse meting kon zo een
    -- oude stand legitimeren. Nu is er één rij: de nieuwste echte wear-meting
    -- van dit apparaat, met sessie, ronde, tijd, set en auto/baan erbij. Die
    -- rij is zowel wear_now als het bewijs dat de stand actueel is.
    select s.session_key, s.lap_number, s.captured_at, s.tyre_set,
           least(nullif(s.wear_fl, 'NaN'::numeric),
                 nullif(s.wear_fr, 'NaN'::numeric),
                 nullif(s.wear_rl, 'NaN'::numeric),
                 nullif(s.wear_rr, 'NaN'::numeric)),
           s.car_key, s.track_key
      into v_wear_sess, v_wear_lap, v_wear_at, v_wear_set, v_wear_now,
           v_wear_car, v_wear_track
      from public.simhub_tyre_lap_samples s
     where s.device_id = p_device_id
       and least(nullif(s.wear_fl, 'NaN'::numeric),
                 nullif(s.wear_fr, 'NaN'::numeric),
                 nullif(s.wear_rl, 'NaN'::numeric),
                 nullif(s.wear_rr, 'NaN'::numeric)) is not null
     order by s.captured_at desc, s.lap_number desc
     limit 1;

    -- Een helling of stand van een andere auto of baan dan de huidige context
    -- is geen advies over deze auto op deze baan. De controle staat LOS van de
    -- provenance: ook een al afgeleide grens (provenance = estimated) kan uit
    -- een andere combinatie komen en werd voorheen overgeslagen.
    if (v_ctx_car is not null and v_basis_car is not null
        and v_ctx_car <> v_basis_car)
       or (v_ctx_track is not null and v_basis_track is not null
           and v_ctx_track <> v_basis_track)
       or (v_ctx_car is not null and v_wear_car is not null
           and v_ctx_car <> v_wear_car)
       or (v_ctx_track is not null and v_wear_track is not null
           and v_ctx_track <> v_wear_track) then
        v_context_mismatch := true;
        v_provenance := 'estimated';
    end if;

    --------------------------------------------------------------------------
    -- Actualiteit van precies die rij
    --------------------------------------------------------------------------
    -- Het laatste frame in de HUIDIGE sessie (uit de samples): de ronde die nu
    -- loopt. Zonder samples in deze sessie is er nog geen set bekend.
    select s.lap_number
      into v_ctx_lap
      from public.simhub_tyre_lap_samples s
     where s.device_id = p_device_id
       and s.session_key = v_ctx_sess
     order by s.captured_at desc, s.lap_number desc
     limit 1;

    -- De stint (set) die nu onder de auto zit: die van dat laatste frame.
    select * into v_huidige
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id
       and v.session_key = v_ctx_sess
       and v.lap_from <= v_ctx_lap
       and v.lap_to   >= v_ctx_lap
     order by v.lap_from desc
     limit 1;

    if v_wear_at is not null then
        v_ouderheid := greatest(
            floor(extract(epoch from (now() - v_wear_at)) / 60)::integer, 0);
    end if;

    v_sessie_match := v_wear_at is not null
                      and v_ctx_sess is not null
                      and v_wear_sess = v_ctx_sess;

    -- De meting hoort bij de huidige set als hij in de stint valt die nu loopt.
    -- Een meting van de vorige set valt in een andere stint en is dus een
    -- historische stand, ook als hij een minuut oud is.
    v_set_match := v_sessie_match
                   and v_huidige.set_number is not null
                   and v_wear_lap between v_huidige.lap_from and v_huidige.lap_to;

    v_vers := v_ouderheid is not null
              and v_ouderheid <= v_vers_min
              and v_sessie_match
              and v_set_match;

    --------------------------------------------------------------------------
    -- De graad: alleen eigen stints op precies deze combinatie
    --------------------------------------------------------------------------
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

    -- Een verouderde stand of een andere combinatie is geen advies over de
    -- banden die er nu op liggen. De graad blijft staan (hij gaat over de
    -- metingen), maar niet hoger dan C.
    if (not v_vers or v_context_mismatch) and v_grade in ('A', 'B') then
        v_grade := 'C';
    end if;

    --------------------------------------------------------------------------
    -- De prior: de pool zonder de eigen apparaten, met de publicatieregel
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

    -- Alleen het gevraagde apparaat blijft buiten de pool. Dit is de situatie
    -- vóór 20261031150300; de kern is dezelfde, de uitsluitlijst nog niet.
    v_exclude := array[p_device_id]::uuid[];
    v_prior := public.tyre_prior_core(v_prior_car, v_prior_track, v_exclude);
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
    -- w = n/(n+8). Zonder prior is w_eigen 1; zonder eigen stint is de prior
    -- het getal en heet de bron exact/auto/circuit/algemeen.
    if v_own_rate is not null and v_own_rate > 0 then
        v_w_eigen := coalesce(v_own_n, 0)::numeric / (coalesce(v_own_n, 0)::numeric + v_k);
        if v_prior_rate is not null and v_prior_rate > 0 then
            v_rate := v_w_eigen * v_own_rate + (1 - v_w_eigen) * v_prior_rate;
        else
            v_rate := v_own_rate;
            v_w_eigen := 1;
        end if;
        v_bron := 'eigen';
    elsif v_prior_rate is not null and v_prior_rate > 0 then
        v_rate := v_prior_rate;
        v_w_eigen := 0;
        v_bron := coalesce(v_prior_level, 'algemeen');
        -- Geen eigen meting: dit getal komt uit de pool, niet uit een stand van
        -- dit apparaat. Ook een wear-stand alleen wordt hier dus 'geschat'.
        v_provenance := 'estimated';
    end if;

    --------------------------------------------------------------------------
    -- De band uit de gemeten spreiding, en n_eff als Kish-maat
    --------------------------------------------------------------------------
    -- De hoek: die van de eigen stint (daar hoort het getal bij). Zonder eigen
    -- helling die van de prior, zodat de spreiding over dezelfde hoek gaat als
    -- het getal dat we doorgeven.
    v_hoek_band := coalesce(v_hoek, v_prior_hoek);

    if v_hoek_band is not null and v_basis_car is not null and v_basis_track is not null then
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
               -- Dezelfde uitsluitpopulatie voor de band als voor de prior: geen
               -- tweede apparaat van dezelfde eigenaar in de spreiding.
               and (v.device_id = p_device_id
                    or (v_prior_publiek and not (v.device_id = any(v_exclude))))
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
            --   * n_eff: Kish over a_i = rondes_i/(tau^2+var_i), ZONDER deling
            --     door rondes_i in de noemer. De uitkomst is de effectieve
            --     meetbasis in eenheden van a_i (bij gelijke stints: het aantal
            --     stints), niet het aantal rondes. Delen door rondes_i maakte
            --     van een concentratiemaat weer een rondetelling (20 in plaats
            --     van 2 voor twee gelijke stints) en dat is de fout die dit
            --     repareert.
            --   * var_est: de variantie van het inverse-variantiegewogen
            --     gemiddelde; die hoort bij de gemiddelde stintsnelheid, niet
            --     bij de blend die we rapporteren. Daarom wordt hij hier niet
            --     meer als band gebruikt; de band komt uit de blend zelf.
            select g.k, g.sd, g.tau2, g.eigen_rondes, g.eigen_stints,
                   sum(power(b.n / (g.tau2 + 2 * power(v_lees, 2) / power(b.n, 2)), 2)) as kish_noemer,
                   sum(b.n / (g.tau2 + 2 * power(v_lees, 2) / power(b.n, 2))) as kish_teller
              from gewicht g
              join bruikbaar b on true
             group by g.k, g.sd, g.tau2, g.eigen_rondes, g.eigen_stints
        )
        select w.k, w.eigen_rondes, w.eigen_stints, w.tau2,
               case when w.kish_noemer > 0 then power(w.kish_teller, 2) / w.kish_noemer end
          into v_band_stints, v_eigen_rondes, v_eigen_stints, v_tau2, v_n_eff
          from gew w;
    end if;


    -- Meetonzekerheid van de eigen helling: twee lezingen over de eigen basis.
    v_u_meet := case when coalesce(v_own_n, 0) > 0
                     then sqrt(2 * power(v_lees, 2)) / v_own_n end;

    if v_rate is not null and v_rate > 0 and v_wear_now is not null then
        v_remaining := v_wear_now - v_threshold;
        if v_remaining > 0 then
            v_laps := v_remaining / v_rate;

            if v_vers
               and not v_context_mismatch
               and v_band_stints >= 2
               and v_tau2 is not null
               and v_sigma_tot is null then
                -- De band ligt om DEZELFDE schatter als wear_per_lap: v_rate,
                -- de blend van de eigen stint met de prior. De breedte komt
                -- uit de onzekerheid van die twee componenten, gewogen met
                -- dezelfde gewichten als de blend zelf:
                --
                --   var(eigen)  = tau^2 + meetruis van de eigen helling
                --   var(gedeeld)= tau^2 / aantal priorstints
                --   sigma^2     = w^2 * var(eigen) + (1-w)^2 * var(gedeeld)
                --
                -- Daarvoor is tau^2 de gemeten spreiding tussen de stints op
                -- deze combinatie nodig; zonder twee stints is er geen band
                -- (range_laps blijft dan null). Met twee stints rust tau^2 op
                -- één vrijheidsgraad: dit is een MODELMARGE, geen gekalibreerd
                -- voorspellingsinterval voor de volgende stint. Zo wordt het
                -- ook aan de client gemeld (basis.band.soort).
                v_var_own   := v_tau2 + power(coalesce(v_u_meet, 0), 2);
                v_var_prior := v_tau2 / greatest(coalesce(v_prior_stints, 1), 1);
                v_sigma_tot := sqrt(power(coalesce(v_w_eigen, 0), 2) * v_var_own
                                    + power(1 - coalesce(v_w_eigen, 0), 2) * v_var_prior);
                v_rate_lo := greatest(v_rate - v_z * v_sigma_tot, 0);
                v_rate_hi := v_rate + v_z * v_sigma_tot;
            end if;

            if v_vers
               and not v_context_mismatch
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
            if v_vers and not v_context_mismatch then
                v_range := jsonb_build_object('low', 0, 'high', 0);
            end if;
        end if;
    end if;

    --------------------------------------------------------------------------
    -- De redenen: waarom het antwoord is zoals het is
    --------------------------------------------------------------------------
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

    -- Bruikbaar = verse stand, dezelfde combinatie, graad A of B, nog wear
    -- over, een meetbasis van minstens acht rondes en een band die echt
    -- gemeten is. Een prior maakt een apparaat niet bruikbaar.
    v_usable := v_vers
                and not v_context_mismatch
                and v_grade in ('A', 'B')
                and coalesce(v_remaining, 0) > 0
                and coalesce(v_span_hoek, 0) >= v_min_basis
                and v_range is not null;
    v_voorlopig := (not v_usable)
                   or v_provenance <> 'measured'
                   or coalesce(v_span_hoek, 0) < v_min_basis
                   or coalesce(v_bron, 'algemeen') <> 'eigen';

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
        -- rondes_effectief blijft bestaan maar is de Kish-maat: de effectieve
        -- meetbasis die de uitkomst draagt, niet de som van gewichten.
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
            'vers', v_vers,
            -- De set van de gebruikte wear-rij, zodat achteraf te zien is welke
            -- meting de poort en de berekening droeg (en niet een andere).
            'set', v_wear_set
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
        -- De band is een modelmarge rond dezelfde schatter als wear_per_lap;
        -- `soort` zegt dat met zoveel woorden zodat niemand hem voor een
        -- gekalibreerd voorspellingsinterval aanziet.
        'band', jsonb_build_object(
            'soort', 'modelmarge',
            'sigma', case when v_sigma_tot is null then null else round(v_sigma_tot, 6) end,
            'stints', coalesce(v_band_stints, 0)
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
  'Stintschatting per apparaat met een adviespoort. De graad telt alleen eigen stints op de gebruikte car_key + track_key (minimaal 3 rondes meetbasis per stint; stints zonder sleutels tellen niet). wear_now, de actualiteit en de berekening komen uit ÉÉN wear-rij: de nieuwste echte meting van dit apparaat, vergeleken met de sessie en de set uit het nieuwste telemetrieframe (simhub_telemetry_latest). Ontbreekt die rij of is hij ouder dan 10 minuten, uit een andere sessie of een andere set, dan is usable false, de graad hooguit C en range_laps null (stale_state). Komt de gebruikte basis of de wear-rij uit een andere auto of baan dan de actuele context, dan blokkeert context_mismatch het advies. range_laps is een modelmarge rond dezelfde rate als wear_per_lap (basis.band.soort = modelmarge), uit de gemeten spreiding tussen stints en de meetruis, en is null zonder twee stints. basis.n_eff/rondes_effectief is de Kish-maat (som a)^2/som a^2 over a_i = rondes_i/(tau^2+var_i); basis.prior_n is dezelfde Kish-maat over de priorstints. basis.gedeeld is de pool zonder alle apparaten van de eigenaar (rate, rondes, stints, accounts), basis.eigen de eigen metingen op deze combinatie.';

revoke all on function public.pitwall_tyre_estimate_v2(uuid) from public, anon;
grant execute on function public.pitwall_tyre_estimate_v2(uuid) to authenticated;
commit;
