-- ============================================================================
-- Plugin 0.8 — rondeaggregaten per apparaat (lapSummaries)
-- Datum: 2026-10-31
-- Vorige migratie: 20261031180000_plugin08_measurement_events.sql
-- Status: VOORSTEL. Niet toegepast op productie.
--
-- Waarom deze tabel bestaat
-- -------------------------
-- Temperatuurdekking, de brandstofniveau-integraal en de laterale belasting zijn
-- alleen te bewaren zolang de frames er zijn. De server kan overgeslagen of
-- nooit opgeslagen samples niet reconstrueren (brief, paragraaf 5.4). De
-- connector rekent de integraal daarom zelf uit op een begrensde frequentie
-- (20 Hz) en levert één compacte rij per ronde.
--
-- Wat deze tabel NIET is: geen framehistorie en geen vervanging van de
-- researchrecorder. Alleen de nu benoemde informatie, compact.
--
-- Kwaliteit boven volledigheid
-- ----------------------------
-- Een gemiddelde temperatuur of een integraal zonder dekking is misleidender
-- dan null. Daarom staan `valid_duration_seconds`, `sample_count` en
-- `max_gap_seconds` naast elke integraal, en `complete`/`invalid_reasons` naast
-- de ronde. De schrijver vult niets aan: ontbreekt de dekking, dan blijft het
-- getal leeg.
--
-- Idempotentie
-- ------------
-- `unique (device_id, summary_id)`; de schrijver doet `on conflict do nothing`.
-- Een ronde die de connector opnieuw aanbiedt na een verloren ACK levert dus
-- geen tweede rij op en overschrijft ook geen eerdere, mogelijk betere,
-- berekening.
--
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

create table if not exists public.simhub_lap_summaries (
  -- Surrogaatsleutel. Niet in de opdracht genoemd, maar een tabel zonder
  -- primary key is een tabel die je niet fatsoenlijk kunt joinen of verwijderen.
  -- De zakelijke sleutel blijft (device_id, summary_id) en is uniek.
  id uuid primary key default gen_random_uuid(),

  -- Stabiel, client-gegenereerd samenvattings-ID (per segment + ronde).
  summary_id text not null,

  -- Apparaat dat de ronde reed. TEXT, zoals in de opdracht; zie de aannames:
  -- hier hoort op termijn een uuid met FK naar simhub_devices.
  device_id text not null,

  transport_session_id text,
  segment_id text,
  lap_number integer,

  started_at timestamptz,
  ended_at timestamptz,

  -- Wie er op dat moment in de auto zat. Null = onbekend, en dat is
  -- informatie: bij een wissel binnen de ronde hoort `driver_changed` true te
  -- zijn en blijft dit veld leeg.
  current_driver_id uuid,

  -- Versie van het aggregatie-algoritme. Zonder dit getal kun je later geen
  -- oude en nieuwe berekeningen uit elkaar houden.
  aggregation_version integer not null default 1,

  -- Was de ronde volledig meetbaar? `invalid_reasons` zegt waarom niet.
  complete boolean,
  invalid_reasons text[],

  pit_lap boolean,
  driver_changed boolean,

  -- Temperatuur. Mean/min/max over de ronde; min en max zijn geen
  -- standaardafwijking en zeggen niets over de dekking — daarvoor zijn
  -- sample_count en valid_duration_seconds er.
  track_temp_c_mean double precision,
  track_temp_c_min double precision,
  track_temp_c_max double precision,
  air_temp_c_mean double precision,

  -- Brandstof. `fuel_level_integral_litre_seconds` is de integraal van het
  -- niveau over de ronde (litre x seconde); `fuel_added_litres_observed` is een
  -- waargenomen toename, niet automatisch de exact geleverde hoeveelheid.
  fuel_start_litres double precision,
  fuel_end_litres double precision,
  fuel_level_integral_litre_seconds double precision,
  fuel_added_litres_observed double precision,

  -- Belasting. De kwadratische integraal bestaat zodat later een
  -- effectieve-waarde (RMS) te berekenen is zonder de frames opnieuw te lezen.
  abs_lat_accel_integral_g_seconds double precision,
  lat_accel_squared_integral_g2_seconds double precision,
  max_abs_lat_accel_g double precision,
  abs_long_accel_integral_g_seconds double precision,

  -- Dekking van de meting: hoeveel seconden van de ronde werkelijk bemonsterd
  -- zijn, met hoeveel samples, en wat het grootste gat was. Zonder deze drie is
  -- geen enkele integraal hierboven te verantwoorden.
  valid_duration_seconds double precision,
  sample_count double precision,
  max_gap_seconds double precision,

  -- Koppelingen naar de gebeurtenissen van deze ronde.
  pit_visit_ids text[],
  wear_observation_ids text[],

  -- Wanneer de server de rij aannam. Diagnostiek, geen meetsemantiek.
  received_at timestamptz not null default now(),

  constraint simhub_lap_summaries_summary_id_len
    check (char_length(summary_id) between 1 and 64),
  constraint simhub_lap_summaries_transport_len
    check (transport_session_id is null or char_length(transport_session_id) between 1 and 120),
  constraint simhub_lap_summaries_segment_len
    check (segment_id is null or char_length(segment_id) between 1 and 64),
  constraint simhub_lap_summaries_lap_number_range
    check (lap_number is null or (lap_number >= 0 and lap_number <= 100000)),
  constraint simhub_lap_summaries_aggregation_version_range
    check (aggregation_version >= 1 and aggregation_version <= 1000),
  constraint simhub_lap_summaries_window_order
    check (started_at is null or ended_at is null or ended_at >= started_at),
  constraint simhub_lap_summaries_track_temp_order
    check (track_temp_c_min is null or track_temp_c_max is null or track_temp_c_max >= track_temp_c_min),
  -- Dekking is een duur, een aantal en een gat: nooit negatief.
  constraint simhub_lap_summaries_valid_duration_range
    check (valid_duration_seconds is null or valid_duration_seconds >= 0),
  constraint simhub_lap_summaries_sample_count_range
    check (sample_count is null or sample_count >= 0),
  constraint simhub_lap_summaries_max_gap_range
    check (max_gap_seconds is null or max_gap_seconds >= 0),
  constraint simhub_lap_summaries_fuel_range
    check ((fuel_start_litres is null or fuel_start_litres >= 0)
       and (fuel_end_litres is null or fuel_end_litres >= 0)
       and (fuel_added_litres_observed is null or fuel_added_litres_observed >= 0)),
  constraint simhub_lap_summaries_invalid_reasons_size
    check (invalid_reasons is null or cardinality(invalid_reasons) <= 16),
  constraint simhub_lap_summaries_pit_visit_ids_size
    check (pit_visit_ids is null or cardinality(pit_visit_ids) <= 32),
  constraint simhub_lap_summaries_wear_ids_size
    check (wear_observation_ids is null or cardinality(wear_observation_ids) <= 64),

  constraint simhub_lap_summaries_device_summary_key
    unique (device_id, summary_id)
);

-- Leesroute: de rondes van dit apparaat, recent eerst.
create index if not exists simhub_lap_summaries_device_started_idx
  on public.simhub_lap_summaries (device_id, started_at desc);

comment on table public.simhub_lap_summaries is
  'Rondeaggregaten per apparaat (temperatuur, brandstofniveau-integraal, belasting, dekking) met een stabiel client-summary_id. Idempotent op (device_id, summary_id); geen framehistorie.';
comment on column public.simhub_lap_summaries.valid_duration_seconds is
  'Werkelijk bemonsterde seconden van de ronde. Zonder deze kolom is geen integraal in deze tabel te verantwoorden.';
comment on column public.simhub_lap_summaries.fuel_added_litres_observed is
  'Waargenomen toename van het brandstofniveau, niet de exact geleverde hoeveelheid.';

alter table public.simhub_lap_summaries enable row level security;

revoke all on table public.simhub_lap_summaries from public, anon, authenticated;
grant select, insert, update, delete on table public.simhub_lap_summaries to service_role;
