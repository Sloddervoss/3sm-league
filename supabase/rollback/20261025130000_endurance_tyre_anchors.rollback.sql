-- Terugdraaien van 20261025130000_endurance_tyre_anchors.sql
--
-- De ankertabel verdwijnt. Dat is geen dataverlies in de zin van het plan: er is
-- nog niets gevuld (de ingest die schrijft komt in 20261025130100), en de
-- wear-waarden blijven staan waar ze altijd stonden, op
-- endurance_strategy_lap_samples. Draai deze rollback dus als laatste van de
-- drie, en alleen als je de anker metingen echt wilt weggooien.
--
-- Let op: de partiële index op endurance_telemetry_events hoort bij deze
-- migratie (de pit_entry_at-lookup) en gaat mee weg. De pit_entry/pit_exit-
-- events zelf blijven staan; die zijn van 20261025130100.

-- Eerst de afhankelijke leesfuncties, anders laat drop table ze niet met rust.
drop function if exists public.pitwall_tyre_estimate_v1(uuid, uuid);
drop function if exists public.endurance_tyre_state_labels(uuid, uuid);
drop function if exists public.endurance_tyre_anchor_json(public.endurance_tyre_anchors);

drop index if exists public.endurance_telemetry_events_pit_edges_idx;

drop table if exists public.endurance_tyre_anchors;
