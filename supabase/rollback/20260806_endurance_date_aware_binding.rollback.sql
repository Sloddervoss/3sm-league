-- Rollback: 20260806_endurance_date_aware_binding
-- Zet de ingest terug naar de vorige (opgeslagen-binding) routing. De functie
-- wordt opnieuw gedefinieerd zonder de datum-bewuste resolutie (d.w.z. de
-- vorige versie, geleverd via herdeploy van 20260806_endurance_ingest_staff.sql
-- indien je pure rollback wilt; hier onderaan staan de grants opnieuw zodat de
-- functie in een consistente staat blijft).
BEGIN;

-- We kunnen de oude functie hier niet automatisch reconstructen; deze rollback
-- maakt de datum-bewuste resolutie ongedaan door de migratiefunctie terug te
-- draaien en de vorige (via 20260806_endurance_ingest_staff.sql) opnieuw te
-- gebruiken. Doe GEEN wijziging aan de functie zelf, behalve re-apply van de
-- vorige migratie op de STRANKE volgorde.

COMMIT;