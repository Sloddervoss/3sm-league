-- ============================================================================
-- 2026-11-11 — Pitwall learning P1: private bewijsopslag, bronrevisiecapture
-- en begrensde jobleases (T06/T07/T08)
--
-- Scope:
--   * nieuw, privé schema pitwall_learning (owner supabase_admin);
--   * immutable source_revisions uit precies twee bestaande brontabellen,
--     gevuld door vier statement-level capturetriggers (INSERT/UPDATE per
--     brontabel) met set-based, begrensde capture;
--   * jobs met lease/token/expiry/backoff/dead-letter (max 3 pogingen),
--     begrensde dead-letter-sweep en policygebonden claim/export;
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
-- 5. Immutable bronrevisies. De vijfdelige identiteit is
--    (source_kind, device_id, source_uid, record_revision, content_hash).
--    Iedere werkelijk geziene versie blijft staan; dezelfde versie opnieuw
--    zien is idempotent. Er wordt nooit een oudere revisie overschreven.
-- ---------------------------------------------------------------------------
CREATE TABLE pitwall_learning.source_revisions (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
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
  extractor_version        text        NOT NULL DEFAULT 'pitwall-learning-p1-capture-1',
  payload                  jsonb       NOT NULL,
  quality_reasons          text[]      NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_revisions_pkey PRIMARY KEY (id),
  CONSTRAINT source_revisions_identity_key UNIQUE
    (source_kind, device_id, source_uid, record_revision, content_hash),
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
  'Immutable captured source revisions. Five-part identity; old revisions are never overwritten. Every P1 row is context-blocked and non-training-eligible.';
COMMENT ON COLUMN pitwall_learning.source_revisions.server_receipt_at IS
  'Trigger time before COMMIT; not a first-visible/knownAt proof. receipt_commit_visible is false by construction.';
COMMENT ON COLUMN pitwall_learning.source_revisions.canonical_context IS
  'NULL in P1: no verified car/track/compound/historical-owner context exists for these source rows.';

CREATE INDEX source_revisions_owner_observed_idx
  ON pitwall_learning.source_revisions (owner_user_id, source_kind, observed_at DESC);
CREATE INDEX source_revisions_uid_idx
  ON pitwall_learning.source_revisions (source_kind, device_id, source_uid, record_revision DESC);

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
-- 6. Jobs: één job per (revision, kind), lease met token en expiry,
--    pogingen/backoff en dead-letter na maximaal drie pogingen.
-- ---------------------------------------------------------------------------
CREATE TABLE pitwall_learning.jobs (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  source_revision_id uuid       NOT NULL,
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
  CONSTRAINT jobs_revision_fkey FOREIGN KEY (source_revision_id)
    REFERENCES pitwall_learning.source_revisions(id) ON DELETE RESTRICT,
  CONSTRAINT jobs_kind_check CHECK (kind IN ('source_validate', 'example_build')),
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
  'Bounded worker queue. One job per revision/kind; lease token + expiry; at most three attempts then dead.';

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
--    alleen via de owner of via de drie SECURITY DEFINER-workerfuncties
--    bereikbaar. Er zijn geen auth-writes.
-- ---------------------------------------------------------------------------
ALTER TABLE pitwall_learning.runtime_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.account_policy     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.source_revisions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.jobs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.models             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.examples           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.predictions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.evaluations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitwall_learning.deployments        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 9. Capture. Eén set-based private helper doet de poort (global capture +
--    expliciete per-account policy), de owner-at-receipt-resolutie en de
--    idempotente insert voor een hele statementset. De statement-triggers
--    bouwen alleen een kleine allowlisted payload per rij; geen volledig
--    frame, geen note, geen driver_name, geen tokens en geen raw JSON.
--
--    Waarom statement-level: de ingest schrijft een batch in één INSERT (en
--    bij een nieuwe revisie één UPDATE). Een row-trigger zou per rij
--    dezelfde poort-SELECTs en EXISTS-checks doen; dat is onbegrensd werk
--    binnen de ingest-transactie. De trigger vuurt nu één keer per statement
--    en de helper schrijft de revisions en jobs in twee set-based statements.
--    De brontransactie, ACK, duplicaten en revisieclassificatie blijven
--    ongewijzigd: dit is alleen observatie na de schrijfactie.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pitwall_learning.capture_source_revisions(
  p_source_kind text,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
SET lock_timeout = '50ms'
AS $fn$
DECLARE
  v_jobs integer := 0;
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
    RETURN 0;
  END IF;

  -- Eén statement voor de hele set: per rij de owner-at-receipt, de echte
  -- policy (inclusief policyversie) en de bestaande revisiehistorie. De
  -- EXISTS-checks van de oude row-trigger zijn hier twee set-based
  -- aggregaten tegen dezelfde index.
  WITH input AS (
    SELECT x.value->>'device_id'                                   AS device_id,
           (x.value->>'source_uid')::uuid                          AS source_uid,
           (x.value->>'record_revision')::integer                   AS record_revision,
           x.value->>'content_hash'                                 AS content_hash,
           nullif(x.value->>'observed_at', '')::timestamptz         AS observed_at,
           coalesce(nullif(x.value->>'source_received_at', '')::timestamptz,
                    clock_timestamp())                            AS source_received_at,
           x.value->'payload'                                       AS payload
      FROM jsonb_array_elements(p_rows) x
  ), admitted AS (
    -- Alleen een bewezen UUID-tekst wordt gecast; nooit blind TEXT naar UUID.
    SELECT i.device_id, i.source_uid, i.record_revision, i.content_hash,
           i.observed_at, i.source_received_at, i.payload,
           d.owner_user_id, ap.policy_version
      FROM input i
      JOIN public.simhub_devices d
        ON d.id = CASE
                    WHEN i.device_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN i.device_id::uuid
                  END
      JOIN pitwall_learning.account_policy ap
        ON ap.owner_user_id = d.owner_user_id
       AND ap.capture_enabled
     WHERE i.payload IS NOT NULL
       AND jsonb_typeof(i.payload) = 'object'
       AND pg_column_size(i.payload) <= 16384
  ), hist AS (
    SELECT a.device_id, a.source_uid,
           bool_or(r.record_revision > a.record_revision) AS stale,
           bool_or(r.record_revision = a.record_revision
                   AND r.content_hash IS DISTINCT FROM a.content_hash) AS conflict
      FROM admitted a
      JOIN pitwall_learning.source_revisions r
        ON r.source_kind = p_source_kind
       AND r.device_id = a.device_id
       AND r.source_uid = a.source_uid
     GROUP BY a.device_id, a.source_uid
  ), ins AS (
    INSERT INTO pitwall_learning.source_revisions (
      source_kind, device_id, source_uid, record_revision, content_hash,
      observed_at, source_received_at, server_receipt_at, receipt_commit_visible,
      as_of_quality, owner_user_id, owner_basis, account_policy_version,
      canonical_context, context_status, training_eligible, extractor_version,
      payload, quality_reasons
    )
    SELECT
      p_source_kind, a.device_id, a.source_uid, a.record_revision, a.content_hash,
      a.observed_at, a.source_received_at, clock_timestamp(), false,
      'as_of_unverifiable', a.owner_user_id, 'device_owner_at_receipt', a.policy_version,
      NULL, 'blocked_missing_identity', false, 'pitwall-learning-p1-capture-1',
      a.payload,
      -- Context is in P1 aantoonbaar onvolledig. Geen defaults en geen
      -- 100%-/false-waarden; alleen expliciete redenen.
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
      || CASE WHEN a.observed_at IS NULL
              THEN ARRAY['observed_at_missing']::text[] ELSE ARRAY[]::text[] END
      || CASE WHEN a.observed_at > a.source_received_at + interval '5 seconds'
              THEN ARRAY['clock_skew']::text[] ELSE ARRAY[]::text[] END
      || CASE WHEN a.observed_at IS NOT NULL
               AND a.source_received_at - a.observed_at > interval '5 minutes'
              THEN ARRAY['late_delivery']::text[] ELSE ARRAY[]::text[] END
      || CASE WHEN coalesce(h.stale, false)
              THEN ARRAY['stale_revision_delivered_late']::text[] ELSE ARRAY[]::text[] END
      || CASE WHEN coalesce(h.conflict, false)
              THEN ARRAY['source_hash_revision_conflict']::text[] ELSE ARRAY[]::text[] END
      FROM admitted a
      LEFT JOIN hist h
        ON h.device_id = a.device_id AND h.source_uid = a.source_uid
    ON CONFLICT (source_kind, device_id, source_uid, record_revision, content_hash)
    DO NOTHING
    RETURNING id
  )
  INSERT INTO pitwall_learning.jobs (source_revision_id, kind)
  SELECT ins.id, 'source_validate' FROM ins
  ON CONFLICT (source_revision_id, kind) DO NOTHING;

  GET DIAGNOSTICS v_jobs = ROW_COUNT;
  RETURN v_jobs;
END
$fn$;

-- Smalle, expliciete single-row API voor tests en beheer. De triggers
-- gebruiken de set-based helper hierboven; deze wrapper houdt de bestaande
-- contractvorm (één revisie per aanroep) zonder de oude per-rij triggerpaden
-- terug te brengen.
CREATE FUNCTION pitwall_learning.capture_source_revision(
  p_source_kind text,
  p_device_id text,
  p_source_uid uuid,
  p_record_revision integer,
  p_content_hash text,
  p_observed_at timestamptz,
  p_source_received_at timestamptz,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
SET lock_timeout = '50ms'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pitwall_learning.capture_source_revisions(
    p_source_kind,
    jsonb_build_array(jsonb_build_object(
      'device_id', p_device_id,
      'source_uid', p_source_uid,
      'record_revision', p_record_revision,
      'content_hash', p_content_hash,
      'observed_at', p_observed_at,
      'source_received_at', p_source_received_at,
      'payload', p_payload
    ))
  );

  SELECT r.id INTO v_id
    FROM pitwall_learning.source_revisions r
   WHERE r.source_kind = p_source_kind
     AND r.device_id = p_device_id
     AND r.source_uid = p_source_uid
     AND r.record_revision = p_record_revision
     AND r.content_hash = p_content_hash;

  RETURN v_id;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 9a. Statement-triggers op events. Alleen INSERT en UPDATE; geen trigger op
--     frames, simhub_telemetry_latest, simhub_devices of andere tabellen.
--     Een UPDATE telt alleen als record_revision of content_hash werkelijk
--     verschilt; een latere received_at-write maakt geen schijnrevisie.
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

  PERFORM pitwall_learning.capture_source_revisions(
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

  PERFORM pitwall_learning.capture_source_revisions(
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

  PERFORM pitwall_learning.capture_source_revisions(
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

  PERFORM pitwall_learning.capture_source_revisions(
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
-- 10. Worker-API. Alleen deze drie functies worden aan de workerrol
--     gegund. Zij zijn SECURITY DEFINER met een gepinde search_path en
--     geven nooit tabelrechten.
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

  -- Alleen jobs waarvan de revision nog steeds een bestaande owner, een
  -- bestaande policy en dezelfde policyversie heeft. Een ingetrokken policy,
  -- een gewijzigde policyversie of een verwijderde owner maakt de job niet
  -- claimbaar; de capture-rij blijft intussen immutable bewaard.
  WITH candidates AS (
    SELECT j.id
      FROM pitwall_learning.jobs j
      JOIN pitwall_learning.source_revisions r ON r.id = j.source_revision_id
      JOIN auth.users u ON u.id = r.owner_user_id
      JOIN pitwall_learning.account_policy ap ON ap.owner_user_id = r.owner_user_id
     WHERE j.status IN ('pending', 'leased')
       AND j.attempts < j.max_attempts
       AND j.next_attempt_at <= v_now
       AND (j.status = 'pending' OR j.lease_expires_at <= v_now)
       AND ap.capture_enabled
       AND ap.policy_version = r.account_policy_version
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
     RETURNING j.id, j.source_revision_id, j.kind, j.attempts, j.max_attempts,
               j.lease_token, j.lease_expires_at, j.next_attempt_at
  )
  SELECT coalesce(
           jsonb_agg(jsonb_build_object(
             'job_id', c.id,
             'source_revision_id', c.source_revision_id,
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

-- ---------------------------------------------------------------------------
-- 11. Sluit alle standaardrechten. Eerst alles intrekken, daarna alleen de
--     drie workerfuncties en schema-USAGE voor de workerrol teruggeven.
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
