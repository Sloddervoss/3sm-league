-- ============================================================================
-- Plugin 0.7.2.0 — meetserie mag niet in de leesbare snapshot belanden
-- Datum: 2026-10-31
-- Vorige migratie: 20261031190500_plugin08_safe_casts.sql
-- Reviewpunt: 7 (snapshotisolatie)
-- Status: voorstel. Niet toegepast op productie.
--
-- Het probleem
-- ------------
-- De Edge stuurde het volledige genormaliseerde frame als p_v3_normalized mee,
-- inclusief measurementEvents en lapSummaries. simhub_persist_v3 schrijft dat
-- object ongewijzigd in simhub_telemetry_latest.v3_normalized, en authenticated
-- heeft daar SELECT op. De nieuwe meettabellen waren afgeschermd, maar dezelfde
-- meetgegevens stonden er alsnog in een browserleesbare snapshot.
--
-- Twee maatregelen, bewust allebei
-- --------------------------------
--   1. De Edge bouwt vóór de RPC een kern-DTO zonder de meetreeksen
--      (simhubAggregates.snapshotDto) en stuurt die als p_v3_normalized. Dat is
--      de bron: de gegevens gaan als aparte parameters mee.
--   2. Deze trigger is de tweede wachter. Ook een oudere Edge, een handmatige
--      aanroep of een toekomstige codewijziging kan de meetserie er niet meer
--      in krijgen. Wat niet in de snapshot staat, kan ook niet via de
--      browserleesroute weglekken.
--
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

create or replace function public.simhub_strip_measurement_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Alleen top-level sleutels: de meetserie hoort een aparte parameter te zijn,
  -- geen deel van het kernframe. Onbekende sleutels blijven verder staan, zodat
  -- deze trigger geen tweede parser wordt.
  if new.v3_normalized is not null and jsonb_typeof(new.v3_normalized) = 'object' then
    new.v3_normalized := new.v3_normalized
      - 'measurementEvents'
      - 'lapSummaries'
      - 'measurementReport';
  end if;
  return new;
end
$$;

comment on function public.simhub_strip_measurement_snapshot() is
  'Verwijdert measurementEvents, lapSummaries en measurementReport uit v3_normalized voordat de snapshot wordt opgeslagen. Meetreeksen horen in simhub_measurement_events en simhub_lap_summaries, niet in een browserleesbare snapshot.';

drop trigger if exists simhub_telemetry_latest_strip_measurements on public.simhub_telemetry_latest;
create trigger simhub_telemetry_latest_strip_measurements
  before insert or update of v3_normalized on public.simhub_telemetry_latest
  for each row
  execute function public.simhub_strip_measurement_snapshot();

revoke all on function public.simhub_strip_measurement_snapshot() from public, anon, authenticated;

-- Bestaande snapshots: haal de meetserie er eenmalig uit. Dit is een
-- gegevensbeperkende, niet-destructieve stap (alleen de meetsleutels).
update public.simhub_telemetry_latest
   set v3_normalized = v3_normalized - 'measurementEvents' - 'lapSummaries' - 'measurementReport'
 where v3_normalized is not null
   and v3_normalized ?| array['measurementEvents', 'lapSummaries', 'measurementReport'];
