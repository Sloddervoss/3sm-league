-- Stop scheduled maintenance first. Preserve retained rows and the additive FK.
BEGIN;
DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_retention(integer);
CREATE OR REPLACE FUNCTION pitwall_learning.reject_capture_batch_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
BEGIN
  -- Alleen de auth-delete-anonimisering mag de ownervelden leegmaken; alle
  -- bewijsvelden, inclusief payload en materiaalmarkering, blijven identiek.
  IF TG_OP = 'UPDATE'
     AND OLD.owner_user_id IS NOT NULL
     AND NEW.owner_user_id IS NULL
     AND (NEW.owner_basis = 'none' OR NEW.owner_basis IS NOT DISTINCT FROM OLD.owner_basis)
     AND (to_jsonb(NEW) - 'owner_user_id' - 'owner_basis')
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - 'owner_user_id' - 'owner_basis') THEN
    NEW.owner_basis := 'none';
    RETURN NEW;
  END IF;

  -- Eenmalige materiaalmarkering. Alleen NULL -> bewezen waarde, en alleen
  -- wanneer werkelijk ieder item is gematerialiseerd (de RPC bewijst dat
  -- vooraf).
  IF TG_OP = 'UPDATE'
     AND OLD.materialized_at IS NULL
     AND NEW.materialized_at IS NOT NULL
     AND NEW.materialized_items = OLD.item_count
     AND (to_jsonb(NEW) - 'materialized_at' - 'materialized_items')
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - 'materialized_at' - 'materialized_items') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'pitwall_learning.capture_batches is immutable'
    USING ERRCODE = 'PWL03';
END
$fn$;

CREATE OR REPLACE FUNCTION pitwall_learning.reject_source_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
BEGIN
  -- Eén smalle uitzondering: een auth-user deletion laat de FK
  -- owner_user_id op NULL zetten. Dat is een privacy-anonimisering, geen
  -- inhoudswijziging. Alleen owner_user_id/owner_basis mogen dan verschillen;
  -- payload, tijd, hash en alle andere bewijsvelden moeten byte-identiek
  -- blijven. Elke andere UPDATE of DELETE wordt geweigerd.
  IF TG_OP = 'UPDATE'
     AND OLD.owner_user_id IS NOT NULL
     AND NEW.owner_user_id IS NULL
     AND (to_jsonb(NEW) - 'owner_user_id' - 'owner_basis')
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - 'owner_user_id' - 'owner_basis') THEN
    NEW.owner_basis := 'none';
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'pitwall_learning.source_revisions is immutable'
    USING ERRCODE = 'PWL02';
END
$fn$;
COMMIT;
