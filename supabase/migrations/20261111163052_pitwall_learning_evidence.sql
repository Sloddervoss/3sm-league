-- ============================================================================
-- 2026-11-11 — Pitwall learning P1: private bewijsopslag, bronrevisiecapture
-- en begrensde jobleases (T06/T07/T08)
--
-- Scope:
--   * nieuw, privé schema pitwall_learning (owner supabase_admin);
--   * immutable source_revisions uit precies twee bestaande brontabellen;
--   * jobs met lease/token/expiry/backoff/dead-letter (max 3 pogingen);
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
-- 9. Capture. Eén gedeelde, private helper doet de poort (global capture +
--    expliciete per-account policy), de owner-at-receipt-resolutie en de
--    idempotente insert. De triggerfuncties bouwen alleen een kleine
--    allowlisted payload; geen volledig frame, geen note, geen driver_name,
--    geen tokens en geen raw JSON.
-- ---------------------------------------------------------------------------
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
AS $fn$
DECLARE
  v_capture boolean;
  v_policy_version integer;
  v_owner uuid;
  v_reasons text[];
  v_received timestamptz := coalesce(p_source_received_at, clock_timestamp());
  v_id uuid;
BEGIN
  IF p_source_kind NOT IN ('measurement_event', 'lap_summary') THEN
    RAISE EXCEPTION 'invalid source kind' USING ERRCODE = 'PWL10';
  END IF;

  -- Globaal én per account expliciet aan. Ontbrekende policy betekent niet
  -- "ingeschreven": er wordt niets vastgelegd.
  SELECT rs.capture_enabled INTO v_capture
    FROM pitwall_learning.runtime_settings rs
   WHERE rs.id = 1;
  IF v_capture IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  -- device_id is in de bron TEXT; simhub_devices.id is UUID. Alleen een
  -- bewezen UUID-tekst wordt gecast. Nooit blind TEXT naar UUID.
  IF p_device_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT d.owner_user_id INTO v_owner
      FROM public.simhub_devices d
     WHERE d.id = p_device_id::uuid;
  END IF;
  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ap.capture_enabled, ap.policy_version
    INTO v_capture, v_policy_version
    FROM pitwall_learning.account_policy ap
   WHERE ap.owner_user_id = v_owner;
  IF v_capture IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be an object' USING ERRCODE = 'PWL11';
  END IF;
  IF pg_column_size(p_payload) > 16384 THEN
    RAISE EXCEPTION 'payload exceeds 16 KiB' USING ERRCODE = 'PWL12';
  END IF;

  -- Context is in P1 aantoonbaar onvolledig. Geen defaults, geen 100%- of
  -- false-waarden en geen kopie uit een latere latest-snapshot.
  v_reasons := ARRAY[
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
  ];

  IF p_observed_at IS NULL THEN
    v_reasons := array_append(v_reasons, 'observed_at_missing');
  ELSE
    IF p_observed_at > v_received + interval '5 seconds' THEN
      v_reasons := array_append(v_reasons, 'clock_skew');
    END IF;
    IF v_received - p_observed_at > interval '5 minutes' THEN
      v_reasons := array_append(v_reasons, 'late_delivery');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pitwall_learning.source_revisions r
     WHERE r.source_kind = p_source_kind
       AND r.device_id = p_device_id
       AND r.source_uid = p_source_uid
       AND r.record_revision > p_record_revision
  ) THEN
    v_reasons := array_append(v_reasons, 'stale_revision_delivered_late');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pitwall_learning.source_revisions r
     WHERE r.source_kind = p_source_kind
       AND r.device_id = p_device_id
       AND r.source_uid = p_source_uid
       AND r.record_revision = p_record_revision
       AND r.content_hash <> p_content_hash
  ) THEN
    v_reasons := array_append(v_reasons, 'source_hash_revision_conflict');
  END IF;

  INSERT INTO pitwall_learning.source_revisions (
    source_kind, device_id, source_uid, record_revision, content_hash,
    observed_at, source_received_at, server_receipt_at, receipt_commit_visible,
    as_of_quality, owner_user_id, owner_basis, account_policy_version,
    canonical_context, context_status, training_eligible, extractor_version,
    payload, quality_reasons
  ) VALUES (
    p_source_kind, p_device_id, p_source_uid, p_record_revision, p_content_hash,
    p_observed_at, v_received, clock_timestamp(), false,
    'as_of_unverifiable', v_owner, 'device_owner_at_receipt', v_policy_version,
    NULL, 'blocked_missing_identity', false, 'pitwall-learning-p1-capture-1',
    p_payload, v_reasons
  )
  ON CONFLICT (source_kind, device_id, source_uid, record_revision, content_hash)
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO pitwall_learning.jobs (source_revision_id, kind)
    VALUES (v_id, 'source_validate')
    ON CONFLICT (source_revision_id, kind) DO NOTHING;
  END IF;

  RETURN v_id;
END
$fn$;

CREATE FUNCTION pitwall_learning.capture_measurement_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
DECLARE
  v_old_lock text;
  v_payload jsonb;
BEGIN
  v_old_lock := current_setting('lock_timeout');

  BEGIN
    -- De capture mag de ingest nooit laten wachten. Alleen deze
    -- (sub)transactie krijgt 50 ms; daarna wordt de oude waarde hersteld.
    PERFORM set_config('lock_timeout', '50ms', true);

    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'kind', NEW.kind,
      'observed_session_id', NEW.observed_session_id,
      'delivered_session_id', NEW.delivered_session_id,
      'segment_id', NEW.segment_id,
      'observed_at', NEW.observed_at,
      'session_time_seconds', NEW.session_time_seconds,
      'sdk_tick', NEW.sdk_tick,
      'wear_before', NEW.wear_before,
      'wear_after', NEW.wear_after,
      'set_generation', NEW.set_generation,
      'confidence', NEW.confidence,
      'evidence', CASE WHEN NEW.evidence IS NULL THEN NULL
                       ELSE NEW.evidence - 'note' END
    ));

    PERFORM pitwall_learning.capture_source_revision(
      'measurement_event', NEW.device_id, NEW.event_uid,
      NEW.record_revision, NEW.content_hash, NEW.observed_at,
      NEW.received_at, v_payload
    );
  EXCEPTION WHEN others THEN
    -- Vaste code, geen payload, geen secrets, geen logtabelwrite in de
    -- handler. De bronschrijver en zijn ACK blijven ongewijzigd.
    RAISE WARNING 'pitwall_learning capture skipped' USING ERRCODE = 'PWL01';
  END;

  PERFORM set_config('lock_timeout', v_old_lock, true);
  RETURN NEW;
EXCEPTION WHEN others THEN
  BEGIN
    PERFORM set_config('lock_timeout', coalesce(v_old_lock, '0'), true);
  EXCEPTION WHEN others THEN
    NULL;
  END;
  RAISE WARNING 'pitwall_learning capture unavailable' USING ERRCODE = 'PWL03';
  RETURN NEW;
END
$fn$;

CREATE FUNCTION pitwall_learning.capture_lap_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
DECLARE
  v_old_lock text;
  v_payload jsonb;
BEGIN
  v_old_lock := current_setting('lock_timeout');

  BEGIN
    PERFORM set_config('lock_timeout', '50ms', true);

    -- Geen current_driver_name/id, geen note, geen raw coverage-input.
    -- Alleen de kleine, gevalideerde aggregatievelden.
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'observed_session_id', NEW.observed_session_id,
      'delivered_session_id', NEW.delivered_session_id,
      'segment_id', NEW.segment_id,
      'lap_number', NEW.lap_number,
      'started_at', NEW.started_at,
      'ended_at', NEW.ended_at,
      'aggregation_version', NEW.aggregation_version,
      'complete', NEW.complete,
      'invalid_reasons', NEW.invalid_reasons,
      'pit_lap', NEW.pit_lap,
      'driver_changed', NEW.driver_changed,
      'track_temp_c_mean', NEW.track_temp_c_mean,
      'track_temp_c_min', NEW.track_temp_c_min,
      'track_temp_c_max', NEW.track_temp_c_max,
      'air_temp_c_mean', NEW.air_temp_c_mean,
      'fuel_start_litres', NEW.fuel_start_litres,
      'fuel_end_litres', NEW.fuel_end_litres,
      'fuel_level_integral_litre_seconds', NEW.fuel_level_integral_litre_seconds,
      'fuel_added_litres_observed', NEW.fuel_added_litres_observed,
      'abs_lat_accel_integral_g_seconds', NEW.abs_lat_accel_integral_g_seconds,
      'lat_accel_squared_integral_g2_seconds', NEW.lat_accel_squared_integral_g2_seconds,
      'max_abs_lat_accel_g', NEW.max_abs_lat_accel_g,
      'abs_long_accel_integral_g_seconds', NEW.abs_long_accel_integral_g_seconds,
      'valid_duration_seconds', NEW.valid_duration_seconds,
      'sample_count', NEW.sample_count,
      'max_gap_seconds', NEW.max_gap_seconds,
      'coverage', NEW.coverage
    ));

    PERFORM pitwall_learning.capture_source_revision(
      'lap_summary', NEW.device_id, NEW.summary_uid,
      NEW.record_revision, NEW.content_hash,
      coalesce(NEW.started_at, NEW.ended_at), NEW.received_at, v_payload
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'pitwall_learning capture skipped' USING ERRCODE = 'PWL01';
  END;

  PERFORM set_config('lock_timeout', v_old_lock, true);
  RETURN NEW;
EXCEPTION WHEN others THEN
  BEGIN
    PERFORM set_config('lock_timeout', coalesce(v_old_lock, '0'), true);
  EXCEPTION WHEN others THEN
    NULL;
  END;
  RAISE WARNING 'pitwall_learning capture unavailable' USING ERRCODE = 'PWL03';
  RETURN NEW;
END
$fn$;

-- Alleen INSERT en een UPDATE die de revisie/hash werkelijk meeneemt. Een
-- latere received_at-write zonder nieuwe versie maakt geen schijnrevisie.
CREATE TRIGGER pitwall_learning_capture_event
  AFTER INSERT OR UPDATE OF record_revision, content_hash
  ON public.simhub_measurement_events
  FOR EACH ROW EXECUTE FUNCTION pitwall_learning.capture_measurement_event();

CREATE TRIGGER pitwall_learning_capture_lap
  AFTER INSERT OR UPDATE OF record_revision, content_hash
  ON public.simhub_lap_summaries
  FOR EACH ROW EXECUTE FUNCTION pitwall_learning.capture_lap_summary();

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
  UPDATE pitwall_learning.jobs j
     SET status = 'dead',
         last_error_code = coalesce(j.last_error_code, 'attempts_exhausted'),
         lease_token = NULL,
         lease_owner = NULL,
         lease_expires_at = NULL,
         finished_at = v_now,
         updated_at = v_now
   WHERE j.status IN ('pending', 'leased')
     AND j.attempts >= j.max_attempts
     AND (j.status = 'pending' OR j.lease_expires_at <= v_now);

  WITH candidates AS (
    SELECT j.id
      FROM pitwall_learning.jobs j
     WHERE j.status IN ('pending', 'leased')
       AND j.attempts < j.max_attempts
       AND j.next_attempt_at <= v_now
       AND (j.status = 'pending' OR j.lease_expires_at <= v_now)
     ORDER BY j.next_attempt_at, j.created_at
     FOR UPDATE SKIP LOCKED
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
  IF p_outcome NOT IN ('done', 'retry') THEN
    RAISE EXCEPTION 'outcome must be done or retry' USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NOT NULL AND p_error_code !~ '^[a-z0-9_.:-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid error code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
    FROM pitwall_learning.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF NOT FOUND THEN
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
  v_out jsonb;
BEGIN
  IF session_user NOT IN ('pitwall_learning_worker', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'not a pitwall learning worker' USING ERRCODE = '42501';
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
   WHERE r.id = p_revision_id;

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

-- Supabase's default privileges staan buiten dit schema; binnen dit nieuwe
-- schema worden ze expliciet geneutraliseerd voor toekomstige objecten.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA pitwall_learning
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA pitwall_learning
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA pitwall_learning
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
