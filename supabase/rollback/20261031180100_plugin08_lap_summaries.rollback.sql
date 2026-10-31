-- Rollback van 20261031180100_plugin08_lap_summaries.sql
--
-- GEGEVENSBEHOUDEND: de tabel wordt NIET verwijderd. Zelfde afweging als bij
-- de gebeurtenissentabel: een rondeaggregaat is niet reconstrueerbaar uit frames
-- die de server nooit had, en de outbox is geen garantie.
--
-- De schrijver is al teruggedraaid; er komt vanaf dat moment niets bij.
-- Destructief opruimen staat in supabase/rollback/plugin08_destructive_cleanup.sql.
--
-- Geen begin/commit: atomair te draaien met psql -1.

do $$
begin
  raise notice 'rollback 20261031180100: tabel simhub_lap_summaries blijft staan (gegevensbehoudend)';
end
$$;
