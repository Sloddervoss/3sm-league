-- Human-verified PayPal.Me contribution flow for Community Support.
-- Forward-only and inert until payment configuration is enabled by a Super-admin.

BEGIN;

CREATE TABLE public.community_support_payment_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  paypal_enabled BOOLEAN NOT NULL DEFAULT false,
  paypal_me_url TEXT NOT NULL DEFAULT '',
  suggested_amounts_eur NUMERIC(10,2)[] NOT NULL DEFAULT ARRAY[5.00, 10.00, 25.00]::NUMERIC(10,2)[],
  payment_admin_discord_id TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (paypal_me_url = '' OR paypal_me_url ~ '^https://(www\.)?paypal\.me/[A-Za-z0-9._-]{1,80}/?$'),
  CHECK (payment_admin_discord_id = '' OR payment_admin_discord_id ~ '^[0-9]{17,20}$'),
  CHECK (cardinality(suggested_amounts_eur) BETWEEN 1 AND 6)
);

INSERT INTO public.community_support_payment_config (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE public.community_support_payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_amount_eur NUMERIC(10,2) NOT NULL CHECK (requested_amount_eur BETWEEN 1 AND 1000),
  payer_name_private TEXT NOT NULL CHECK (char_length(payer_name_private) BETWEEN 1 AND 100),
  show_supporter_name BOOLEAN NOT NULL DEFAULT false,
  show_amount BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'not_found', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours'),
  discord_notified_at TIMESTAMPTZ,
  discord_message_id TEXT,
  notification_error TEXT,
  notification_claimed_at TIMESTAMPTZ,
  notification_claim_token UUID,
  notification_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notification_attempts INTEGER NOT NULL DEFAULT 0 CHECK (notification_attempts BETWEEN 0 AND 5),
  resolved_at TIMESTAMPTZ,
  resolved_by_discord_id TEXT,
  gross_amount_eur NUMERIC(10,2),
  fee_amount_eur NUMERIC(10,2),
  resolution_note TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 1 AND 500),
  CHECK (gross_amount_eur IS NULL OR gross_amount_eur BETWEEN 0.01 AND 1000),
  CHECK (fee_amount_eur IS NULL OR fee_amount_eur >= 0),
  CHECK (gross_amount_eur IS NULL OR fee_amount_eur IS NULL OR fee_amount_eur < gross_amount_eur)
);

CREATE UNIQUE INDEX community_support_one_pending_intent_per_user
  ON public.community_support_payment_intents (user_id)
  WHERE status = 'pending';
CREATE INDEX community_support_payment_intents_notification_queue_idx
  ON public.community_support_payment_intents (notification_next_attempt_at, created_at)
  WHERE status = 'pending' AND discord_notified_at IS NULL;

CREATE TABLE public.community_support_payment_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_payment_intent_id UUID NOT NULL REFERENCES public.community_support_payment_intents(id) ON DELETE RESTRICT,
  booked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  category TEXT NOT NULL CHECK (category IN ('contribution', 'payment_fee')),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 160),
  amount_eur NUMERIC(10,2) NOT NULL CHECK (amount_eur > 0),
  supporter_name TEXT,
  show_supporter_name BOOLEAN NOT NULL DEFAULT false,
  show_amount BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (source_payment_intent_id, category)
);

ALTER TABLE public.community_support_payment_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_payment_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.community_support_payment_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.community_support_payment_intents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.community_support_payment_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_support_payment_config TO service_role;
GRANT ALL ON public.community_support_payment_intents TO service_role;
GRANT ALL ON public.community_support_payment_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.get_community_support_payment_config()
RETURNS TABLE(paypal_enabled BOOLEAN, paypal_me_url TEXT, suggested_amounts_eur NUMERIC[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT
    cfg.paypal_enabled
      AND cfg.paypal_me_url <> ''
      AND cfg.payment_admin_discord_id <> '',
    CASE
      WHEN cfg.paypal_enabled AND cfg.paypal_me_url <> '' AND cfg.payment_admin_discord_id <> ''
      THEN regexp_replace(cfg.paypal_me_url, '/$', '')
      ELSE ''
    END,
    CASE
      WHEN cfg.paypal_enabled AND cfg.paypal_me_url <> '' AND cfg.payment_admin_discord_id <> ''
      THEN cfg.suggested_amounts_eur::NUMERIC[]
      ELSE ARRAY[]::NUMERIC[]
    END
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_community_support_payment_config()
RETURNS TABLE(paypal_enabled BOOLEAN, paypal_me_url TEXT, suggested_amounts_eur NUMERIC[], payment_admin_discord_id TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT cfg.paypal_enabled, cfg.paypal_me_url, cfg.suggested_amounts_eur::NUMERIC[], cfg.payment_admin_discord_id
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_community_support_payment_config(
  p_paypal_enabled BOOLEAN,
  p_paypal_me_url TEXT,
  p_suggested_amounts_eur NUMERIC[],
  p_payment_admin_discord_id TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_url TEXT := regexp_replace(trim(p_paypal_me_url), '/$', '');
  v_amount NUMERIC;
  v_previous_admin TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_url !~ '^https://(www\.)?paypal\.me/[A-Za-z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION 'Invalid PayPal.Me URL' USING ERRCODE = '22023';
  END IF;
  IF trim(p_payment_admin_discord_id) !~ '^[0-9]{17,20}$' THEN
    RAISE EXCEPTION 'Invalid Discord user ID' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_suggested_amounts_eur) NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'Provide one to six suggested amounts' USING ERRCODE = '22023';
  END IF;
  FOREACH v_amount IN ARRAY p_suggested_amounts_eur LOOP
    IF v_amount NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'Suggested amount outside allowed range' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT cfg.payment_admin_discord_id INTO v_previous_admin
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true
  FOR UPDATE;

  UPDATE public.community_support_payment_config
  SET paypal_enabled = p_paypal_enabled,
      paypal_me_url = v_url,
      suggested_amounts_eur = p_suggested_amounts_eur::NUMERIC(10,2)[],
      payment_admin_discord_id = trim(p_payment_admin_discord_id),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE singleton = true;

  -- A corrected destination must recover open intents that exhausted delivery retries.
  UPDATE public.community_support_payment_intents
  SET notification_attempts = 0,
      notification_claimed_at = NULL,
      notification_claim_token = NULL,
      notification_next_attempt_at = now(),
      notification_error = NULL,
      discord_notified_at = CASE
        WHEN v_previous_admin IS DISTINCT FROM trim(p_payment_admin_discord_id) THEN NULL
        ELSE discord_notified_at
      END,
      discord_message_id = CASE
        WHEN v_previous_admin IS DISTINCT FROM trim(p_payment_admin_discord_id) THEN NULL
        ELSE discord_message_id
      END
  WHERE status = 'pending'
    AND (
      discord_notified_at IS NULL
      OR v_previous_admin IS DISTINCT FROM trim(p_payment_admin_discord_id)
    )
    AND expires_at > now();
END;
$$;

CREATE OR REPLACE FUNCTION public.create_community_support_payment_intent(
  p_requested_amount_eur NUMERIC,
  p_payer_name_private TEXT,
  p_show_supporter_name BOOLEAN,
  p_show_amount BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_enabled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501';
  END IF;
  SELECT cfg.paypal_enabled AND cfg.paypal_me_url <> '' AND cfg.payment_admin_discord_id <> ''
  INTO v_enabled
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'PayPal contributions are disabled' USING ERRCODE = '55000';
  END IF;
  IF p_requested_amount_eur NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid requested amount' USING ERRCODE = '22023';
  END IF;
  IF char_length(trim(p_payer_name_private)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid payer name' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.community_support_payment_intents AS intent
      WHERE intent.user_id = auth.uid() AND intent.created_at > now() - INTERVAL '24 hours') >= 3 THEN
    RAISE EXCEPTION 'Too many payment checks' USING ERRCODE = '42900';
  END IF;

  UPDATE public.community_support_payment_intents
  SET status = 'expired', resolved_at = now()
  WHERE user_id = auth.uid() AND status = 'pending' AND expires_at <= now();

  INSERT INTO public.community_support_payment_intents (
    user_id, requested_amount_eur, payer_name_private, show_supporter_name, show_amount
  ) VALUES (
    auth.uid(), round(p_requested_amount_eur, 2), trim(p_payer_name_private),
    coalesce(p_show_supporter_name, false), coalesce(p_show_amount, false)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.discord_claim_community_support_payment_intents(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  id UUID,
  requested_amount_eur NUMERIC,
  payer_name_private TEXT,
  show_supporter_name BOOLEAN,
  show_amount BOOLEAN,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  notification_claim_token UUID,
  payment_admin_discord_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 25 THEN
    RAISE EXCEPTION 'Invalid claim limit' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH payment_config AS MATERIALIZED (
    SELECT cfg.payment_admin_discord_id
    FROM public.community_support_payment_config AS cfg
    WHERE cfg.singleton = true
      AND cfg.paypal_enabled = true
      AND cfg.payment_admin_discord_id <> ''
    FOR SHARE
  ), candidates AS (
    SELECT intent.id
    FROM public.community_support_payment_intents AS intent
    WHERE intent.status = 'pending'
      AND intent.discord_notified_at IS NULL
      AND intent.expires_at > now()
      AND intent.notification_attempts < 5
      AND intent.notification_next_attempt_at <= now()
      AND (intent.notification_claimed_at IS NULL OR intent.notification_claimed_at < now() - interval '5 minutes')
      AND EXISTS (SELECT 1 FROM payment_config)
    ORDER BY intent.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.community_support_payment_intents AS intent
    SET notification_claimed_at = now(),
        notification_claim_token = gen_random_uuid(),
        notification_attempts = intent.notification_attempts + 1,
        notification_error = NULL
    FROM candidates
    WHERE intent.id = candidates.id
    RETURNING intent.*
  )
  SELECT claimed.id, claimed.requested_amount_eur, claimed.payer_name_private,
         claimed.show_supporter_name, claimed.show_amount, claimed.created_at, claimed.expires_at,
         claimed.notification_claim_token, payment_config.payment_admin_discord_id
  FROM claimed
  CROSS JOIN payment_config
  ORDER BY claimed.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.discord_claim_community_support_payment_intents(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discord_claim_community_support_payment_intents(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.discord_mark_community_support_payment_notified(
  p_intent_id UUID,
  p_claim_token UUID,
  p_discord_message_id TEXT,
  p_error TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_support_payment_intents AS intent
  SET discord_notified_at = CASE WHEN p_error IS NULL THEN now() ELSE NULL END,
      discord_message_id = CASE WHEN p_error IS NULL THEN p_discord_message_id ELSE intent.discord_message_id END,
      notification_error = left(p_error, 500),
      notification_claimed_at = NULL,
      notification_claim_token = NULL,
      notification_next_attempt_at = CASE
        WHEN p_error IS NULL THEN intent.notification_next_attempt_at
        ELSE now() + make_interval(mins => least(60, power(2, greatest(intent.notification_attempts - 1, 0))::INTEGER))
      END
  WHERE id = p_intent_id
    AND status = 'pending'
    AND discord_notified_at IS NULL
    AND notification_claim_token = p_claim_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.discord_resolve_community_support_payment_intent(
  p_intent_id UUID,
  p_admin_discord_id TEXT,
  p_action TEXT,
  p_gross_amount_eur NUMERIC DEFAULT NULL,
  p_fee_amount_eur NUMERIC DEFAULT 0,
  p_resolution_note TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_intent public.community_support_payment_intents%ROWTYPE;
  v_expected_admin TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT cfg.payment_admin_discord_id INTO v_expected_admin
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true
  FOR SHARE;
  IF p_admin_discord_id IS NULL OR p_admin_discord_id <> v_expected_admin THEN
    RETURN 'not_payment_admin';
  END IF;
  IF p_resolution_note IS NULL OR char_length(trim(p_resolution_note)) NOT BETWEEN 1 AND 500 THEN
    RETURN 'invalid_note';
  END IF;

  SELECT * INTO v_intent FROM public.community_support_payment_intents
  WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_intent.status = 'confirmed' THEN RETURN 'already_confirmed'; END IF;
  IF v_intent.status = 'not_found' THEN RETURN 'already_not_found'; END IF;
  IF v_intent.status = 'expired' THEN RETURN 'already_expired'; END IF;
  IF v_intent.status <> 'pending' THEN RETURN 'already_resolved'; END IF;

  IF p_action = 'not_found' THEN
    UPDATE public.community_support_payment_intents
    SET status = 'not_found', resolved_at = now(), resolved_by_discord_id = p_admin_discord_id,
        resolution_note = trim(p_resolution_note)
    WHERE id = p_intent_id;
    RETURN 'not_found_marked';
  END IF;
  IF p_action <> 'confirm' THEN RETURN 'invalid_action'; END IF;
  IF p_gross_amount_eur IS NULL OR p_gross_amount_eur NOT BETWEEN 0.01 AND 1000
     OR p_fee_amount_eur IS NULL OR p_fee_amount_eur < 0 OR p_fee_amount_eur >= p_gross_amount_eur THEN
    RETURN 'invalid_amounts';
  END IF;

  INSERT INTO public.community_support_payment_ledger (
    source_payment_intent_id, direction, category, description, amount_eur,
    supporter_name, show_supporter_name, show_amount
  ) VALUES (
    v_intent.id, 'income', 'contribution', 'Vrijwillige PayPal-bijdrage', round(p_gross_amount_eur, 2),
    v_intent.payer_name_private, v_intent.show_supporter_name, v_intent.show_amount
  );
  IF p_fee_amount_eur > 0 THEN
    INSERT INTO public.community_support_payment_ledger (
      source_payment_intent_id, direction, category, description, amount_eur
    ) VALUES (
      v_intent.id, 'expense', 'payment_fee', 'PayPal-transactiekosten', round(p_fee_amount_eur, 2)
    );
  END IF;
  UPDATE public.community_support_payment_intents
  SET status = 'confirmed', resolved_at = now(), resolved_by_discord_id = p_admin_discord_id,
      gross_amount_eur = round(p_gross_amount_eur, 2), fee_amount_eur = round(p_fee_amount_eur, 2),
      resolution_note = trim(p_resolution_note)
  WHERE id = p_intent_id;
  RETURN 'confirmed';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_community_support_payment_ledger()
RETURNS TABLE (
  id UUID,
  date DATE,
  direction TEXT,
  category TEXT,
  description TEXT,
  amount_eur NUMERIC,
  supporter_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT ledger.id,
         (ledger.booked_at AT TIME ZONE 'Europe/Amsterdam')::DATE,
         ledger.direction,
         ledger.category,
         ledger.description,
         CASE
           WHEN ledger.category = 'contribution' AND ledger.show_amount = false THEN NULL
           ELSE ledger.amount_eur::NUMERIC
         END,
         CASE
           WHEN ledger.category = 'contribution' AND ledger.show_supporter_name = true THEN ledger.supporter_name
           ELSE NULL
         END
  FROM public.community_support_payment_ledger AS ledger
  ORDER BY ledger.booked_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_public_community_support_payment_totals()
RETURNS TABLE (month TEXT, contribution_total_eur NUMERIC, fee_total_eur NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT to_char(ledger.booked_at AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM'),
         coalesce(sum(ledger.amount_eur) FILTER (WHERE ledger.category = 'contribution'), 0)::NUMERIC,
         coalesce(sum(ledger.amount_eur) FILTER (WHERE ledger.category = 'payment_fee'), 0)::NUMERIC
  FROM public.community_support_payment_ledger AS ledger
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

REVOKE ALL ON FUNCTION public.get_community_support_payment_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_community_support_payment_ledger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_community_support_payment_totals() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_community_support_payment_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_community_support_payment_config(BOOLEAN, TEXT, NUMERIC[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_community_support_payment_intent(NUMERIC, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discord_mark_community_support_payment_notified(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discord_resolve_community_support_payment_intent(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_community_support_payment_config() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_community_support_payment_ledger() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_community_support_payment_totals() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_community_support_payment_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_community_support_payment_config(BOOLEAN, TEXT, NUMERIC[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_community_support_payment_intent(NUMERIC, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discord_mark_community_support_payment_notified(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.discord_resolve_community_support_payment_intent(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) TO service_role;

COMMIT;
