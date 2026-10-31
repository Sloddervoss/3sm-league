-- Rollback voor 20261031120000_tyre_setgrens_bij_wear_stijging.sql
--
-- Zet public.tyre_stint_deltas terug op de definitie van
-- 20261028120000_tyre_stint_model_fixes.sql: de wear-sprong telt dan weer
-- alleen als setgrens wanneer er vóór die rij geen tellerhistorie is
-- (vorige_set is null). Zodra de teller gevuld is — in productie staat hij stil
-- op 1 — plakken setwissels weer aan elkaar.
--
-- De kolommen en hun volgorde zijn in beide versies identiek, dus create or
-- replace volstaat; er hoeft niets gedropt te worden en geen lezer breekt.
-- Opnieuw toepassen van 20261031120000 brengt de fix terug.

begin;

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

commit;
