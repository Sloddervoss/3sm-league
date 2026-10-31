-- Rollback van 20261031180000_plugin08_measurement_events.sql
--
-- GEGEVENSBEHOUDEND: de tabel wordt NIET verwijderd. Een DROP gooide eerder
-- alle wear-ankers, pitgebeurtenissen en hun bewijs weg, met de aanname dat de
-- outbox van de connector ze opnieuw kan aanbieden. Die aanname is niet
-- gegarandeerd: een bericht dat al bevestigd en opgeruimd is, komt nooit terug.
--
-- De schrijver is al teruggedraaid (20261031180300 of 20261031190200), dus er
-- komt vanaf dat moment niets meer bij. Opruimen is een aparte, destructieve
-- handeling: supabase/rollback/plugin08_destructive_cleanup.sql, met een export
-- (pg_dump -t public.simhub_measurement_events) erboven.
--
-- Geen begin/commit: atomair te draaien met psql -1.

do $$
begin
  raise notice 'rollback 20261031180000: tabel simhub_measurement_events blijft staan (gegevensbehoudend)';
end
$$;
