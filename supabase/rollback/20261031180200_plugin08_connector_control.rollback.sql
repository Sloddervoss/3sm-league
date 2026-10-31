-- Rollback van 20261031180200_plugin08_connector_control.sql
--
-- GEGEVENSBEHOUDEND: de tabel simhub_connector_config blijft staan met zijn
-- inhoud (revisies, frequenties, feature-standen). Alleen de code gaat weg: de
-- schrijver, de publieke leesfunctie en de view. Een publiek gepubliceerde
-- configuratie is beleid, geen cache; die weggooien zou de laatste stand van de
-- vloot wissen.
--
-- Een 0.7.2.0-client die het control-endpoint niet meer kan bereiken valt terug
-- op het vaste V3-basisprofiel; een 0.7.1.x-client heeft dit endpoint nooit
-- gebruikt.
--
-- Geen begin/commit: atomair te draaien met psql -1.

drop function if exists public.simhub_connector_config_apply(jsonb, integer);

drop view if exists public.simhub_connector_config_readonly;

drop function if exists public.simhub_connector_config_public();
