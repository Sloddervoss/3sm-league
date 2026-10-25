-- 2026-10-25: het banden-anker (S2, stap 1 van 3).
--
-- Een wear-waarde is geen stroom maar een eindmeting: iRacing ververst de
-- wear-kanalen alleen in de pitstraat, tijdens de service. Binnen een stint
-- staat het getal dus stil en tussen twee stops springt het. Wat je bij
-- pit-*entry* leest is de stand van de vorige service; pas na de service staan
-- de kanalen op de staat van de gemonteerde banden. Daarom is een anker een
-- meting op de pit-*exit*-overgang, één rij per stop, en niet één rij per ronde.
--
-- Deze tabel is de vastlegging; de ingest (20261025130100) schrijft hem en de
-- pitwall leest hem via pitwall_tyre_estimate_v1 (20261025130200). Geen enkele
-- client krijgt direct toegang: RLS aan, alles ingetrokken, alleen service_role
-- en de SECURITY DEFINER-functies komen erbij.
--
-- Wat hier bewust NIET gebeurt:
--   * Geen kolom op endurance_strategy_lap_samples. Die tabel is per ronde; het
--    zelfde anker zou er over 16-36 rijen herhaald worden en dat is precies de
--     fan-out die de wear-kolommen onbruikbaar maakt.
--   * Geen anker op de pit-ronde van de lap-sample: die rij kan van
--     validiteitsexclusie wisselen (pit_lane_during_lap), en dan is het anker
--     niet solide meer.
--   * Geen zones invullen als de plugin ze niet levert. Ze zijn null, geen 0.
--     De vier samengevatte wear-waarden zijn verplicht: een rij zonder die vier
--     is geen anker en wordt niet geschreven.
--   * Geen inner/middle/outer. De kolomnaam volgt de SDK (L/M/R): of LFwearL de
--     binnen- of buitenflank is, is per hoek verschillend en niet geverifieerd.

-- ---------------------------------------------------------------------------
-- 1. De tabel
-- ---------------------------------------------------------------------------

create table if not exists public.endurance_tyre_anchors (
  id uuid primary key default gen_random_uuid(),

  -- Context. race_run_id is verplicht: de idempotentiesleutel hangt eraan, en
  -- een anker zonder run is niet in een stintreeks te plaatsen.
  event_id uuid not null references public.endurance_events(id) on delete cascade,
  team_id uuid not null references public.endurance_teams(id) on delete cascade,
  race_run_id uuid not null references public.endurance_race_runs(id) on delete cascade,

  -- De bron, niet "de auto": twee devices van dezelfde auto zijn het op hetzelfde
  -- moment oneens (verschillende waarde én verschillende rondeteller). Een anker
  -- zonder device en sessie is niet te verdedigen.
  device_id uuid not null references public.simhub_devices(id) on delete cascade,
  session_id text not null,

  -- Volgnummer van de stop binnen de run, 1-based. Samen met race_run_id de
  -- unieke sleutel: één rij per stop, en een herhaalde snapshot levert geen
  -- tweede rij.
  stint_no integer not null,

  -- Rondestand van de bron op het moment van de meting (timing.completedLaps).
  -- Nodig om rondes tussen twee ankers te kunnen rekenen; zonder dit getal is er
  -- geen helling in punten per ronde.
  anchor_lap integer not null,

  -- set_no 1-based uit de sim-teller; tyre_changed = null betekent ONBEKEND,
  -- niet "niet gewisseld". Bij een wissel is deze meting de start van de
  -- volgende stint; zonder wissel is het de echte einde-van-stint-meting.
  tyre_set_no integer,
  tyre_changed boolean,

  -- Vier samengevatte waarden, zelfde semantiek en type als lap_samples.wear_*
  -- (100 = nieuw).
  wear_fl numeric(6,2) not null,
  wear_fr numeric(6,2) not null,
  wear_rl numeric(6,2) not null,
  wear_rr numeric(6,2) not null,

  -- Twaalf profielzones, zoals iRacing ze levert (LFwearL/M/R). Null zolang de
  -- plugin ze niet stuurt; nooit een fallback naar het generieke TyreWear<hoek>.
  wear_fl_l numeric(6,2),
  wear_fl_m numeric(6,2),
  wear_fl_r numeric(6,2),
  wear_fr_l numeric(6,2),
  wear_fr_m numeric(6,2),
  wear_fr_r numeric(6,2),
  wear_rl_l numeric(6,2),
  wear_rl_m numeric(6,2),
  wear_rl_r numeric(6,2),
  wear_rr_l numeric(6,2),
  wear_rr_m numeric(6,2),
  wear_rr_r numeric(6,2),

  -- Omgeving op het moment van de meting. Null als de build of de auto het niet
  -- geeft; de vormfactor heeft aan track_temp_c genoeg.
  track_temp_c numeric(5,2),
  air_temp_c numeric(5,2),
  rubber_state text,

  -- 'live' | 'last_available', uit vehicle.tyreDataMode. De payload zegt zelf dat
  -- dit een momentopname is; dat hoort in de databank, niet alleen in de payload.
  wear_source text not null default 'last_available',

  -- true = alle vier de hoeken identiek aan het vorige anker. Dat is geen meting
  -- maar een herhaling, dus het anker is niet bruikbaar in het model.
  wear_frozen boolean not null default false,

  -- false = rij bewaren als bewijs, niet in het model gebruiken.
  anchor_usable boolean not null default true,

  -- p_captured_at van de snapshot, niet now(): dit is het tijdstip van de meting.
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint endurance_tyre_anchors_run_stint_key unique (race_run_id, stint_no),

  constraint endurance_tyre_anchors_stint_no_check check (stint_no >= 1),
  constraint endurance_tyre_anchors_anchor_lap_check check (anchor_lap >= 0),
  constraint endurance_tyre_anchors_tyre_set_no_check check (tyre_set_no is null or tyre_set_no >= 1),
  -- Een geconstateerde wissel zonder setnummer mag; een 'niet gewisseld' zonder
  -- teller niet, want dan is de waarde onbekend en hoort er null te staan.
  constraint endurance_tyre_anchors_tyre_changed_check
    check (tyre_changed is null or tyre_set_no is not null or tyre_changed = true),
  constraint endurance_tyre_anchors_wear_source_check
    check (wear_source in ('live', 'last_available')),
  constraint endurance_tyre_anchors_rubber_state_check
    check (rubber_state is null or char_length(rubber_state) <= 64),

  constraint endurance_tyre_anchors_wear_fl_check check (wear_fl between 0 and 100),
  constraint endurance_tyre_anchors_wear_fr_check check (wear_fr between 0 and 100),
  constraint endurance_tyre_anchors_wear_rl_check check (wear_rl between 0 and 100),
  constraint endurance_tyre_anchors_wear_rr_check check (wear_rr between 0 and 100),

  constraint endurance_tyre_anchors_zone_check check (
        (wear_fl_l is null or wear_fl_l between 0 and 100)
    and (wear_fl_m is null or wear_fl_m between 0 and 100)
    and (wear_fl_r is null or wear_fl_r between 0 and 100)
    and (wear_fr_l is null or wear_fr_l between 0 and 100)
    and (wear_fr_m is null or wear_fr_m between 0 and 100)
    and (wear_fr_r is null or wear_fr_r between 0 and 100)
    and (wear_rl_l is null or wear_rl_l between 0 and 100)
    and (wear_rl_m is null or wear_rl_m between 0 and 100)
    and (wear_rl_r is null or wear_rl_r between 0 and 100)
    and (wear_rr_l is null or wear_rr_l between 0 and 100)
    and (wear_rr_m is null or wear_rr_m between 0 and 100)
    and (wear_rr_r is null or wear_rr_r between 0 and 100)
  )
);

comment on table public.endurance_tyre_anchors is
  'Eén wear-meting per stop: de stand die iRacing op de pit-exit-overgang heeft ververst. Geen reeks, geen per-ronde waarde.';
comment on column public.endurance_tyre_anchors.stint_no is
  'Volgnummer van de stop binnen de race_run, 1-based. Uniek per run: één rij per stop.';
comment on column public.endurance_tyre_anchors.tyre_changed is
  'true = set gewisseld bij deze stop (dan is dit de start van de volgende stint); false = set bleef zitten (echte eindmeting); null = onbekend.';
comment on column public.endurance_tyre_anchors.wear_frozen is
  'true = alle vier de hoeken identiek aan het vorige anker: herhaling van een momentopname, geen nieuwe meting.';
comment on column public.endurance_tyre_anchors.anchor_usable is
  'false = alleen bewijs, niet in het model.';
comment on column public.endurance_tyre_anchors.wear_source is
  'vehicle.tyreDataMode uit de payload: last_available betekent dat de plugin zelf claimt dat dit geen live meting is.';

-- De enige scan die het model doet: per team de ankers van een run, nieuwste eerst.
create index if not exists endurance_tyre_anchors_run_idx
  on public.endurance_tyre_anchors (event_id, team_id, race_run_id, stint_no desc);

-- Voor de pit_entry_at-lookup van de ingest: het entry-event van dezelfde bron
-- vóór de exit-meting. Alleen de twee pit-events, dus een kleine partiële index.
create index if not exists endurance_telemetry_events_pit_edges_idx
  on public.endurance_telemetry_events (device_id, session_id, captured_at desc)
  where event_type in ('pit_entry', 'pit_exit');

-- ---------------------------------------------------------------------------
-- 2. Rechten
-- ---------------------------------------------------------------------------

-- Alleen service_role leest of schrijft deze tabel; de pitwall komt er via
-- pitwall_tyre_estimate_v1 (SECURITY DEFINER) bij, net als bij de lap-samples.
alter table public.endurance_tyre_anchors enable row level security;

drop policy if exists endurance_tyre_anchors_service_role_all on public.endurance_tyre_anchors;
create policy endurance_tyre_anchors_service_role_all
  on public.endurance_tyre_anchors
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.endurance_tyre_anchors from public, anon, authenticated;
grant all on public.endurance_tyre_anchors to service_role;
