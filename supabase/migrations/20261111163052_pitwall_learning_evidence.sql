-- ============================================================================
-- 2026-11-11 — Pitwall learning P1: private bewijsopslag, dunne capture-outbox
-- en uitgestelde materialisatie (T06/T07/T08)
--
-- Scope:
--   * nieuw, privé schema pitwall_learning (owner supabase_admin);
--   * vier statement-level capturetriggers (INSERT/UPDATE per brontabel)
--     schrijven vóór COMMIT alleen één compacte, immutable capture_batch per
--     owner per statement plus één materialisatiejob. Geen bronrevisie,
--     qualityclassificatie of per-revisie-job in de ingest-transactie;
--   * begrensde materialisatie-RPC maakt de vijfdelige source_revisions en
--     source_validate-jobs later atomair en idempotent aan;
--   * jobs met lease/token/expiry/backoff/dead-letter (max 3 pogingen),
--     begrensde dead-letter-sweep en policygebonden claim/export/finish;
--   * één dedicated, beperkte LOGIN-rol pitwall_learning_worker;
--   * account_policy en runtime_settings met kill switches, standaard uit;
--   * P2+-tabellen (examples/predictions/evaluations/models/deployments)
--     worden alleen als lege, gesloten containers aangemaakt. Er is in P1
--     géén training, scoring, promotie of adviespad.
--
-- Bewust niet in deze migratie:
--   * geen nieuwe grants of policies op gedeelde public-tabellen;
--   * geen volledige framehistorie, geen aggregaties/scans, geen seed;
--   * geen retentie- of trainingsworker (T25, later);
--   * geen wachtwoord voor de workerrol (provisioning gebeurt buiten SQL);
--   * geen aanname dat een oude meting de huidige auto/baan/compound/owner
--     heeft. Die context is onbekend en wordt als blokkade vastgelegd.
--
-- Forward is één transactie (geen eigen BEGIN/COMMIT). De migratie weigert
-- een bestaand schema of een bestaande workerrol te adopteren. Paired
-- rollback: supabase/rollbacks/20261111163052_pitwall_learning_evidence.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Harde conflictpoort: nooit een bestaand object stilzwijgend overnemen.
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pitwall_learning') THEN
    RAISE EXCEPTION 'pitwall_learning schema already exists; refusing to adopt it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitwall_learning_worker') THEN
    RAISE EXCEPTION 'role pitwall_learning_worker already exists; refusing to adopt it';
  END IF;
  IF to_regclass('public.simhub_measurement_events') IS NULL
     OR to_regclass('public.simhub_lap_summaries') IS NULL
     OR to_regclass('public.simhub_devices') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'required 3SM baseline objects are missing';
  END IF;
  IF to_regprocedure('public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb) is missing';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Dedicated workerrol. Geen wachtwoord, geen superuser, geen inherit,
--    maximaal twee connecties. De rol krijgt later alleen USAGE op het
--    schema en EXECUTE op drie begrensde functies.
-- ---------------------------------------------------------------------------
CREATE ROLE pitwall_learning_worker
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  NOINHERIT
  CONNECTION LIMIT 2;

ALTER ROLE pitwall_learning_worker
  SET search_path = pg_catalog, pitwall_learning, pg_temp;

-- ---------------------------------------------------------------------------
-- 2. Privé schema. Owner is de bestaande supabase_admin; de migratie zet
--    daarna de rol om zodat alle nieuwe objecten dezelfde owner houden.
-- ---------------------------------------------------------------------------
CREATE SCHEMA pitwall_learning AUTHORIZATION supabase_admin;
COMMENT ON SCHEMA pitwall_learning IS
  'P1 private evidence store for pitwall learning; no application access';

SET LOCAL ROLE supabase_admin;

REVOKE ALL ON SCHEMA pitwall_learning FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Kill switches. Eén singleton, alles standaard FALSE. Alleen de owner
--    (operator/admin) kan deze rij wijzigen; er is geen frontendpad.
-- ---------------------------------------------------------------------------
CREATE TABLE pitwall_learning.runtime_settings (
  id              smallint    NOT NULL DEFAULT 1,
  capture_enabled boolean     NOT NULL DEFAULT false,
  worker_enabled  boolean     NOT NULL DEFAULT false,
  shadow_enabled  boolean     NOT NULL DEFAULT false,
  advice_enabled  boolean     NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        NULL,
  CONSTRAINT runtime_settings_pkey PRIMARY KEY (id),
  CONSTRAINT runtime_settings_singleton CHECK (id = 1)
);
COMMENT ON TABLE pitwall_learning.runtime_settings IS
  'Singleton kill switches. Capture, worker, shadow and advice are independent; defaults are FALSE.';

INSERT INTO pitwall_learning.runtime_settings (id) VALUES (1);

-- ---------------------------------------------------------------------------
-- 4. Persoonlijk accountbeleid. Geen rij = niet ingeschreven. Pooling is in
--    P1 expliciet onmogelijk; retentie mag alleen binnen 7/180/90 dagen.
--    Alleen operator/admin (owner) kan dit configureren.
-- ---------------------------------------------------------------------------
CREATE TABLE pitwall_learning.account_policy (
  owner_user_id          uuid        NOT NULL,
  policy_version         integer     NOT NULL DEFAULT 1,
  capture_enabled        boolean     NOT NULL DEFAULT false,
  personal_fit_enabled   boolean     NOT NULL DEFAULT false,
  pooling_enabled        boolean     NOT NULL DEFAULT false,
  serving_enabled        boolean     NOT NULL DEFAULT false,
  retention_jobs_days    smallint    NOT NULL DEFAULT 7,
  retention_source_days  smallint    NOT NULL DEFAULT 180,
  retention_forecast_days smallint   NOT NULL DEFAULT 90,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid        NULL,
  CONSTRAINT account_policy_pkey PRIMARY KEY (owner_user_id),
  CONSTRAINT account_policy_owner_fkey FOREIGN KEY (owner_user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT account_policy_version_positive CHECK (policy_version >= 1),
  CONSTRAINT account_policy_no_pooling_p1 CHECK (pooling_enabled = false),
  CONSTRAINT account_policy_retention_jobs CHECK (retention_jobs_days BETWEEN 1 AND 7),
  CONSTRAINT account_policy_retention_source CHECK (retention_source_days BETWEEN 1 AND 180),
  CONSTRAINT account_policy_retention_forecast CHECK (retention_forecast_days BETWEEN 1 AND 90)
);
COMMENT ON TABLE pitwall_learning.account_policy IS
  'Per-account P1 policy. No row means not enrolled. Pooling is forbidden in P1; retention is capped at 7/180/90 days.';


-- ---------------------------------------------------------------------------
-- 5. Immutable capture-batch-outbox. Eén rij per owner per statement.
--
--    De ingest transactie schrijft vóór COMMIT alleen deze compacte batch en
--    één materialisatiejob. Er worden hier geen bronrevisies, qualityredenen
--    of per-revisie-jobs berekend of geschreven. De batch is de enige
--    overdrachtsvorm naar de begrensde workerstap.
--
--    Budget: max 200 items per batch, ieder item <= 16384 bytes en het hele
--    batchpayload <= 262144 bytes. De bron-triggers bouwen alleen de bestaande
--    allowlist; frames, notes, namen en tokens komen hier niet in.
-- ---------------------------------------------------------------------------
CREATE TABLE pitwall_learning.capture_batches (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  source_kind              text        NOT NULL,
  owner_user_id            uuid        NULL,
  owner_basis              text        NOT NULL DEFAULT 'device_owner_at_receipt',
  account_policy_version   integer     NOT NULL,
  item_count               smallint    NOT NULL,
  payload                  jsonb       NOT NULL,
  -- Ontvangsttijd van de trigger vóór COMMIT. Geen first-visible/knownAt.
  received_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  receipt_commit_visible   boolean     NOT NULL DEFAULT false,
  as_of_quality            text        NOT NULL DEFAULT 'as_of_unverifiable',
  extractor_version        text        NOT NULL DEFAULT 'pitwall-learning-p1-capture-2',
  -- Eenmalige, voorwaartse materiaalmarkering. Payload en identiteit zijn
  -- immutable; alleen deze twee kolommen mogen één keer van NULL naar een
  -- bewezen waarde gaan.
  materialized_at          timestamptz NULL,
  materialized_items       smallint    NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capture_batches_pkey PRIMARY KEY (id),
  CONSTRAINT capture_batches_kind_check CHECK
    (source_kind IN ('measurement_event', 'lap_summary')),
  CONSTRAINT capture_batches_item_count CHECK (item_count BETWEEN 1 AND 200),
  CONSTRAINT capture_batches_payload_shape CHECK
    (jsonb_typeof(payload) = 'array'
     AND jsonb_array_length(payload) = item_count
     AND pg_column_size(payload) <= 262144),
  CONSTRAINT capture_batches_owner_basis CHECK
    (owner_basis IN ('device_owner_at_receipt', 'none')),
  CONSTRAINT capture_batches_owner_shape CHECK
    ((owner_user_id IS NULL AND owner_basis = 'none')
     OR (owner_user_id IS NOT NULL AND owner_basis = 'device_owner_at_receipt')),
  CONSTRAINT capture_batches_owner_fkey FOREIGN KEY (owner_user_id)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT capture_batches_receipt_precommit CHECK
    (receipt_commit_visible = false),
  CONSTRAINT capture_batches_as_of_quality CHECK
    (as_of_quality = 'as_of_unverifiable'),
  CONSTRAINT capture_batches_materialization_shape CHECK
    ((materialized_at IS NULL AND materialized_items IS NULL)
     OR (materialized_at IS NOT NULL AND materialized_items = item_count))
);
COMMENT ON TABLE pitwall_learning.capture_batches IS
  'Immutable compact capture outbox. One row per owner/source-statement; materialization is deferred to a bounded worker RPC.';
COMMENT ON COLUMN pitwall_learning.capture_batches.owner_user_id IS
  'Owner at receipt, frozen before COMMIT. A later device owner is never substituted during materialization.';
COMMENT ON COLUMN pitwall_learning.capture_batches.payload IS
  'Allowlisted items only; no owner id, no note/name/frame. Max 200 items, 16 KiB per item, 256 KiB total.';
COMMENT ON COLUMN pitwall_learning.capture_batches.received_at IS
  'Trigger time before COMMIT; not a first-visible/knownAt proof.';
COMMENT ON COLUMN pitwall_learning.capture_batches.materialized_at IS
  'One-way materialization proof; set only after every item and source_validate job exists.';

CREATE INDEX capture_batches_owner_received_idx
  ON pitwall_learning.capture_batches (owner_user_id, source_kind, received_at DESC);
CREATE INDEX capture_batches_pending_idx
  ON pitwall_learning.capture_batches (received_at)
  WHERE materialized_at IS NULL;

CREATE FUNCTION pitwall_learning.reject_capture_batch_mutation()
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

CREATE TRIGGER capture_batches_immutable
  BEFORE UPDATE OR DELETE ON pitwall_learning.capture_batches
  FOR EACH ROW EXECUTE FUNCTION pitwall_learning.reject_capture_batch_mutation();

-- ---------------------------------------------------------------------------
-- 6. Immutable bronrevisies. De vijfdelige identiteit blijft de echte
--    per-source identiteit en wordt pas bij materialisatie aangemaakt.
--    Iedere werkelijk geziene versie blijft staan; dezelfde versie opnieuw
--    materialiseren is idempotent. Er wordt nooit een oudere revisie
--    overschreven.
-- ---------------------------------------------------------------------------
CREATE TABLE pitwall_learning.source_revisions (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  capture_batch_id         uuid        NULL,
  source_kind              text        NOT NULL,
  device_id                text        NOT NULL,
  source_uid               uuid        NOT NULL,
  record_revision          integer     NOT NULL,
  content_hash             text        NOT NULL,
  observed_at              timestamptz NULL,
  source_received_at       timestamptz NOT NULL,
  server_receipt_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Ontvangst in de trigger is vóór COMMIT en dus geen bewijs van eerste
  -- zichtbaarheid. P1 bewaart dat expliciet kwalitatief, niet als "known".
  receipt_commit_visible   boolean     NOT NULL DEFAULT false,
  as_of_quality            text        NOT NULL DEFAULT 'as_of_unverifiable',
  owner_user_id            uuid        NULL,
  owner_basis              text        NOT NULL DEFAULT 'none',
  account_policy_version   integer     NULL,
  canonical_context        jsonb       NULL,
  context_status           text        NOT NULL DEFAULT 'blocked_missing_identity',
  training_eligible        boolean     NOT NULL DEFAULT false,
  extractor_version        text        NOT NULL DEFAULT 'pitwall-learning-p1-capture-2',
  payload                  jsonb       NOT NULL,
  quality_reasons          text[]      NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_revisions_pkey PRIMARY KEY (id),
  CONSTRAINT source_revisions_identity_key UNIQUE
    (source_kind, device_id, source_uid, record_revision, content_hash),
  CONSTRAINT source_revisions_batch_fkey FOREIGN KEY (capture_batch_id)
    REFERENCES pitwall_learning.capture_batches(id) ON DELETE RESTRICT,
  CONSTRAINT source_revisions_kind_check CHECK
    (source_kind IN ('measurement_event', 'lap_summary')),
  CONSTRAINT source_revisions_device_len CHECK
    (char_length(device_id) BETWEEN 1 AND 120),
  CONSTRAINT source_revisions_revision_range CHECK
    (record_revision BETWEEN 1 AND 100000),
  CONSTRAINT source_revisions_hash_shape CHECK
    (content_hash ~ '^[0-9a-f]{32}$'),
  CONSTRAINT source_revisions_receipt_precommit CHECK
    (receipt_commit_visible = false),
  CONSTRAINT source_revisions_as_of_quality CHECK
    (as_of_quality = 'as_of_unverifiable'),
  CONSTRAINT source_revisions_owner_basis CHECK
    (owner_basis IN ('device_owner_at_receipt', 'none')),
  CONSTRAINT source_revisions_owner_fkey FOREIGN KEY (owner_user_id)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT source_revisions_owner_shape CHECK
    ((owner_user_id IS NULL AND owner_basis = 'none')
     OR (owner_user_id IS NOT NULL AND owner_basis = 'device_owner_at_receipt')),
  CONSTRAINT source_revisions_context_status CHECK
    (context_status = 'blocked_missing_identity'),
  CONSTRAINT source_revisions_not_training_eligible_p1 CHECK
    (training_eligible = false),
  CONSTRAINT source_revisions_payload_shape CHECK
    (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 16384),
  CONSTRAINT source_revisions_quality_reasons_shape CHECK
    (cardinality(quality_reasons) BETWEEN 1 AND 16
     AND array_position(quality_reasons, NULL) IS NULL
     AND quality_reasons <@ ARRAY[
       'car_unknown', 'track_unknown', 'compound_unknown',
       'historical_owner_unverified', 'owner_at_receipt_only',
       'driver_identity_unverified', 'observed_at_missing',
       'clock_skew', 'late_delivery', 'stale_revision_delivered_late',
       'source_hash_revision_conflict', 'context_incomplete',
       'non_training_eligible', 'as_of_unverifiable',
       'server_receipt_precommit'
     ]::text[])
);
COMMENT ON TABLE pitwall_learning.source_revisions IS
  'Immutable captured source revisions, materialized from a compact batch. Five-part identity; old revisions are never overwritten. Every P1 row is context-blocked and non-training-eligible.';
COMMENT ON COLUMN pitwall_learning.source_revisions.capture_batch_id IS
  'Provenance to the compact outbox batch. NULL only for retained pre-upgrade evidence.';
COMMENT ON COLUMN pitwall_learning.source_revisions.server_receipt_at IS
  'Batch receipt time before COMMIT; not a first-visible/knownAt proof. receipt_commit_visible is false by construction.';
COMMENT ON COLUMN pitwall_learning.source_revisions.canonical_context IS
  'NULL in P1: no verified car/track/compound/historical-owner context exists for these source rows.';

CREATE INDEX source_revisions_owner_observed_idx
  ON pitwall_learning.source_revisions (owner_user_id, source_kind, observed_at DESC);
CREATE INDEX source_revisions_uid_idx
  ON pitwall_learning.source_revisions (source_kind, device_id, source_uid, record_revision DESC);
CREATE INDEX source_revisions_batch_idx
  ON pitwall_learning.source_revisions (capture_batch_id)
  WHERE capture_batch_id IS NOT NULL;

-- Bewijs is append-only. Ook de owner kan een eenmaal vastgelegde revisie
-- niet stilzwijgend wijzigen of verwijderen.
CREATE FUNCTION pitwall_learning.reject_source_revision_mutation()
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

CREATE TRIGGER source_revisions_immutable
  BEFORE UPDATE OR DELETE ON pitwall_learning.source_revisions
  FOR EACH ROW EXECUTE FUNCTION pitwall_learning.reject_source_revision_mutation();

-- ---------------------------------------------------------------------------
-- 7. Jobs: één job per revision/kind en één materialisatiejob per batch.
--    Lease met token en expiry, pogingen/backoff en dead-letter na maximaal
--    drie pogingen. source_revision_id en capture_batch_id zijn exclusief.
-- ---------------------------------------------------------------------------
CREATE TABLE pitwall_learning.jobs (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  source_revision_id uuid       NULL,
  capture_batch_id  uuid        NULL,
  kind              text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending',
  attempts          smallint    NOT NULL DEFAULT 0,
  max_attempts      smallint    NOT NULL DEFAULT 3,
  next_attempt_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token       uuid        NULL,
  lease_owner       text        NULL,
  lease_expires_at  timestamptz NULL,
  last_error_code   text        NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz NULL,
  CONSTRAINT jobs_pkey PRIMARY KEY (id),
  CONSTRAINT jobs_revision_kind_key UNIQUE (source_revision_id, kind),
  CONSTRAINT jobs_reference_shape CHECK
    ((source_revision_id IS NOT NULL
      AND capture_batch_id IS NULL
      AND kind IN ('source_validate', 'example_build'))
     OR
     (source_revision_id IS NULL
      AND capture_batch_id IS NOT NULL
      AND kind = 'materialize_capture_batch')),
  CONSTRAINT jobs_batch_fkey FOREIGN KEY (capture_batch_id)
    REFERENCES pitwall_learning.capture_batches(id) ON DELETE RESTRICT,
  CONSTRAINT jobs_kind_check CHECK
    (kind IN ('source_validate', 'example_build', 'materialize_capture_batch')),
  CONSTRAINT jobs_status_check CHECK
    (status IN ('pending', 'leased', 'done', 'dead')),
  CONSTRAINT jobs_attempts_range CHECK (attempts BETWEEN 0 AND 3),
  CONSTRAINT jobs_max_attempts_fixed CHECK (max_attempts = 3),
  CONSTRAINT jobs_error_code_shape CHECK
    (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_.:-]{1,64}$'),
  CONSTRAINT jobs_lease_shape CHECK
    ((status = 'leased'
      AND lease_token IS NOT NULL
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL)
     OR (status <> 'leased'
      AND lease_token IS NULL
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL)),
  CONSTRAINT jobs_finished_shape CHECK
    ((status IN ('done', 'dead')) = (finished_at IS NOT NULL))
);
COMMENT ON TABLE pitwall_learning.jobs IS
  'Bounded worker queue. One job per revision/kind and one materialize job per batch; lease token + expiry; at most three attempts then dead.';

CREATE UNIQUE INDEX jobs_batch_kind_key
  ON pitwall_learning.jobs (capture_batch_id, kind)
  WHERE capture_batch_id IS NOT NULL;
CREATE INDEX jobs_claim_idx
  ON pitwall_learning.jobs (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'leased');
CREATE INDEX jobs_expiry_idx
  ON pitwall_learning.jobs (lease_expires_at)
  WHERE status = 'leased';
-- Begrensde dead-letter-sweep: alleen uitputtelijke, niet-gedode jobs. De
-- sweep in claim_jobs gebruikt deze index met LIMIT + SKIP LOCKED.
CREATE INDEX jobs_deadletter_idx
  ON pitwall_learning.jobs (attempts, created_at)
  WHERE status IN ('pending', 'leased');

-- Een materialisatiejob mag alleen 'done' worden wanneer de batch zelf een
-- volledig materiaalbewijs draagt. De RPC zet eerst dat bewijs en daarna de
-- job; een directe worker-update of finish_job-done wordt hier geweigerd.
CREATE FUNCTION pitwall_learning.enforce_job_materialization_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
BEGIN
  IF NEW.kind = 'materialize_capture_batch' AND NEW.status = 'done' THEN
    IF NEW.capture_batch_id IS NULL OR NOT EXISTS (
      SELECT 1
        FROM pitwall_learning.capture_batches b
       WHERE b.id = NEW.capture_batch_id
         AND b.materialized_at IS NOT NULL
         AND b.materialized_items = b.item_count
    ) THEN
      RAISE EXCEPTION 'materialize job cannot be done without batch proof'
        USING ERRCODE = 'PWL04';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER jobs_materialization_proof
  BEFORE INSERT OR UPDATE OF status ON pitwall_learning.jobs
  FOR EACH ROW EXECUTE FUNCTION pitwall_learning.enforce_job_materialization_proof();

-- Bewust géén FK van jobs.source_revision_id naar source_revisions: een
-- batchjob heeft die kolom NULL, maar PostgreSQL zou bij iedere jobinsert
-- alsnog een lock op de gerefereerde tabel nemen. Dan zou een lock op
-- source_revisions de ingest-outbox kunnen blokkeren. Deze smalle trigger
-- controleert alleen échte source-jobs en raakt source_revisions nooit aan
-- voor een materialisatiejob.
CREATE FUNCTION pitwall_learning.validate_job_source_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
BEGIN
  IF NEW.source_revision_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pitwall_learning.source_revisions r
       WHERE r.id = NEW.source_revision_id
    ) THEN
      RAISE EXCEPTION 'job source revision does not exist'
        USING ERRCODE = 'PWL05';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER jobs_source_revision_valid
  BEFORE INSERT OR UPDATE OF source_revision_id ON pitwall_learning.jobs
  FOR EACH ROW EXECUTE FUNCTION pitwall_learning.validate_job_source_revision();

-- ---------------------------------------------------------------------------
-- 7. P2+-containers. In P1 bewust leeg en zonder enige applicatiegrants.
--    Zij bestaan alleen zodat latere migrations een echte, gesloten vorm
--    kunnen vullen; er is hier geen trainings-, scorings- of promotiecode.
-- ---------------------------------------------------------------------------
CREATE TABLE pitwall_learning.models (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id   uuid        NULL,
  model_kind      text        NOT NULL,
  version         text        NOT NULL,
  manifest_hash   text        NOT NULL,
  state           text        NOT NULL DEFAULT 'draft',
  policy_version  integer     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  activated_at    timestamptz NULL,
  retired_at      timestamptz NULL,
  CONSTRAINT models_pkey PRIMARY KEY (id),
  CONSTRAINT models_owner_fkey FOREIGN KEY (owner_user_id)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT models_kind_check CHECK
    (model_kind IN ('fuel_next_lap', 'tyre_wear', 'pit_loss')),
  CONSTRAINT models_version_len CHECK (char_length(version) BETWEEN 1 AND 64),
  CONSTRAINT models_manifest_shape CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT models_state_check CHECK
    (state IN ('draft', 'shadow', 'active', 'retired')),
  CONSTRAINT models_state_times CHECK
    ((state = 'active' AND activated_at IS NOT NULL AND retired_at IS NULL)
     OR (state = 'retired' AND retired_at IS NOT NULL)
     OR state IN ('draft', 'shadow')),
  CONSTRAINT models_kind_version_key UNIQUE (model_kind, version),
  CONSTRAINT models_manifest_key UNIQUE (manifest_hash)
);

CREATE TABLE pitwall_learning.examples (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  source_revision_id    uuid        NOT NULL,
  owner_user_id         uuid        NULL,
  feature_version       text        NOT NULL,
  label                 jsonb       NOT NULL,
  label_quality         text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  retention_expires_at  timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  CONSTRAINT examples_pkey PRIMARY KEY (id),
  CONSTRAINT examples_revision_fkey FOREIGN KEY (source_revision_id)
    REFERENCES pitwall_learning.source_revisions(id) ON DELETE RESTRICT,
  CONSTRAINT examples_owner_fkey FOREIGN KEY (owner_user_id)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT examples_feature_version_len CHECK (char_length(feature_version) BETWEEN 1 AND 64),
  CONSTRAINT examples_label_quality_check CHECK
    (label_quality IN ('observed', 'replay', 'as_of_unverifiable', 'blocked')),
  CONSTRAINT examples_retention_cap CHECK
    (retention_expires_at <= created_at + interval '180 days'),
  CONSTRAINT examples_revision_feature_key UNIQUE (source_revision_id, feature_version)
);

CREATE TABLE pitwall_learning.predictions (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  model_id            uuid        NOT NULL,
  source_revision_id  uuid        NULL,
  example_id          uuid        NULL,
  as_of               timestamptz NOT NULL,
  prediction          jsonb       NOT NULL,
  policy_version      integer     NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  retention_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  CONSTRAINT predictions_pkey PRIMARY KEY (id),
  CONSTRAINT predictions_model_fkey FOREIGN KEY (model_id)
    REFERENCES pitwall_learning.models(id) ON DELETE RESTRICT,
  CONSTRAINT predictions_revision_fkey FOREIGN KEY (source_revision_id)
    REFERENCES pitwall_learning.source_revisions(id) ON DELETE RESTRICT,
  CONSTRAINT predictions_example_fkey FOREIGN KEY (example_id)
    REFERENCES pitwall_learning.examples(id) ON DELETE RESTRICT,
  CONSTRAINT predictions_prediction_object CHECK (jsonb_typeof(prediction) = 'object'),
  CONSTRAINT predictions_retention_cap CHECK
    (retention_expires_at <= created_at + interval '90 days')
);

CREATE TABLE pitwall_learning.evaluations (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  model_id               uuid        NOT NULL,
  dataset_manifest_hash  text        NOT NULL,
  metrics                jsonb       NOT NULL,
  status                 text        NOT NULL DEFAULT 'pending',
  created_at             timestamptz NOT NULL DEFAULT now(),
  evaluated_at           timestamptz NULL,
  retention_expires_at   timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  CONSTRAINT evaluations_pkey PRIMARY KEY (id),
  CONSTRAINT evaluations_model_fkey FOREIGN KEY (model_id)
    REFERENCES pitwall_learning.models(id) ON DELETE RESTRICT,
  CONSTRAINT evaluations_manifest_shape CHECK (dataset_manifest_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT evaluations_metrics_object CHECK (jsonb_typeof(metrics) = 'object'),
  CONSTRAINT evaluations_status_check CHECK
    (status IN ('pending', 'passed', 'failed', 'blocked')),
  CONSTRAINT evaluations_retention_cap CHECK
    (retention_expires_at <= created_at + interval '90 days'),
  CONSTRAINT evaluations_model_manifest_key UNIQUE (model_id, dataset_manifest_hash)
);

CREATE TABLE pitwall_learning.deployments (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  model_id      uuid        NOT NULL,
  target        text        NOT NULL,
  surface       text        NOT NULL,
  generation    bigint      NOT NULL,
  state         text        NOT NULL DEFAULT 'shadow',
  created_at    timestamptz NOT NULL DEFAULT now(),
  activated_at  timestamptz NULL,
  retired_at    timestamptz NULL,
  CONSTRAINT deployments_pkey PRIMARY KEY (id),
  CONSTRAINT deployments_model_fkey FOREIGN KEY (model_id)
    REFERENCES pitwall_learning.models(id) ON DELETE RESTRICT,
  CONSTRAINT deployments_target_check CHECK
    (target IN ('fuel_next_lap', 'tyre_wear', 'pit_loss')),
  CONSTRAINT deployments_surface_check CHECK
    (surface IN ('shadow', 'admin_pitwall_test', 'active')),
  CONSTRAINT deployments_generation_positive CHECK (generation >= 1),
  CONSTRAINT deployments_state_check CHECK
    (state IN ('shadow', 'active', 'retired', 'rolled_back')),
  CONSTRAINT deployments_target_surface_generation_key
    UNIQUE (target, surface, generation)
);
CREATE UNIQUE INDEX deployments_one_active_per_surface
  ON pitwall_learning.deployments (target, surface)
  WHERE state = 'active';


-- ---------------------------------------------------------------------------
-- 8. RLS als defense-in-depth. Geen enkele policy: de nieuwe tabellen zijn
--    alleen via de owner of via de vier SECURITY DEFINER-workerfuncties
--    bereikbaar. Er zijn geen auth-writes.
-- ---------------------------------------------------------------------------
ALTER TABLE pitwall_learning.runtime_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.account_policy     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.capture_batches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.source_revisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.jobs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.models             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.examples           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.predictions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.evaluations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.deployments        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 9. Dunne capture. De statement-triggers bouwen alleen de bestaande
--    allowlist en roepen één private helper aan. Die helper doet de globale
--    poort, de owner-at-receipt/policy-join en schrijft per owner één
--    compacte batch plus één materialisatiejob. Geen bronrevisie, geen
--    qualityclassificatie en geen per-revisie-job vóór COMMIT.
--
--    Waarom statement-level: de ingest schrijft een batch in één INSERT (en
--    bij een nieuwe revisie één UPDATE). Een row-trigger zou per rij
--    dezelfde poort-SELECTs en EXISTS-checks doen. De trigger vuurt nu één
--    keer per statement.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pitwall_learning.capture_source_batch(
  p_source_kind text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
SET lock_timeout = '50ms'
AS $fn$
DECLARE
  v_batches jsonb := '[]'::jsonb;
  v_items integer := 0;
  v_jobs integer := 0;
  v_oversized integer := 0;
BEGIN
  IF p_source_kind NOT IN ('measurement_event', 'lap_summary') THEN
    RAISE EXCEPTION 'invalid source kind' USING ERRCODE = 'PWL10';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'capture rows must be an array' USING ERRCODE = 'PWL11';
  END IF;
  -- Dezelfde bovengrens als de ingest-batch. Nooit een onbegrensde scan of
  -- insert vanuit deze helper.
  IF jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION 'capture row batch exceeds 200' USING ERRCODE = 'PWL12';
  END IF;

  -- Globaal expliciet aan. Ontbrekende instelling of FALSE betekent: niets
  -- vastleggen, geen fout en geen wijziging aan de ACK.
  IF NOT EXISTS (
    SELECT 1 FROM pitwall_learning.runtime_settings rs
     WHERE rs.id = 1 AND rs.capture_enabled
  ) THEN
    RETURN jsonb_build_object('batches', '[]'::jsonb, 'items', 0, 'jobs', 0);
  END IF;

  -- Eén set-based statement: per rij de owner-at-receipt en de echte policy,
  -- daarna groeperen per owner/policyversie. Een ontbrekende policy, een
  -- uitgeschakelde policy of een onbekend device levert voor die rij niets
  -- op, zonder de rest te blokkeren. De item-JSON bevat geen owner-ID.
  WITH input AS (
    SELECT x.ord,
           x.value                                            AS item,
           x.value->>'device_id'                              AS device_id,
           CASE WHEN (x.value->>'source_uid') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (x.value->>'source_uid')::uuid END       AS source_uid,
           CASE WHEN (x.value->>'record_revision') ~ '^[0-9]{1,6}$'
                THEN (x.value->>'record_revision')::integer END AS record_revision,
           x.value->>'content_hash'                           AS content_hash,
           nullif(x.value->>'observed_at', '')::timestamptz  AS observed_at,
           coalesce(nullif(x.value->>'source_received_at', '')::timestamptz,
                    clock_timestamp())                        AS source_received_at,
           x.value->'payload'                                 AS payload
      FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(value, ord)
  ), devices AS (
    SELECT DISTINCT i.device_id
      FROM input i
     WHERE i.device_id IS NOT NULL
  ), device_owner AS (
    SELECT dv.device_id, d.owner_user_id, ap.policy_version
      FROM devices dv
      JOIN public.simhub_devices d
        ON d.id = CASE
                    WHEN dv.device_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN dv.device_id::uuid
                  END
      JOIN pitwall_learning.account_policy ap
        ON ap.owner_user_id = d.owner_user_id
       AND ap.capture_enabled
  ), admitted AS (
    SELECT i.ord, i.item, i.device_id, i.source_uid, i.record_revision,
           i.content_hash, i.observed_at, i.source_received_at, i.payload,
           o.owner_user_id, o.policy_version
      FROM input i
      JOIN device_owner o ON o.device_id = i.device_id
     WHERE i.source_uid IS NOT NULL
       AND i.record_revision BETWEEN 1 AND 100000
       AND i.content_hash ~ '^[0-9a-f]{32}$'
       AND char_length(i.device_id) BETWEEN 1 AND 120
       AND i.payload IS NOT NULL
       AND jsonb_typeof(i.payload) = 'object'
       AND pg_column_size(i.payload) <= 16384
  ), grouped AS (
    SELECT a.owner_user_id, a.policy_version,
           jsonb_agg(a.item ORDER BY a.ord) AS items,
           count(*)::smallint AS item_count
      FROM admitted a
     GROUP BY a.owner_user_id, a.policy_version
  ), sized AS (
    SELECT g.*, pg_column_size(g.items) AS batch_bytes FROM grouped g
  ), ins AS (
    INSERT INTO pitwall_learning.capture_batches (
      source_kind, owner_user_id, owner_basis, account_policy_version,
      item_count, payload, extractor_version
    )
    SELECT p_source_kind, s.owner_user_id, 'device_owner_at_receipt',
           s.policy_version, s.item_count, s.items,
           'pitwall-learning-p1-capture-2'
      FROM sized s
     WHERE s.batch_bytes <= 262144
    RETURNING id, item_count
  ), jobs_ins AS (
    INSERT INTO pitwall_learning.jobs (capture_batch_id, kind)
    SELECT ins.id, 'materialize_capture_batch' FROM ins
    ON CONFLICT DO NOTHING
    RETURNING capture_batch_id
  )
  SELECT
    (SELECT count(*)::integer FROM sized WHERE batch_bytes > 262144),
    coalesce((SELECT jsonb_agg(jsonb_build_object('batch_id', ins.id,
                                                  'items', ins.item_count))
                FROM ins), '[]'::jsonb),
    coalesce((SELECT sum(ins.item_count)::integer FROM ins), 0),
    (SELECT count(*)::integer FROM jobs_ins)
  INTO v_oversized, v_batches, v_items, v_jobs;

  -- Een te grote batch wordt nooit stilletjes in stukken geknipt: de hele
  -- capturepoging faalt en de trigger vertaalt dat naar de vaste WARNING.
  -- De ingest-ACK blijft ongewijzigd.
  IF v_oversized > 0 THEN
    RAISE EXCEPTION 'capture batch exceeds 262144 bytes' USING ERRCODE = 'PWL13';
  END IF;

  RETURN jsonb_build_object('batches', v_batches, 'items', v_items, 'jobs', v_jobs);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 9a. Statement-triggers op events. Alleen INSERT en UPDATE; geen trigger op
--     frames, simhub_telemetry_latest, simhub_devices of andere tabellen.
--     Een UPDATE telt alleen als record_revision of content_hash werkelijk
--     verschilt; een latere received_at-write maakt geen schijnbatch.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pitwall_learning.capture_measurement_events_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
SET lock_timeout = '50ms'
AS $fn$
BEGIN
  -- Goedkope poort vóór het bouwen van payloads: staat capture uit, dan
  -- kost een batch alleen deze ene indexprobe.
  IF NOT EXISTS (
    SELECT 1 FROM pitwall_learning.runtime_settings rs
     WHERE rs.id = 1 AND rs.capture_enabled
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM pitwall_learning.capture_source_batch(
    'measurement_event',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'device_id', n.device_id,
        'source_uid', n.event_uid,
        'record_revision', n.record_revision,
        'content_hash', n.content_hash,
        'observed_at', n.observed_at,
        'source_received_at', n.received_at,
        'payload', jsonb_strip_nulls(jsonb_build_object(
          'kind', n.kind,
          'observed_session_id', n.observed_session_id,
          'delivered_session_id', n.delivered_session_id,
          'segment_id', n.segment_id,
          'observed_at', n.observed_at,
          'session_time_seconds', n.session_time_seconds,
          'sdk_tick', n.sdk_tick,
          'wear_before', n.wear_before,
          'wear_after', n.wear_after,
          'set_generation', n.set_generation,
          'confidence', n.confidence,
          'evidence', CASE WHEN n.evidence IS NULL THEN NULL
                           ELSE n.evidence - 'note' END
        ))
      )), '[]'::jsonb)
      FROM new_rows n)
  );
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- Vaste code, geen payload, geen secrets, geen logtabelwrite. De
  -- bronschrijver en zijn ACK blijven ongewijzigd.
  RAISE WARNING 'pitwall_learning capture skipped' USING ERRCODE = 'PWL01';
  RETURN NULL;
END
$fn$;

CREATE FUNCTION pitwall_learning.capture_measurement_events_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
SET lock_timeout = '50ms'
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pitwall_learning.runtime_settings rs
     WHERE rs.id = 1 AND rs.capture_enabled
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM pitwall_learning.capture_source_batch(
    'measurement_event',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'device_id', n.device_id,
        'source_uid', n.event_uid,
        'record_revision', n.record_revision,
        'content_hash', n.content_hash,
        'observed_at', n.observed_at,
        'source_received_at', n.received_at,
        'payload', jsonb_strip_nulls(jsonb_build_object(
          'kind', n.kind,
          'observed_session_id', n.observed_session_id,
          'delivered_session_id', n.delivered_session_id,
          'segment_id', n.segment_id,
          'observed_at', n.observed_at,
          'session_time_seconds', n.session_time_seconds,
          'sdk_tick', n.sdk_tick,
          'wear_before', n.wear_before,
          'wear_after', n.wear_after,
          'set_generation', n.set_generation,
          'confidence', n.confidence,
          'evidence', CASE WHEN n.evidence IS NULL THEN NULL
                           ELSE n.evidence - 'note' END
        ))
      )), '[]'::jsonb)
      FROM new_rows n
      JOIN old_rows o ON o.id = n.id
     WHERE (n.record_revision, n.content_hash)
           IS DISTINCT FROM (o.record_revision, o.content_hash))
  );
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'pitwall_learning capture skipped' USING ERRCODE = 'PWL01';
  RETURN NULL;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 9b. Statement-triggers op rondeaggregaten. Geen current_driver_name/id,
--     geen note, geen raw coverage-input: alleen de kleine, gevalideerde
--     aggregatievelden.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pitwall_learning.capture_lap_summaries_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
SET lock_timeout = '50ms'
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pitwall_learning.runtime_settings rs
     WHERE rs.id = 1 AND rs.capture_enabled
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM pitwall_learning.capture_source_batch(
    'lap_summary',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'device_id', n.device_id,
        'source_uid', n.summary_uid,
        'record_revision', n.record_revision,
        'content_hash', n.content_hash,
        'observed_at', coalesce(n.started_at, n.ended_at),
        'source_received_at', n.received_at,
        'payload', jsonb_strip_nulls(jsonb_build_object(
          'observed_session_id', n.observed_session_id,
          'delivered_session_id', n.delivered_session_id,
          'segment_id', n.segment_id,
          'lap_number', n.lap_number,
          'started_at', n.started_at,
          'ended_at', n.ended_at,
          'aggregation_version', n.aggregation_version,
          'complete', n.complete,
          'invalid_reasons', n.invalid_reasons,
          'pit_lap', n.pit_lap,
          'driver_changed', n.driver_changed,
          'track_temp_c_mean', n.track_temp_c_mean,
          'track_temp_c_min', n.track_temp_c_min,
          'track_temp_c_max', n.track_temp_c_max,
          'air_temp_c_mean', n.air_temp_c_mean,
          'fuel_start_litres', n.fuel_start_litres,
          'fuel_end_litres', n.fuel_end_litres,
          'fuel_level_integral_litre_seconds', n.fuel_level_integral_litre_seconds,
          'fuel_added_litres_observed', n.fuel_added_litres_observed,
          'abs_lat_accel_integral_g_seconds', n.abs_lat_accel_integral_g_seconds,
          'lat_accel_squared_integral_g2_seconds', n.lat_accel_squared_integral_g2_seconds,
          'max_abs_lat_accel_g', n.max_abs_lat_accel_g,
          'abs_long_accel_integral_g_seconds', n.abs_long_accel_integral_g_seconds,
          'valid_duration_seconds', n.valid_duration_seconds,
          'sample_count', n.sample_count,
          'max_gap_seconds', n.max_gap_seconds,
          'coverage', n.coverage
        ))
      )), '[]'::jsonb)
      FROM new_rows n)
  );
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'pitwall_learning capture skipped' USING ERRCODE = 'PWL01';
  RETURN NULL;
END
$fn$;

CREATE FUNCTION pitwall_learning.capture_lap_summaries_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
SET lock_timeout = '50ms'
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pitwall_learning.runtime_settings rs
     WHERE rs.id = 1 AND rs.capture_enabled
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM pitwall_learning.capture_source_batch(
    'lap_summary',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'device_id', n.device_id,
        'source_uid', n.summary_uid,
        'record_revision', n.record_revision,
        'content_hash', n.content_hash,
        'observed_at', coalesce(n.started_at, n.ended_at),
        'source_received_at', n.received_at,
        'payload', jsonb_strip_nulls(jsonb_build_object(
          'observed_session_id', n.observed_session_id,
          'delivered_session_id', n.delivered_session_id,
          'segment_id', n.segment_id,
          'lap_number', n.lap_number,
          'started_at', n.started_at,
          'ended_at', n.ended_at,
          'aggregation_version', n.aggregation_version,
          'complete', n.complete,
          'invalid_reasons', n.invalid_reasons,
          'pit_lap', n.pit_lap,
          'driver_changed', n.driver_changed,
          'track_temp_c_mean', n.track_temp_c_mean,
          'track_temp_c_min', n.track_temp_c_min,
          'track_temp_c_max', n.track_temp_c_max,
          'air_temp_c_mean', n.air_temp_c_mean,
          'fuel_start_litres', n.fuel_start_litres,
          'fuel_end_litres', n.fuel_end_litres,
          'fuel_level_integral_litre_seconds', n.fuel_level_integral_litre_seconds,
          'fuel_added_litres_observed', n.fuel_added_litres_observed,
          'abs_lat_accel_integral_g_seconds', n.abs_lat_accel_integral_g_seconds,
          'lat_accel_squared_integral_g2_seconds', n.lat_accel_squared_integral_g2_seconds,
          'max_abs_lat_accel_g', n.max_abs_lat_accel_g,
          'abs_long_accel_integral_g_seconds', n.abs_long_accel_integral_g_seconds,
          'valid_duration_seconds', n.valid_duration_seconds,
          'sample_count', n.sample_count,
          'max_gap_seconds', n.max_gap_seconds,
          'coverage', n.coverage
        ))
      )), '[]'::jsonb)
      FROM new_rows n
      JOIN old_rows o ON o.id = n.id
     WHERE (n.record_revision, n.content_hash)
           IS DISTINCT FROM (o.record_revision, o.content_hash))
  );
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'pitwall_learning capture skipped' USING ERRCODE = 'PWL01';
  RETURN NULL;
END
$fn$;

CREATE TRIGGER pitwall_learning_capture_event_ins
  AFTER INSERT ON public.simhub_measurement_events
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION pitwall_learning.capture_measurement_events_insert();

CREATE TRIGGER pitwall_learning_capture_event_upd
  AFTER UPDATE ON public.simhub_measurement_events
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION pitwall_learning.capture_measurement_events_update();

CREATE TRIGGER pitwall_learning_capture_lap_ins
  AFTER INSERT ON public.simhub_lap_summaries
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION pitwall_learning.capture_lap_summaries_insert();

CREATE TRIGGER pitwall_learning_capture_lap_upd
  AFTER UPDATE ON public.simhub_lap_summaries
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION pitwall_learning.capture_lap_summaries_update();


-- ---------------------------------------------------------------------------
-- 10. Worker-API. Alleen deze vier functies worden aan de workerrol gegund.
--     Zij zijn SECURITY DEFINER met een gepinde search_path en geven nooit
--     tabelrechten. Claim/export/finish controleren workerflag, owner en
--     policyversie opnieuw; een ingetrokken policy of verwijderde owner
--     levert geen data en geen materialisatie.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pitwall_learning.enqueue_job(
  p_source_revision_id uuid,
  p_kind text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_source_revision_id IS NULL THEN
    RAISE EXCEPTION 'source_revision_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('source_validate', 'example_build') THEN
    RAISE EXCEPTION 'invalid job kind' USING ERRCODE = '22023';
  END IF;

  INSERT INTO pitwall_learning.jobs (source_revision_id, kind)
  VALUES (p_source_revision_id, p_kind)
  ON CONFLICT (source_revision_id, kind) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT j.id INTO v_id
      FROM pitwall_learning.jobs j
     WHERE j.source_revision_id = p_source_revision_id
       AND j.kind = p_kind;
  END IF;
  RETURN v_id;
END
$fn$;

CREATE FUNCTION pitwall_learning.claim_jobs(
  p_limit integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
DECLARE
  v_enabled boolean;
  v_out jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF session_user NOT IN ('pitwall_learning_worker', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'not a pitwall learning worker' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'limit must be between 1 and 20' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 5 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'lease must be between 5 and 300 seconds' USING ERRCODE = '22023';
  END IF;

  SELECT rs.worker_enabled INTO v_enabled
    FROM pitwall_learning.runtime_settings rs
   WHERE rs.id = 1;
  IF v_enabled IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Een job die zijn maximum al heeft bereikt en niet meer leased is, gaat
  -- naar dead-letter in plaats van voor altijd opnieuw aangeboden te worden.
  -- Deze sweep is begrensd (LIMIT) en slaat rijen over die een andere sessie
  -- vasthoudt (SKIP LOCKED). Zonder die twee grenzen zou één gelockte
  -- dead-letter-rij elke claim van een andere, gezonde job blokkeren en zou
  -- de sweep zelf onbegrensd zijn.
  WITH exhausted AS (
    SELECT j.id
      FROM pitwall_learning.jobs j
     WHERE j.status IN ('pending', 'leased')
       AND j.attempts >= j.max_attempts
       AND (j.status = 'pending' OR j.lease_expires_at <= v_now)
     ORDER BY j.lease_expires_at NULLS FIRST, j.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 50
  )
  UPDATE pitwall_learning.jobs j
     SET status = 'dead',
         last_error_code = coalesce(j.last_error_code, 'attempts_exhausted'),
         lease_token = NULL,
         lease_owner = NULL,
         lease_expires_at = NULL,
         finished_at = v_now,
         updated_at = v_now
    FROM exhausted e
   WHERE j.id = e.id;

  -- Alleen jobs waarvan de bron (revisie of batch) nog steeds een bestaande
  -- owner, een bestaande policy en dezelfde policyversie heeft. Een
  -- ingetrokken policy, een gewijzigde policyversie of een verwijderde owner
  -- maakt de job niet claimbaar; het bewijs blijft intussen immutable bewaard.
  WITH candidates AS (
    SELECT j.id
      FROM pitwall_learning.jobs j
      LEFT JOIN pitwall_learning.source_revisions r ON r.id = j.source_revision_id
      LEFT JOIN pitwall_learning.capture_batches b ON b.id = j.capture_batch_id
      JOIN auth.users u ON u.id = coalesce(r.owner_user_id, b.owner_user_id)
      JOIN pitwall_learning.account_policy ap
        ON ap.owner_user_id = coalesce(r.owner_user_id, b.owner_user_id)
     WHERE j.status IN ('pending', 'leased')
       AND j.attempts < j.max_attempts
       AND j.next_attempt_at <= v_now
       AND (j.status = 'pending' OR j.lease_expires_at <= v_now)
       AND ap.capture_enabled
       AND ap.policy_version = coalesce(r.account_policy_version,
                                        b.account_policy_version)
       AND (
         (j.kind IN ('source_validate', 'example_build') AND r.id IS NOT NULL)
         OR
         (j.kind = 'materialize_capture_batch' AND b.id IS NOT NULL
          AND b.materialized_at IS NULL)
       )
     ORDER BY j.next_attempt_at, j.created_at
     FOR UPDATE OF j SKIP LOCKED
     LIMIT p_limit
  ), claimed AS (
    UPDATE pitwall_learning.jobs j
       SET status = 'leased',
           attempts = j.attempts + 1,
           lease_token = gen_random_uuid(),
           lease_owner = session_user || ':' || pg_backend_pid()::text,
           lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
           updated_at = v_now
      FROM candidates c
     WHERE j.id = c.id
     RETURNING j.id, j.source_revision_id, j.capture_batch_id, j.kind,
               j.attempts, j.max_attempts, j.lease_token, j.lease_expires_at,
               j.next_attempt_at
  )
  SELECT coalesce(
           jsonb_agg(jsonb_build_object(
             'job_id', c.id,
             'source_revision_id', c.source_revision_id,
             'capture_batch_id', c.capture_batch_id,
             'kind', c.kind,
             'attempts', c.attempts,
             'max_attempts', c.max_attempts,
             'lease_token', c.lease_token,
             'lease_expires_at', c.lease_expires_at
           ) ORDER BY c.next_attempt_at, c.id),
           '[]'::jsonb)
    INTO v_out
    FROM claimed c;

  RETURN v_out;
END
$fn$;

CREATE FUNCTION pitwall_learning.finish_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
DECLARE
  v_job pitwall_learning.jobs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_next timestamptz;
  v_code text;
  v_enabled boolean;
  v_owner uuid;
  v_rev_version integer;
  v_capture boolean;
  v_policy_version integer;
BEGIN
  IF session_user NOT IN ('pitwall_learning_worker', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'not a pitwall learning worker' USING ERRCODE = '42501';
  END IF;
  -- NULL is geen geldige uitkomst. Zonder deze expliciete check zou
  -- `NULL NOT IN (...)` NULL opleveren, de foutcontrole overslaan en de job
  -- stilzwijgend als retry wegzetten.
  IF p_outcome IS NULL OR p_outcome NOT IN ('done', 'retry') THEN
    RAISE EXCEPTION 'outcome must be done or retry' USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NOT NULL AND p_error_code !~ '^[a-z0-9_.:-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid error code' USING ERRCODE = '22023';
  END IF;

  -- Begrensd: nooit wachten op een rij die een andere afwerker vasthoudt.
  -- NOWAIT geeft direct een vaste uitkomst zonder details; de job blijft
  -- leased en de token blijft geldig.
  BEGIN
    SELECT * INTO v_job
      FROM pitwall_learning.jobs j
     WHERE j.id = p_job_id
     FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_busy');
  END;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_job.status <> 'leased' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_leased');
  END IF;
  IF v_job.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_mismatch');
  END IF;
  IF v_job.lease_expires_at <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired');
  END IF;

  -- Workerflag en (voor een done) de actuele owner/policy worden opnieuw
  -- gecontroleerd. Retry mag opruimen, done nooit na opt-out/verwijdering.
  SELECT rs.worker_enabled INTO v_enabled
    FROM pitwall_learning.runtime_settings rs
   WHERE rs.id = 1;
  IF v_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'worker_disabled');
  END IF;

  IF v_job.kind = 'materialize_capture_batch' AND p_outcome = 'done' THEN
    -- Alleen materialize_capture_batch() mag dit bewijs zetten en de job
    -- afronden. Een worker kan de batch dus nooit als done afvinken.
    RETURN jsonb_build_object('ok', false, 'error', 'materialization_required');
  END IF;

  IF p_outcome = 'done' AND v_job.kind IN ('source_validate', 'example_build') THEN
    SELECT r.owner_user_id, r.account_policy_version
      INTO v_owner, v_rev_version
      FROM pitwall_learning.source_revisions r
     WHERE r.id = v_job.source_revision_id;
    IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_owner) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'owner_missing');
    END IF;
    SELECT ap.capture_enabled, ap.policy_version
      INTO v_capture, v_policy_version
      FROM pitwall_learning.account_policy ap
     WHERE ap.owner_user_id = v_owner;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'policy_missing');
    END IF;
    IF v_capture IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'policy_revoked');
    END IF;
    IF v_policy_version IS DISTINCT FROM v_rev_version THEN
      RETURN jsonb_build_object('ok', false, 'error', 'policy_version_mismatch');
    END IF;
  END IF;

  IF p_outcome = 'done' THEN
    UPDATE pitwall_learning.jobs j
       SET status = 'done',
           lease_token = NULL,
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = NULL,
           updated_at = v_now,
           finished_at = v_now
     WHERE j.id = p_job_id;
    RETURN jsonb_build_object('ok', true, 'status', 'done',
                              'attempts', v_job.attempts);
  END IF;

  v_code := coalesce(p_error_code, 'worker_reported');

  IF v_job.attempts >= v_job.max_attempts THEN
    UPDATE pitwall_learning.jobs j
       SET status = 'dead',
           lease_token = NULL,
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = v_code,
           updated_at = v_now,
           finished_at = v_now
     WHERE j.id = p_job_id;
    RETURN jsonb_build_object('ok', true, 'status', 'dead',
                              'attempts', v_job.attempts,
                              'error_code', v_code);
  END IF;

  v_next := v_now + make_interval(
    secs => least(300, 5 * power(2, v_job.attempts - 1))::integer
  );

  UPDATE pitwall_learning.jobs j
     SET status = 'pending',
         lease_token = NULL,
         lease_owner = NULL,
         lease_expires_at = NULL,
         last_error_code = v_code,
         next_attempt_at = v_next,
         updated_at = v_now
   WHERE j.id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'status', 'pending',
                            'attempts', v_job.attempts,
                            'error_code', v_code,
                            'next_attempt_at', v_next);
END
$fn$;

CREATE FUNCTION pitwall_learning.worker_get_revision(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
DECLARE
  v_enabled boolean;
  v_out jsonb;
BEGIN
  IF session_user NOT IN ('pitwall_learning_worker', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'not a pitwall learning worker' USING ERRCODE = '42501';
  END IF;

  -- Fail-closed: de export is alleen geldig zolang de workerflag aan staat en
  -- het huidige accountbeleid deze revisie nog steeds dekt. Een ingetrokken
  -- policy, een gewijzigde policyversie of een verwijderde owner geeft NULL,
  -- geen payload. De immutable rij zelf blijft bewaard.
  SELECT rs.worker_enabled INTO v_enabled
    FROM pitwall_learning.runtime_settings rs
   WHERE rs.id = 1;
  IF v_enabled IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'id', r.id,
           'source_kind', r.source_kind,
           'source_uid', r.source_uid,
           'record_revision', r.record_revision,
           'content_hash', r.content_hash,
           'observed_at', r.observed_at,
           'server_receipt_at', r.server_receipt_at,
           'as_of_quality', r.as_of_quality,
           'context_status', r.context_status,
           'quality_reasons', r.quality_reasons,
           'payload', r.payload
         )
    INTO v_out
    FROM pitwall_learning.source_revisions r
    JOIN auth.users u ON u.id = r.owner_user_id
    JOIN pitwall_learning.account_policy ap ON ap.owner_user_id = r.owner_user_id
   WHERE r.id = p_revision_id
     AND ap.capture_enabled
     AND ap.policy_version = r.account_policy_version;

  RETURN v_out;
END
$fn$;

CREATE FUNCTION pitwall_learning.materialize_capture_batch(
  p_job_id uuid,
  p_lease_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
DECLARE
  v_job pitwall_learning.jobs%ROWTYPE;
  v_batch pitwall_learning.capture_batches%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_enabled boolean;
  v_owner uuid;
  v_capture boolean;
  v_policy_version integer;
  v_invalid integer;
  v_expected integer;
  v_inserted integer;
  v_jobs_inserted integer;
  v_missing integer;
  v_missing_jobs integer;
  v_updated integer;
BEGIN
  IF p_job_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'job id and lease token are required' USING ERRCODE = '22023';
  END IF;
  IF session_user NOT IN ('pitwall_learning_worker', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'not a pitwall learning worker' USING ERRCODE = '42501';
  END IF;

  SELECT rs.worker_enabled INTO v_enabled
    FROM pitwall_learning.runtime_settings rs
   WHERE rs.id = 1;
  IF v_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'worker_disabled');
  END IF;

  -- Begrensd: nooit wachten op een rij die een andere afwerker vasthoudt.
  BEGIN
    SELECT * INTO v_job
      FROM pitwall_learning.jobs j
     WHERE j.id = p_job_id
     FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_busy');
  END;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_job.status <> 'leased' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_leased');
  END IF;
  IF v_job.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_mismatch');
  END IF;
  IF v_job.lease_expires_at <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired');
  END IF;
  IF v_job.kind <> 'materialize_capture_batch' OR v_job.capture_batch_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_kind');
  END IF;

  BEGIN
    SELECT * INTO v_batch
      FROM pitwall_learning.capture_batches b
     WHERE b.id = v_job.capture_batch_id
     FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'error', 'batch_busy');
  END;

  IF v_batch.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'batch_not_found');
  END IF;

  -- Gebruik uitsluitend de bevroren receipt-owner. Nooit een latere
  -- simhub_devices.owner_user_id opzoeken of als recht gebruiken.
  v_owner := v_batch.owner_user_id;
  IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_owner) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_missing');
  END IF;

  SELECT ap.capture_enabled, ap.policy_version
    INTO v_capture, v_policy_version
    FROM pitwall_learning.account_policy ap
   WHERE ap.owner_user_id = v_owner;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'policy_missing');
  END IF;
  IF v_capture IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'policy_revoked');
  END IF;
  IF v_policy_version IS DISTINCT FROM v_batch.account_policy_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'policy_version_mismatch');
  END IF;

  -- Een al voltooide batch is idempotent; de job krijgt alsnog zijn done.
  IF v_batch.materialized_at IS NOT NULL THEN
    UPDATE pitwall_learning.jobs j
       SET status = 'done',
           lease_token = NULL,
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = NULL,
           updated_at = v_now,
           finished_at = v_now
     WHERE j.id = p_job_id
       AND j.status = 'leased'
       AND j.lease_token = p_lease_token;
    RETURN jsonb_build_object('ok', true, 'status', 'done',
                              'already_materialized', true,
                              'batch_id', v_batch.id,
                              'items', v_batch.item_count);
  END IF;

  -- Valideer de volledige batch vóór er iets geschreven wordt. Een corrupte
  -- of half geschreven batch levert nooit een gedeeltelijke projectie.
  SELECT count(*) INTO v_invalid
    FROM jsonb_array_elements(v_batch.payload) e
   WHERE jsonb_typeof(e) <> 'object'
      OR e->>'device_id' IS NULL
      OR char_length(e->>'device_id') NOT BETWEEN 1 AND 120
      OR (e->>'device_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR e->>'source_uid' IS NULL
      OR (e->>'source_uid') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR e->>'record_revision' IS NULL
      OR (e->>'record_revision') !~ '^[0-9]{1,6}$'
      OR (e->>'record_revision')::integer NOT BETWEEN 1 AND 100000
      OR e->>'content_hash' IS NULL
      OR (e->>'content_hash') !~ '^[0-9a-f]{32}$'
      OR e->'payload' IS NULL
      OR jsonb_typeof(e->'payload') <> 'object'
      OR pg_column_size(e->'payload') > 16384;
  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'capture batch contains invalid items' USING ERRCODE = 'PWL20';
  END IF;

  -- Per-source identiteit: de vijfdelige key blijft idempotent. De
  -- kwalificatie (stale/conflict) wordt hier, niet in de ingest, berekend.
  WITH items AS (
    SELECT u.ord,
           e->>'device_id' AS device_id,
           (e->>'source_uid')::uuid AS source_uid,
           (e->>'record_revision')::integer AS record_revision,
           e->>'content_hash' AS content_hash,
           nullif(e->>'observed_at', '')::timestamptz AS observed_at,
           coalesce(nullif(e->>'source_received_at', '')::timestamptz,
                    v_batch.received_at) AS source_received_at,
           e->'payload' AS payload
      FROM jsonb_array_elements(v_batch.payload) WITH ORDINALITY AS u(e, ord)
  ), history AS (
    SELECT r.device_id, r.source_uid, r.record_revision, r.content_hash
      FROM pitwall_learning.source_revisions r
     WHERE r.source_kind = v_batch.source_kind
       AND (r.device_id, r.source_uid) IN
           (SELECT i.device_id, i.source_uid FROM items i)
    UNION ALL
    SELECT i.device_id, i.source_uid, i.record_revision, i.content_hash
      FROM items i
  ), hist AS (
    SELECT i.ord,
           bool_or(h.record_revision > i.record_revision) AS stale,
           bool_or(h.record_revision = i.record_revision
                   AND h.content_hash IS DISTINCT FROM i.content_hash) AS conflict
      FROM items i
      JOIN history h
        ON h.device_id = i.device_id
       AND h.source_uid = i.source_uid
     GROUP BY i.ord
  )
  INSERT INTO pitwall_learning.source_revisions (
    capture_batch_id, source_kind, device_id, source_uid, record_revision,
    content_hash, observed_at, source_received_at, server_receipt_at,
    receipt_commit_visible, as_of_quality, owner_user_id, owner_basis,
    account_policy_version, canonical_context, context_status,
    training_eligible, extractor_version, payload, quality_reasons
  )
  SELECT
    v_batch.id, v_batch.source_kind, i.device_id, i.source_uid, i.record_revision,
    i.content_hash, i.observed_at, i.source_received_at, v_batch.received_at,
    false, 'as_of_unverifiable', v_batch.owner_user_id, v_batch.owner_basis,
    v_batch.account_policy_version, NULL, 'blocked_missing_identity',
    false, v_batch.extractor_version, i.payload,
    ARRAY[
      'car_unknown',
      'track_unknown',
      'compound_unknown',
      'historical_owner_unverified',
      'owner_at_receipt_only',
      'driver_identity_unverified',
      'context_incomplete',
      'non_training_eligible',
      'as_of_unverifiable',
      'server_receipt_precommit'
    ]::text[]
    || CASE WHEN i.observed_at IS NULL
            THEN ARRAY['observed_at_missing']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN i.observed_at > i.source_received_at + interval '5 seconds'
            THEN ARRAY['clock_skew']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN i.observed_at IS NOT NULL
             AND i.source_received_at - i.observed_at > interval '5 minutes'
            THEN ARRAY['late_delivery']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN coalesce(h.stale, false)
            THEN ARRAY['stale_revision_delivered_late']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN coalesce(h.conflict, false)
            THEN ARRAY['source_hash_revision_conflict']::text[] ELSE ARRAY[]::text[] END
    FROM items i
    LEFT JOIN hist h ON h.ord = i.ord
   ON CONFLICT (source_kind, device_id, source_uid, record_revision, content_hash)
   DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Per gematerialiseerde identiteit precies één source_validate-job. Ook
  -- wanneer de revisie al bestond (idempotente replay) wordt de job niet
  -- gedupliceerd.
  WITH items AS (
    SELECT u.ord,
           e->>'device_id' AS device_id,
           (e->>'source_uid')::uuid AS source_uid,
           (e->>'record_revision')::integer AS record_revision,
           e->>'content_hash' AS content_hash
      FROM jsonb_array_elements(v_batch.payload) WITH ORDINALITY AS u(e, ord)
  )
  INSERT INTO pitwall_learning.jobs (source_revision_id, kind)
  SELECT DISTINCT r.id, 'source_validate'
    FROM items i
    JOIN pitwall_learning.source_revisions r
      ON r.source_kind = v_batch.source_kind
     AND r.device_id = i.device_id
     AND r.source_uid = i.source_uid
     AND r.record_revision = i.record_revision
     AND r.content_hash = i.content_hash
  ON CONFLICT (source_revision_id, kind) DO NOTHING;
  GET DIAGNOSTICS v_jobs_inserted = ROW_COUNT;

  -- Bewijs: ieder item moet als revisie bestaan en iedere revisie moet een
  -- source_validate-job hebben. Pas daarna mag de batch done worden.
  WITH items AS (
    SELECT u.ord,
           e->>'device_id' AS device_id,
           (e->>'source_uid')::uuid AS source_uid,
           (e->>'record_revision')::integer AS record_revision,
           e->>'content_hash' AS content_hash
      FROM jsonb_array_elements(v_batch.payload) WITH ORDINALITY AS u(e, ord)
  ), distinct_items AS (
    SELECT DISTINCT device_id, source_uid, record_revision, content_hash FROM items
  )
  SELECT count(*)::integer,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM pitwall_learning.source_revisions r
            WHERE r.source_kind = v_batch.source_kind
              AND r.device_id = d.device_id
              AND r.source_uid = d.source_uid
              AND r.record_revision = d.record_revision
              AND r.content_hash = d.content_hash
         ))::integer
    INTO v_expected, v_missing
    FROM distinct_items d;

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'materialization incomplete: % of % identities missing',
      v_missing, v_expected USING ERRCODE = 'PWL21';
  END IF;

  WITH items AS (
    SELECT u.ord,
           e->>'device_id' AS device_id,
           (e->>'source_uid')::uuid AS source_uid,
           (e->>'record_revision')::integer AS record_revision,
           e->>'content_hash' AS content_hash
      FROM jsonb_array_elements(v_batch.payload) WITH ORDINALITY AS u(e, ord)
  ), distinct_items AS (
    SELECT DISTINCT device_id, source_uid, record_revision, content_hash FROM items
  )
  SELECT count(*)::integer INTO v_missing_jobs
    FROM distinct_items d
    JOIN pitwall_learning.source_revisions r
      ON r.source_kind = v_batch.source_kind
     AND r.device_id = d.device_id
     AND r.source_uid = d.source_uid
     AND r.record_revision = d.record_revision
     AND r.content_hash = d.content_hash
   WHERE NOT EXISTS (
     SELECT 1 FROM pitwall_learning.jobs j
      WHERE j.source_revision_id = r.id
        AND j.kind = 'source_validate'
   );

  IF v_missing_jobs > 0 THEN
    RAISE EXCEPTION 'materialization incomplete: % source jobs missing',
      v_missing_jobs USING ERRCODE = 'PWL22';
  END IF;

  -- Materiaalbewijs en job-done in dezelfde transactie. De jobtrigger
  -- controleert dat dit bewijs al aanwezig is.
  UPDATE pitwall_learning.capture_batches
     SET materialized_at = v_now,
         materialized_items = v_batch.item_count
   WHERE id = v_batch.id
     AND materialized_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'batch materialization proof not recorded' USING ERRCODE = 'PWL23';
  END IF;

  UPDATE pitwall_learning.jobs j
     SET status = 'done',
         lease_token = NULL,
         lease_owner = NULL,
         lease_expires_at = NULL,
         last_error_code = NULL,
         updated_at = v_now,
         finished_at = v_now
   WHERE j.id = p_job_id
     AND j.status = 'leased'
     AND j.lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'materialize job could not be completed' USING ERRCODE = 'PWL24';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'done',
    'batch_id', v_batch.id,
    'items', v_batch.item_count,
    'identities', v_expected,
    'inserted', v_inserted,
    'jobs_inserted', v_jobs_inserted
  );
END
$fn$;

-- ---------------------------------------------------------------------------
-- 11. Sluit alle standaardrechten. Eerst alles intrekken, daarna alleen de
--     vier workerfuncties en schema-USAGE voor de workerrol teruggeven.
--     anon/authenticated/service_role krijgen nul rechten in dit schema.
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA pitwall_learning
  FROM PUBLIC, anon, authenticated, service_role, pitwall_learning_worker;

GRANT USAGE ON SCHEMA pitwall_learning TO pitwall_learning_worker;

REVOKE ALL ON ALL TABLES IN SCHEMA pitwall_learning
  FROM PUBLIC, anon, authenticated, service_role, pitwall_learning_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pitwall_learning
  FROM PUBLIC, anon, authenticated, service_role, pitwall_learning_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pitwall_learning
  FROM PUBLIC, anon, authenticated, service_role, pitwall_learning_worker;

GRANT EXECUTE ON FUNCTION pitwall_learning.claim_jobs(integer, integer)
  TO pitwall_learning_worker;
GRANT EXECUTE ON FUNCTION pitwall_learning.finish_job(uuid, uuid, text, text)
  TO pitwall_learning_worker;
GRANT EXECUTE ON FUNCTION pitwall_learning.worker_get_revision(uuid)
  TO pitwall_learning_worker;
GRANT EXECUTE ON FUNCTION pitwall_learning.materialize_capture_batch(uuid, uuid)
  TO pitwall_learning_worker;

-- Defense-in-depth voor defaults die ooit per rol/schema zijn gezet. Let op:
-- ALTER DEFAULT PRIVILEGES kan de ingebouwde, globale PostgreSQL-defaults
-- NIET intrekken. Een REVOKE op een default-ACL die nooit is gezet, is een
-- no-op; er ontstaat geen "negatieve" default. Nieuwe functies die hier later
-- door supabase_admin (of een andere rol) worden aangemaakt, krijgen dus
-- gewoon PUBLIC EXECUTE tenzij de aanmakende migratie dat expliciet
-- intrekt. Deze statements zijn daarom GEEN sluitende garantie voor
-- toekomstige objecten: elke latere toevoeging moet vóór COMMIT expliciet
-- REVOKE ALL krijgen, net als de objecten hierboven. De probe in
-- supabase/tests/pitwall-learning-schema.sql bewijst dat onderscheid.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA pitwall_learning
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA pitwall_learning
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA pitwall_learning
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
