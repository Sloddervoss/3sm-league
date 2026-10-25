-- Bandenwissel en bevroren slijtwaarden herkennen (punten 23 en 24).
--
-- Twee problemen uit de race van 24-10:
--
--   23. Een bandenwissel is nergens vastgelegd. De pitwall ziet alleen dat de
--       vier wear_percent-waarden omhoog springen. Bij de stop van 23:56 ging
--       het van 81->89, 85->90, 89->90, 89->91: dat is een tussenstand, geen
--       nieuwe set. Bij 00:22 ging het naar 99,6 -- dat was er wel een, want een
--       nieuwe set leest ongeveer 100.
--   24. Dezelfde waarden stonden zeven rondes lang exact stil (81,3/85,3/88,9/
--       89,2) en sprongen daarna in een keer. Zo'n reeks is geen degradatie van
--       nul: de plugin levert een oude momentopname. Wie die nullen mee middelt
--       komt te laag uit -- dat verklaart het verschil van 0,17 tegen 0,45 per
--       ronde tussen twee rijders.
--
-- Deze migratie legt daarom per meetpunt vast:
--
--   * wear_delta_*    het verschil met de vorige meting, alleen over een
--                     opeenvolgende ronde in dezelfde race-run. Over een
--                     run-grens (apparaatwissel) is er geen vorige meting.
--   * tyre_change_detected
--                     alle vier de hoeken minimaal 3 punten omhoog, en dat
--                     direct na een pitstop. De drempel van 3 punten op alle
--                     vier is wat de tussenstand van 23:56 uitsluit: rechts-
--                     achter ging daar maar 1 punt omhoog.
--   * wear_frozen     vier of meer opeenvolgende rondes met exact dezelfde vier
--                     waarden. Het advies moet die meetpunten negeren: ze zijn
--                     niet gemeten, ze zijn herhaald.
--   * wear_frozen_laps
--                     hoe lang de reeks was, zodat zichtbaar is hoe erg het is.
--
-- Een bandenwissel wordt daarnaast als event vastgelegd (event_type
-- 'tyre_change'), zodat de pitwall een set kan dateren in plaats van te raden.
--
-- De functie is een herberekening over alles wat er voor dat event staat: hij
-- reset eerst de markeringen en loopt dan de metingen opnieuw door. Daardoor is
-- hij idempotent en mag hij elke twee minuten draaien, ook over een race die
-- al afgelopen is. Bestaande tyre_change-events worden niet gedupliceerd.

alter table public.endurance_strategy_lap_samples
  add column if not exists wear_delta_fl numeric(6,2),
  add column if not exists wear_delta_fr numeric(6,2),
  add column if not exists wear_delta_rl numeric(6,2),
  add column if not exists wear_delta_rr numeric(6,2),
  add column if not exists tyre_change_detected boolean not null default false,
  add column if not exists wear_frozen boolean not null default false,
  add column if not exists wear_frozen_laps smallint;

comment on column public.endurance_strategy_lap_samples.tyre_change_detected is
  'Alle vier de hoeken >= 3 punten omhoog na een pitstop: nieuwe set banden.';
comment on column public.endurance_strategy_lap_samples.wear_frozen is
  'Deel van een reeks van >= 4 rondes met exact dezelfde wear-waarden; niet gebruiken als meting.';
comment on column public.endurance_strategy_lap_samples.wear_frozen_laps is
  'Lengte van de bevroren reeks in rondes.';

-- De detector leest per event (en eventueel per team) de metingen op volgorde
-- van ronde. Zonder index wordt dat een seq scan over alle historie.
create index if not exists endurance_strategy_lap_samples_tyre_scan_idx
  on public.endurance_strategy_lap_samples (event_id, team_id, race_run_id, completed_laps)
  where wear_fl is not null and wear_fr is not null
    and wear_rl is not null and wear_rr is not null;

create or replace function public.endurance_detect_tyre_changes(
  p_event_id uuid,
  p_team_id uuid default null
)
returns table (
  team_id uuid,
  metingen integer,
  bevroren integer,
  bandenwissels integer
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  -- Een nieuwe set leest ongeveer 100; een tussenstand of een inhalende
  -- momentopname springt maar een paar punten. Drie punten op alle vier de
  -- hoeken is de kleinste sprong die in de praktijk alleen bij een echte
  -- wissel voorkomt.
  c_min_sprong constant numeric := 3;
  -- Vier rondes exact gelijk is geen degradatie meer maar een herhaalde waarde.
  c_bevroren_reeks constant integer := 4;
begin
  if p_event_id is null then
    raise exception 'p_event_id is verplicht' using errcode = '22023';
  end if;

  -- Herberekening: eerst alles in scope leegmaken. De events zelf blijven
  -- staan; die worden hieronder alleen aangemaakt als ze er nog niet zijn.
  update public.endurance_strategy_lap_samples s
     set wear_delta_fl = null,
         wear_delta_fr = null,
         wear_delta_rl = null,
         wear_delta_rr = null,
         tyre_change_detected = false,
         wear_frozen = false,
         wear_frozen_laps = null
   where s.event_id = p_event_id
     and (p_team_id is null or s.team_id = p_team_id);

  -- (1) Verschil met de vorige meting. Alleen binnen dezelfde race-run en
  -- alleen als de vorige meting precies een ronde eerder is: over een gat of
  -- een run-grens heen is het verschil niet te interpreteren.
  with meting as (
    select s.team_id,
           s.race_run_id,
           s.completed_laps,
           s.wear_fl, s.wear_fr, s.wear_rl, s.wear_rr,
           lag(s.completed_laps) over w as vorige_ronde,
           lag(s.wear_fl) over w as vorige_fl,
           lag(s.wear_fr) over w as vorige_fr,
           lag(s.wear_rl) over w as vorige_rl,
           lag(s.wear_rr) over w as vorige_rr
      from public.endurance_strategy_lap_samples s
     where s.event_id = p_event_id
       and (p_team_id is null or s.team_id = p_team_id)
       and s.wear_fl is not null and s.wear_fr is not null
       and s.wear_rl is not null and s.wear_rr is not null
    window w as (partition by s.team_id, s.race_run_id order by s.completed_laps)
  )
  update public.endurance_strategy_lap_samples t
     set wear_delta_fl = m.wear_fl - m.vorige_fl,
         wear_delta_fr = m.wear_fr - m.vorige_fr,
         wear_delta_rl = m.wear_rl - m.vorige_rl,
         wear_delta_rr = m.wear_rr - m.vorige_rr
    from meting m
   where t.race_run_id is not distinct from m.race_run_id
     and t.completed_laps = m.completed_laps
     and t.event_id = p_event_id
     and m.vorige_ronde = m.completed_laps - 1;

  -- (2) Bevroren reeksen. row_number over alles min row_number over de waarde
  -- geeft een constante per aaneengesloten blok met identieke waarden. Een blok
  -- telt alleen als het uit vier of meer rondes bestaat en de rondenummers
  -- echt opeenvolgend zijn (geen gat waarin een meting ontbreekt).
  with meting as (
    select s.team_id,
           s.race_run_id,
           s.completed_laps,
           s.wear_fl, s.wear_fr, s.wear_rl, s.wear_rr
      from public.endurance_strategy_lap_samples s
     where s.event_id = p_event_id
       and (p_team_id is null or s.team_id = p_team_id)
       and s.wear_fl is not null and s.wear_fr is not null
       and s.wear_rl is not null and s.wear_rr is not null
  ),
  blok as (
    select m.*,
           row_number() over (partition by m.team_id, m.race_run_id order by m.completed_laps)
         - row_number() over (
             partition by m.team_id, m.race_run_id,
                          m.wear_fl, m.wear_fr, m.wear_rl, m.wear_rr
             order by m.completed_laps
           ) as groep
      from meting m
  ),
  reeks as (
    select b.team_id, b.race_run_id, b.groep,
           count(*)::integer as rondes,
           min(b.completed_laps) as eerste,
           max(b.completed_laps) as laatste
      from blok b
     group by b.team_id, b.race_run_id, b.groep
    having count(*) >= c_bevroren_reeks
       and max(b.completed_laps) - min(b.completed_laps) = count(*) - 1
  )
  update public.endurance_strategy_lap_samples t
     set wear_frozen = true,
         wear_frozen_laps = r.rondes::smallint
    from blok b
    join reeks r
      on r.team_id = b.team_id
     and r.race_run_id is not distinct from b.race_run_id
     and r.groep = b.groep
   where t.event_id = p_event_id
     and t.race_run_id is not distinct from b.race_run_id
     and t.completed_laps = b.completed_laps;

  -- (3) Bandenwissel: alle vier de hoeken minstens c_min_sprong omhoog, direct
  -- na een pitstop, en de meting is een echte opeenvolgende ronde.
  --
  -- Een pitstop blijkt uit de lap-sample zelf: de ronde waarin de auto op de
  -- pitstraat zat is gemarkeerd met exclusion_reason 'pit_lane_during_lap', en
  -- bij pit-exit begint een nieuwe fuel_stint. Een van beide is genoeg; de
  -- vorige meting mag het ook zijn, want de wear-waarden kunnen een ronde
  -- later binnenkomen dan de stop.
  --
  -- De insert staat in een data-modifying CTE zodat het event en de markering
  -- op het sample uit dezelfde berekening komen. De CTE wordt altijd
  -- uitgevoerd, ook al leest de update hem niet.
  with meting as (
    select s.team_id,
           s.race_run_id,
           s.completed_laps,
           s.wear_fl, s.wear_fr, s.wear_rl, s.wear_rr,
           s.exclusion_reason,
           s.fuel_stint_id,
           s.source_device_id,
           s.source_session_id,
           s.source_sequence,
           s.captured_at,
           s.wear_frozen,
           lag(s.completed_laps) over w as vorige_ronde,
           lag(s.wear_fl) over w as vorige_fl,
           lag(s.wear_fr) over w as vorige_fr,
           lag(s.wear_rl) over w as vorige_rl,
           lag(s.wear_rr) over w as vorige_rr,
           lag(s.exclusion_reason) over w as vorige_exclusie,
           lag(s.fuel_stint_id) over w as vorige_stint,
           lag(s.wear_frozen) over w as vorige_bevroren
      from public.endurance_strategy_lap_samples s
     where s.event_id = p_event_id
       and (p_team_id is null or s.team_id = p_team_id)
       and s.wear_fl is not null and s.wear_fr is not null
       and s.wear_rl is not null and s.wear_rr is not null
    window w as (partition by s.team_id, s.race_run_id order by s.completed_laps)
  ),
  kandidaat as (
    select m.*,
           (
             m.exclusion_reason = 'pit_lane_during_lap'
             or m.vorige_exclusie = 'pit_lane_during_lap'
             or (
               m.fuel_stint_id is not null
               and m.vorige_stint is not null
               and m.fuel_stint_id <> m.vorige_stint
             )
           ) as na_pitstop
      from meting m
     where m.vorige_ronde = m.completed_laps - 1
       and m.wear_fl - m.vorige_fl >= c_min_sprong
       and m.wear_fr - m.vorige_fr >= c_min_sprong
       and m.wear_rl - m.vorige_rl >= c_min_sprong
       and m.wear_rr - m.vorige_rr >= c_min_sprong
  ),
  gebeurtenis as (
    insert into public.endurance_telemetry_events (
      device_id, event_id, team_id, session_id, event_type, event_key, sequence,
      captured_at, event_detection_source, completed_laps, payload, race_run_id
    )
    select k.source_device_id,
           p_event_id,
           k.team_id,
           coalesce(k.source_session_id, 'tyre-detect'),
           'tyre_change',
           'tyre_change:' || k.completed_laps,
           coalesce(k.source_sequence, 0),
           coalesce(k.captured_at, clock_timestamp()),
           'tyre_wear_jump',
           k.completed_laps,
           jsonb_build_object(
             'lap', k.completed_laps,
             'before', jsonb_build_object(
               'fl', k.vorige_fl, 'fr', k.vorige_fr,
               'rl', k.vorige_rl, 'rr', k.vorige_rr
             ),
             'after', jsonb_build_object(
               'fl', k.wear_fl, 'fr', k.wear_fr,
               'rl', k.wear_rl, 'rr', k.wear_rr
             ),
             'delta', jsonb_build_object(
               'fl', k.wear_fl - k.vorige_fl,
               'fr', k.wear_fr - k.vorige_fr,
               'rl', k.wear_rl - k.vorige_rl,
               'rr', k.wear_rr - k.vorige_rr
             ),
             'min_jump', c_min_sprong,
             -- Was de vorige meting bevroren? Dan is de sprong minder hard
             -- bewijs: een inhalende momentopname kan er ook zo uitzien.
             'previous_frozen', coalesce(k.vorige_bevroren, false),
             'previous_exclusion_reason', k.vorige_exclusie
           ),
           k.race_run_id
      from kandidaat k
     where k.na_pitstop
       and not exists (
         select 1
           from public.endurance_telemetry_events e
          where e.team_id = k.team_id
            and e.event_type = 'tyre_change'
            and e.event_key = 'tyre_change:' || k.completed_laps
            and e.race_run_id is not distinct from k.race_run_id
       )
    returning 1
  )
  update public.endurance_strategy_lap_samples t
     set tyre_change_detected = true
    from kandidaat k
   where k.na_pitstop
     and t.event_id = p_event_id
     and t.race_run_id is not distinct from k.race_run_id
     and t.completed_laps = k.completed_laps;

  return query
  select s.team_id,
         count(*) filter (
           where s.wear_fl is not null and s.wear_fr is not null
             and s.wear_rl is not null and s.wear_rr is not null
         )::integer,
         count(*) filter (where s.wear_frozen)::integer,
         count(*) filter (where s.tyre_change_detected)::integer
    from public.endurance_strategy_lap_samples s
   where s.event_id = p_event_id
     and (p_team_id is null or s.team_id = p_team_id)
   group by s.team_id
   order by s.team_id;
end;
$function$;

-- De klok-taak: de detectie heeft geen zin zonder iemand die hem aanroept.
-- Loopt over de events die nu lopen of pas afgelopen zijn; een oude race hoeft
-- niet elke twee minuten opnieuw.
create or replace function public.endurance_tick_tyre_changes()
returns table (events integer, teams integer)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_event_id uuid;
  v_events integer := 0;
  v_teams integer := 0;
  r record;
begin
  for v_event_id in
    select e.id
      from public.endurance_events e
     where e.status in ('live', 'completed')
       and e.end_at > now() - interval '6 hours'
  loop
    for r in select * from public.endurance_detect_tyre_changes(v_event_id, null) loop
      v_events := v_events + coalesce(r.bandenwissels, 0);
      v_teams := v_teams + 1;
    end loop;
  end loop;

  return query select v_events, v_teams;
end;
$function$;

-- Schrijft events en markeert samples: alleen de service-role en de klok-taak
-- horen dit te doen. Geen grant aan authenticated.
revoke all on function public.endurance_detect_tyre_changes(uuid, uuid) from public;
revoke all on function public.endurance_tick_tyre_changes() from public;
grant execute on function public.endurance_detect_tyre_changes(uuid, uuid) to service_role;
grant execute on function public.endurance_tick_tyre_changes() to service_role;

select cron.unschedule('endurance-tyre-detection')
 where exists (select 1 from cron.job where jobname = 'endurance-tyre-detection');

select cron.schedule(
  'endurance-tyre-detection',
  '*/2 * * * *',
  $cron$select public.endurance_tick_tyre_changes()$cron$
);
