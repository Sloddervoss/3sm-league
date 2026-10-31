-- Rollback van 20261031180200_plugin08_connector_control.sql
--
-- Haalt de schrijver, de leesfunctie, de view en de tabel weg. Een 0.8-client
-- die het control-endpoint niet meer kan bereiken valt terug op het vaste
-- V3-basisprofiel (compatibiliteitsmodus); een 0.7.1.x-client heeft dit endpoint
-- nooit gebruikt. Het terugdraaien van dit bestand mag daarom geen enkele
-- bestaande client raken.
--
-- Geen begin/commit: atomair te draaien met psql -1.

drop function if exists public.simhub_connector_config_apply(jsonb, integer);

drop view if exists public.simhub_connector_config_readonly;

drop function if exists public.simhub_connector_config_public();

drop table if exists public.simhub_connector_config;
