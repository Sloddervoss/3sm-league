-- Accountless PayPal Checkout contributions for Community Support.
-- Guest ownership uses a high-entropy browser token whose SHA-256 hash is
-- stored server-side; raw access tokens and source IP addresses are never stored.

BEGIN;

ALTER TABLE public.community_support_payment_intents
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN guest_access_token_hash TEXT,
  ADD COLUMN guest_fingerprint_hash TEXT;

ALTER TABLE public.community_support_payment_intents
  ADD CONSTRAINT community_support_payment_intents_owner_check CHECK (
    (user_id IS NOT NULL AND guest_access_token_hash IS NULL AND guest_fingerprint_hash IS NULL)
    OR
    (user_id IS NULL
      AND guest_access_token_hash IS NOT NULL
      AND guest_fingerprint_hash IS NOT NULL
      AND guest_access_token_hash ~ '^[0-9a-f]{64}$'
      AND guest_fingerprint_hash ~ '^[0-9a-f]{64}$')
  );

CREATE UNIQUE INDEX community_support_payment_intents_guest_token_uidx
  ON public.community_support_payment_intents (guest_access_token_hash)
  WHERE guest_access_token_hash IS NOT NULL;
CREATE INDEX community_support_payment_intents_guest_rate_idx
  ON public.community_support_payment_intents (guest_fingerprint_hash, created_at)
  WHERE guest_fingerprint_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.paypal_create_community_support_guest_intent(
  p_requested_amount_eur NUMERIC,
  p_payer_name_private TEXT,
  p_show_supporter_name BOOLEAN,
  p_show_amount BOOLEAN,
  p_guest_access_token_hash TEXT,
  p_guest_fingerprint_hash TEXT,
  p_environment TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_enabled BOOLEAN;
  v_config_environment TEXT;
  v_name TEXT := trim(coalesce(p_payer_name_private, ''));
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_guest_access_token_hash !~ '^[0-9a-f]{64}$'
     OR p_guest_fingerprint_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid guest owner proof' USING ERRCODE = '22023';
  END IF;
  IF p_requested_amount_eur NOT BETWEEN 1 AND 1000
     OR round(p_requested_amount_eur, 2) <> p_requested_amount_eur THEN
    RAISE EXCEPTION 'Invalid requested amount' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) > 100
     OR (coalesce(p_show_supporter_name, false) AND char_length(v_name) < 1) THEN
    RAISE EXCEPTION 'Invalid payer name' USING ERRCODE = '22023';
  END IF;

  SELECT cfg.paypal_checkout_enabled, cfg.paypal_checkout_environment
  INTO v_enabled, v_config_environment
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true
  FOR SHARE;
  IF NOT coalesce(v_enabled, false) OR v_config_environment IS DISTINCT FROM p_environment THEN
    RAISE EXCEPTION 'PayPal contributions are disabled' USING ERRCODE = '55000';
  END IF;

  -- Serialize the rate check for this privacy-preserving fingerprint so
  -- simultaneous requests cannot bypass the five-attempt daily ceiling.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_guest_fingerprint_hash, 0));
  IF (SELECT count(*)
      FROM public.community_support_payment_intents AS intent
      WHERE intent.guest_fingerprint_hash = p_guest_fingerprint_hash
        AND intent.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'Too many guest payment attempts' USING ERRCODE = '42900';
  END IF;

  INSERT INTO public.community_support_payment_intents (
    user_id, requested_amount_eur, payer_name_private, show_supporter_name,
    show_amount, payment_flow, paypal_environment, guest_access_token_hash,
    guest_fingerprint_hash
  ) VALUES (
    NULL, round(p_requested_amount_eur, 2),
    CASE WHEN v_name = '' THEN 'Anonieme supporter' ELSE v_name END,
    coalesce(p_show_supporter_name, false), coalesce(p_show_amount, false),
    'paypal_checkout', p_environment, p_guest_access_token_hash,
    p_guest_fingerprint_hash
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Existing service-only order/capture RPCs now deliberately accept NULL as the
-- owner ID for guest rows. IS DISTINCT FROM prevents NULL from bypassing the
-- owner comparison.
CREATE OR REPLACE FUNCTION public.paypal_attach_community_support_order(
  p_intent_id UUID,
  p_user_id UUID,
  p_environment TEXT,
  p_order_id TEXT,
  p_merchant_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_intent public.community_support_payment_intents%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_environment NOT IN ('sandbox', 'live')
     OR trim(coalesce(p_order_id, '')) = ''
     OR trim(coalesce(p_merchant_id, '')) = '' THEN
    RETURN 'invalid_order';
  END IF;
  SELECT * INTO v_intent FROM public.community_support_payment_intents
  WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_intent.user_id IS DISTINCT FROM p_user_id THEN RETURN 'wrong_user'; END IF;
  IF v_intent.payment_flow <> 'paypal_checkout' THEN RETURN 'invalid_flow'; END IF;
  IF v_intent.paypal_environment <> p_environment THEN RETURN 'environment_mismatch'; END IF;
  IF v_intent.status <> 'pending' OR v_intent.expires_at <= now() THEN RETURN 'not_pending'; END IF;
  IF v_intent.paypal_order_id IS NOT NULL THEN
    IF v_intent.paypal_environment = p_environment AND v_intent.paypal_order_id = p_order_id THEN
      RETURN 'already_attached';
    END IF;
    RETURN 'different_order_exists';
  END IF;
  UPDATE public.community_support_payment_intents
  SET paypal_environment = p_environment, paypal_order_id = trim(p_order_id),
      paypal_merchant_id = trim(p_merchant_id), checkout_error = NULL
  WHERE id = p_intent_id;
  RETURN 'attached';
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_begin_community_support_capture(
  p_intent_id UUID,
  p_user_id UUID,
  p_environment TEXT,
  p_order_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_intent public.community_support_payment_intents%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_intent FROM public.community_support_payment_intents
  WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_intent.user_id IS DISTINCT FROM p_user_id THEN RETURN 'wrong_user'; END IF;
  IF v_intent.payment_flow <> 'paypal_checkout' THEN RETURN 'invalid_flow'; END IF;
  IF v_intent.paypal_environment IS DISTINCT FROM p_environment
     OR v_intent.paypal_order_id IS DISTINCT FROM p_order_id THEN RETURN 'binding_mismatch'; END IF;
  IF v_intent.status = 'approved' THEN RETURN 'already_begun'; END IF;
  IF v_intent.status <> 'pending' OR v_intent.expires_at <= now() THEN RETURN 'not_pending'; END IF;
  UPDATE public.community_support_payment_intents
  SET status = 'approved', checkout_error = NULL WHERE id = p_intent_id;
  RETURN 'begun';
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_cancel_community_support_guest_intent(
  p_intent_id UUID,
  p_guest_access_token_hash TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_intent public.community_support_payment_intents%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_intent FROM public.community_support_payment_intents
  WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_intent.user_id IS NOT NULL
     OR v_intent.guest_access_token_hash IS DISTINCT FROM p_guest_access_token_hash THEN
    RETURN 'wrong_guest';
  END IF;
  IF v_intent.status = 'expired' THEN RETURN 'already_cancelled'; END IF;
  IF v_intent.status <> 'pending' OR v_intent.paypal_capture_id IS NOT NULL THEN RETURN 'not_cancellable'; END IF;
  UPDATE public.community_support_payment_intents
  SET status = 'expired', resolved_at = now(), checkout_error = 'cancelled_by_guest'
  WHERE id = p_intent_id;
  RETURN 'cancelled';
END;
$$;

REVOKE ALL ON FUNCTION public.paypal_create_community_support_guest_intent(NUMERIC, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_cancel_community_support_guest_intent(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_create_community_support_guest_intent(NUMERIC, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_cancel_community_support_guest_intent(UUID, TEXT) TO service_role;

COMMIT;
