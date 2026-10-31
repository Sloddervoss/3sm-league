-- ============================================================================
-- Plugin 0.8 — meetgebeurtenissen (wear-ankers) in een eigen, begrensde tabel
-- Datum: 2026-10-31
-- Vorige migratie: 20261031170000_tyre_band_experimenteel.sql
-- Status: VOORSTEL. Niet toegepast op productie.
--
-- Waarom deze tabel bestaat
-- -------------------------
-- De bandentracker in de connector meldt nu een verandering van de wear-teller
-- als "anker", maar een veranderd getal bewijst niet dat de sim de band opnieuw
-- heeft gemeten, en een nieuwe SDK-tick bewijst dat evenmin (zie de brief,
-- paragraaf "Wear-anker: geen zekerheid verzinnen"). Daarom krijgt iedere
-- gebeurtenis een stabiel `event_id`, een tijd, een SDK-tick, het bewijs
-- (`evidence`) en een expliciete onzekerheid (`confidence`). Een kandidaat-anker
-- is dan een rij met lage confidence, geen bevestigd anker.
--
-- Waarom niet in endurance_telemetry_events
-- -----------------------------------------
-- Die tabel is de race-/rondestroom met een eigen enumsemantiek
-- (lap_completed, pit_entry, flag_change). Een meetgebeurtenis is iets anders:
-- hij hoort bij een apparaat en een sessiesegment, niet bij een team of run, en
-- hij komt met een client-ID die herhaald kan worden aangeboden. Deze tabel is
-- daarom device-scoped en idempotent op (device_id, event_id).
--
-- Idempotentie
-- ------------
-- `unique (device_id, event_id)` is de enige dedupe-sleutel. De outbox in de
-- plugin mag een gebeurtenis na een verloren ACK opnieuw sturen; dat mag geen
-- tweede rij opleveren. De schrijver doet daarom `on conflict do nothing`.
--
-- Geen begin/commit: atomair te draaien met psql -1, en daardoor ook bruikbaar
-- binnen een testtransactie.
-- ============================================================================

create table if not exists public.simhub_measurement_events (
  id uuid primary key default gen_random_uuid(),

  -- Apparaat dat de waarneming deed. TEXT en geen uuid: zo staat het in de
  -- opdracht voor deze tabel. Gevolg: er is geen foreign key naar
  -- simhub_devices.id. De schrijver (simhub_persist_v3) vult hier altijd
  -- d.id::text, dus in de praktijk is dit een uuid-string. Zie de aannames in
  -- de begeleidende notitie: een reviewer kan dit het beste naar uuid + FK
  -- trekken als niets zich tegen die keuze verzet.
  device_id text not null,

  -- Transportidentiteit van de connector-sessie (hetzelfde begrip als
  -- simhub_device_sessions.session_id). Leeg laten als de connector hem niet
  -- kent: onbekend is null, geen lege string.
  transport_session_id text,

  -- Lokaal sessiesegment van de connector (SessionSegmentTracker). Geen
  -- server-raceRunId: dat is een serverbegrip en hoort hier niet.
  segment_id text,

  -- Stabiel, client-gegenereerd ID. Samen met device_id de dedupe-sleutel.
  event_id text not null,

  -- Soort gebeurtenis: wear_value_changed, pit_service_completed,
  -- wear_refresh_confirmed, ... Bewust GEEN enum of CHECK-lijst: een nieuwe
  -- soort mag geen databasemigratie kosten (dezelfde regel als bij de
  -- rootkeys in de Edge-parser). De lengte is wel begrensd.
  kind text not null,

  -- Wanneer de connector de waarneming deed (UTC). Null = onbekend; nooit
  -- invullen met received_at, want dan lijkt een oude meting vers.
  observed_at timestamptz,

  -- Wanneer de server hem aannam. Diagnostiek, geen meetsemantiek.
  received_at timestamptz not null default now(),

  -- Sessietijd en SDK-tick op het moment van waarnemen. Beide nullable: een
  -- ontbrekend kanaal is onbekend, geen 0.
  session_time_seconds double precision,
  sdk_tick bigint,

  -- Wear vóór en na, per hoek, met eigen waarnemingstijden. Vrije vorm (jsonb)
  -- omdat de connector hier per hoek ook `observedAt` en `setGeneration` in
  -- kwijt moet; de vorm wordt bij de schrijver begrensd.
  wear_before jsonb,
  wear_after jsonb,

  -- Per hoek de setgeneratie met bewijsgrond. Null = niet vast te stellen.
  set_generation jsonb,

  -- Waarom dit een anker (of alleen een kandidaat) is: welke kanalen, welke
  -- waarden, welke aanname. Zonder dit veld is een confidence-getal niet te
  -- controleren.
  evidence jsonb,

  -- 0..1. Null = de connector durft geen getal te noemen; dat is iets anders
  -- dan 0 (zeker geen anker) en dat verschil mag niet verdwijnen.
  confidence double precision,

  constraint simhub_measurement_events_event_id_len
    check (char_length(event_id) between 1 and 64),
  constraint simhub_measurement_events_kind_len
    check (char_length(kind) between 1 and 64),
  constraint simhub_measurement_events_transport_len
    check (transport_session_id is null or char_length(transport_session_id) between 1 and 120),
  constraint simhub_measurement_events_segment_len
    check (segment_id is null or char_length(segment_id) between 1 and 64),
  constraint simhub_measurement_events_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint simhub_measurement_events_session_time_range
    check (session_time_seconds is null or (session_time_seconds >= 0 and session_time_seconds <= 604800)),
  constraint simhub_measurement_events_sdk_tick_range
    check (sdk_tick is null or sdk_tick >= 0),
  -- Een enkel frame mag geen megabyte bewijs meeslepen. De grens is ruim boven
  -- wat de connector per gebeurtenis stuurt (enkele honderden bytes) en klein
  -- genoeg om een payloadbudget te kunnen handhaven.
  constraint simhub_measurement_events_wear_before_size
    check (wear_before is null or pg_column_size(wear_before) <= 2048),
  constraint simhub_measurement_events_wear_after_size
    check (wear_after is null or pg_column_size(wear_after) <= 2048),
  constraint simhub_measurement_events_set_generation_size
    check (set_generation is null or pg_column_size(set_generation) <= 2048),
  constraint simhub_measurement_events_evidence_size
    check (evidence is null or pg_column_size(evidence) <= 4096),

  constraint simhub_measurement_events_device_event_key
    unique (device_id, event_id)
);

-- De leesroute is "wat gebeurde er op dit apparaat, recent eerst". Zonder deze
-- index is dat een seq scan zodra de tabel groeit; de unique key hierboven
-- helpt daar niet bij (die sorteert op event_id).
create index if not exists simhub_measurement_events_device_observed_idx
  on public.simhub_measurement_events (device_id, observed_at desc);

comment on table public.simhub_measurement_events is
  'Meetgebeurtenissen per apparaat: wear-ankers en pitgebeurtenissen met een stabiel client-event_id, bewijs en confidence. Idempotent op (device_id, event_id). confidence null = geen uitspraak; kind is bewust geen enum.';
comment on column public.simhub_measurement_events.confidence is
  '0..1, null = de connector noemt geen getal. Nooit 0 als vervanging van onbekend.';
comment on column public.simhub_measurement_events.observed_at is
  'Waarnemingstijd van de connector. Null = onbekend; nooit gevuld met received_at.';

-- RLS aan en géén policies: anon/authenticated kunnen hier niet bij. Alleen de
-- service-role schrijft (dat is de Edge met de service-role key). Lezen gebeurt
-- via server-side code met de service-role, niet rechtstreeks vanuit de browser.
alter table public.simhub_measurement_events enable row level security;

revoke all on table public.simhub_measurement_events from public, anon, authenticated;
grant select, insert, update, delete on table public.simhub_measurement_events to service_role;
