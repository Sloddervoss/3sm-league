-- Endurance alpha-rollen: voeg enumwaarden toe in een eigen migratie.
-- PostgreSQL staat toe dat ALTER TYPE ... ADD VALUE in een transactie gebeurt,
-- maar de nieuwe waarde mag pas na COMMIT in functies/policies worden gebruikt.
-- Daarom staan de helperfuncties bewust in de volgende migratie.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'tester';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'endurance_manager';
