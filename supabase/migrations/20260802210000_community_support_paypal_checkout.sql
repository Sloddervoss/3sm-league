-- Automatic PayPal Checkout settlement for Community Support.
-- Forward-only and inert until the paypal-checkout Edge Function is configured and enabled.

BEGIN;

ALTER TABLE public.community_support_payment_config
  ADD COLUMN paypal_checkout_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN paypal_checkout_environment TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (paypal_checkout_environment IN ('sandbox', 'live')),
  ADD CONSTRAINT community_support_payment_config_single_paypal_flow_check
    CHECK (NOT (paypal_enabled AND paypal_checkout_enabled));

DROP FUNCTION public.get_community_support_payment_config();
CREATE FUNCTION public.get_community_support_payment_config()
RETURNS TABLE(
  paypal_enabled BOOLEAN,
  paypal_me_url TEXT,
  suggested_amounts_eur NUMERIC[],
  iracing_referral_enabled BOOLEAN,
  iracing_referral_url TEXT,
  paypal_checkout_enabled BOOLEAN,
  paypal_checkout_environment TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT
    cfg.paypal_enabled AND cfg.paypal_me_url <> '' AND cfg.payment_admin_discord_id <> '',
    CASE
      WHEN cfg.paypal_enabled AND cfg.paypal_me_url <> '' AND cfg.payment_admin_discord_id <> ''
      THEN regexp_replace(cfg.paypal_me_url, '/$', '')
      ELSE ''
    END,
    CASE
      WHEN cfg.paypal_checkout_enabled
        OR (cfg.paypal_enabled AND cfg.paypal_me_url <> '' AND cfg.payment_admin_discord_id <> '')
      THEN cfg.suggested_amounts_eur::NUMERIC[]
      ELSE ARRAY[]::NUMERIC[]
    END,
    cfg.iracing_referral_enabled AND cfg.iracing_referral_url <> '',
    CASE WHEN cfg.iracing_referral_enabled AND cfg.iracing_referral_url <> '' THEN cfg.iracing_referral_url ELSE '' END,
    cfg.paypal_checkout_enabled,
    cfg.paypal_checkout_environment
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true;
$$;

DROP FUNCTION public.admin_get_community_support_payment_config();
CREATE FUNCTION public.admin_get_community_support_payment_config()
RETURNS TABLE(
  paypal_enabled BOOLEAN,
  paypal_me_url TEXT,
  suggested_amounts_eur NUMERIC[],
  payment_admin_discord_id TEXT,
  iracing_referral_enabled BOOLEAN,
  iracing_referral_url TEXT,
  paypal_checkout_enabled BOOLEAN,
  paypal_checkout_environment TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT cfg.paypal_enabled, cfg.paypal_me_url, cfg.suggested_amounts_eur::NUMERIC[],
         cfg.payment_admin_discord_id, cfg.iracing_referral_enabled, cfg.iracing_referral_url,
         cfg.paypal_checkout_enabled, cfg.paypal_checkout_environment
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_community_support_paypal_checkout(
  p_enabled BOOLEAN,
  p_environment TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_current_enabled BOOLEAN;
  v_current_environment TEXT;
BEGIN
  IF auth.role() <> 'service_role' AND (
    auth.uid() IS NULL OR NOT (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_environment NOT IN ('sandbox', 'live') THEN
    RAISE EXCEPTION 'Invalid PayPal environment' USING ERRCODE = '22023';
  END IF;
  SELECT cfg.paypal_checkout_enabled, cfg.paypal_checkout_environment
  INTO v_current_enabled, v_current_environment
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true FOR UPDATE;
  IF p_environment = 'live'
     AND auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'super_admin'::public.app_role)
     AND (v_current_environment <> 'live' OR v_current_enabled IS DISTINCT FROM coalesce(p_enabled, false)) THEN
    RAISE EXCEPTION 'Super-admin required for live PayPal Checkout' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_support_payment_config
  SET paypal_checkout_enabled = coalesce(p_enabled, false),
      paypal_checkout_environment = p_environment,
      paypal_enabled = CASE WHEN coalesce(p_enabled, false) THEN false ELSE paypal_enabled END,
      updated_at = now(),
      updated_by = CASE WHEN auth.role() = 'service_role' THEN updated_by ELSE auth.uid() END
  WHERE singleton = true;
END;
$$;

DROP FUNCTION public.admin_update_community_support_payment_config(BOOLEAN, TEXT, NUMERIC[], TEXT, BOOLEAN, TEXT);
CREATE FUNCTION public.admin_update_community_support_payment_config(
  p_paypal_enabled BOOLEAN,
  p_paypal_checkout_enabled BOOLEAN,
  p_paypal_checkout_environment TEXT,
  p_paypal_me_url TEXT,
  p_suggested_amounts_eur NUMERIC[],
  p_payment_admin_discord_id TEXT,
  p_iracing_referral_enabled BOOLEAN,
  p_iracing_referral_url TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_url TEXT := regexp_replace(trim(coalesce(p_paypal_me_url, '')), '/$', '');
  v_referral_url TEXT := trim(coalesce(p_iracing_referral_url, ''));
  v_amount NUMERIC;
  v_previous_admin TEXT;
  v_current_checkout_enabled BOOLEAN;
  v_current_checkout_environment TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'; END IF;
  IF p_paypal_checkout_environment NOT IN ('sandbox', 'live') THEN
    RAISE EXCEPTION 'Invalid PayPal environment' USING ERRCODE = '22023';
  END IF;
  SELECT cfg.payment_admin_discord_id, cfg.paypal_checkout_enabled, cfg.paypal_checkout_environment
  INTO v_previous_admin, v_current_checkout_enabled, v_current_checkout_environment
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true FOR UPDATE;
  IF p_paypal_checkout_environment = 'live'
     AND NOT public.has_role(auth.uid(), 'super_admin'::public.app_role)
     AND (v_current_checkout_environment <> 'live'
          OR v_current_checkout_enabled IS DISTINCT FROM coalesce(p_paypal_checkout_enabled, false)) THEN
    RAISE EXCEPTION 'Super-admin required for live PayPal Checkout' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_paypal_enabled, false) AND coalesce(p_paypal_checkout_enabled, false) THEN
    RAISE EXCEPTION 'Only one PayPal flow can be enabled' USING ERRCODE = '22023';
  END IF;
  IF v_url <> '' AND v_url !~ '^https://(www\.)?paypal\.me/[A-Za-z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION 'Invalid PayPal.Me URL' USING ERRCODE = '22023';
  END IF;
  IF trim(coalesce(p_payment_admin_discord_id, '')) <> '' AND trim(p_payment_admin_discord_id) !~ '^[0-9]{17,20}$' THEN
    RAISE EXCEPTION 'Invalid Discord user ID' USING ERRCODE = '22023';
  END IF;
  IF p_paypal_enabled AND (v_url = '' OR trim(coalesce(p_payment_admin_discord_id, '')) = '') THEN
    RAISE EXCEPTION 'PayPal.Me URL and payment admin are required when PayPal is enabled' USING ERRCODE = '22023';
  END IF;
  IF v_referral_url <> '' AND v_referral_url !~* '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*iracing\.com(:443)?(/[^[:space:]]*)?$' THEN
    RAISE EXCEPTION 'Invalid iRacing referral URL' USING ERRCODE = '22023';
  END IF;
  IF p_iracing_referral_enabled AND v_referral_url = '' THEN
    RAISE EXCEPTION 'iRacing referral URL is required when referral is enabled' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_suggested_amounts_eur) NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'Provide one to six suggested amounts' USING ERRCODE = '22023';
  END IF;
  FOREACH v_amount IN ARRAY p_suggested_amounts_eur LOOP
    IF v_amount NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'Suggested amount outside allowed range' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.community_support_payment_config
  SET paypal_enabled = coalesce(p_paypal_enabled, false),
      paypal_checkout_enabled = coalesce(p_paypal_checkout_enabled, false),
      paypal_checkout_environment = p_paypal_checkout_environment,
      paypal_me_url = v_url,
      suggested_amounts_eur = p_suggested_amounts_eur::NUMERIC(10,2)[],
      payment_admin_discord_id = trim(p_payment_admin_discord_id),
      iracing_referral_enabled = p_iracing_referral_enabled,
      iracing_referral_url = v_referral_url,
      updated_at = now(), updated_by = auth.uid()
  WHERE singleton = true;

  UPDATE public.community_support_payment_intents
  SET notification_attempts = 0, notification_claimed_at = NULL, notification_claim_token = NULL,
      notification_next_attempt_at = now(), notification_error = NULL,
      discord_notified_at = CASE WHEN v_previous_admin IS DISTINCT FROM trim(p_payment_admin_discord_id) THEN NULL ELSE discord_notified_at END,
      discord_message_id = CASE WHEN v_previous_admin IS DISTINCT FROM trim(p_payment_admin_discord_id) THEN NULL ELSE discord_message_id END
  WHERE status = 'pending' AND payment_flow = 'paypal_me_manual'
    AND (discord_notified_at IS NULL OR v_previous_admin IS DISTINCT FROM trim(p_payment_admin_discord_id))
    AND expires_at > now();
END;
$$;

ALTER TABLE public.community_support_payment_intents
  DROP CONSTRAINT IF EXISTS community_support_payment_intents_status_check;
ALTER TABLE public.community_support_payment_intents
  ADD CONSTRAINT community_support_payment_intents_status_check
  CHECK (status IN ('pending', 'approved', 'confirmed', 'partially_refunded', 'refunded', 'reversed', 'not_found', 'expired'));

ALTER TABLE public.community_support_payment_intents
  ADD COLUMN payment_flow TEXT NOT NULL DEFAULT 'paypal_me_manual' CHECK (payment_flow IN ('paypal_me_manual', 'paypal_checkout')),
  ADD COLUMN paypal_environment TEXT CHECK (paypal_environment IN ('sandbox', 'live')),
  ADD COLUMN paypal_order_id TEXT,
  ADD COLUMN paypal_capture_id TEXT,
  ADD COLUMN paypal_merchant_id TEXT,
  ADD COLUMN paypal_currency TEXT CHECK (paypal_currency IS NULL OR paypal_currency = 'EUR'),
  ADD COLUMN paypal_net_amount_eur NUMERIC(10,2),
  ADD COLUMN paypal_captured_at TIMESTAMPTZ,
  ADD COLUMN paypal_refunded_amount_eur NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (paypal_refunded_amount_eur >= 0),
  ADD COLUMN checkout_error TEXT CHECK (checkout_error IS NULL OR char_length(checkout_error) <= 500);

CREATE UNIQUE INDEX community_support_payment_intents_paypal_order_uidx
  ON public.community_support_payment_intents (paypal_environment, paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;
CREATE UNIQUE INDEX community_support_payment_intents_paypal_capture_uidx
  ON public.community_support_payment_intents (paypal_environment, paypal_capture_id)
  WHERE paypal_capture_id IS NOT NULL;

ALTER TABLE public.community_support_payment_ledger
  DROP CONSTRAINT IF EXISTS community_support_payment_ledger_category_check,
  DROP CONSTRAINT IF EXISTS community_support_payment_ledger_source_payment_intent_id_category_key,
  DROP CONSTRAINT IF EXISTS community_support_payment_led_source_payment_intent_id_cate_key;
ALTER TABLE public.community_support_payment_ledger
  ADD CONSTRAINT community_support_payment_ledger_category_check
  CHECK (category IN ('contribution', 'payment_fee', 'payment_refund')),
  ADD COLUMN paypal_resource_id TEXT;
CREATE UNIQUE INDEX community_support_payment_ledger_initial_category_uidx
  ON public.community_support_payment_ledger (source_payment_intent_id, category)
  WHERE category IN ('contribution', 'payment_fee');
CREATE UNIQUE INDEX community_support_payment_ledger_paypal_resource_uidx
  ON public.community_support_payment_ledger (paypal_resource_id)
  WHERE paypal_resource_id IS NOT NULL;

CREATE TABLE public.community_support_paypal_webhook_events (
  paypal_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 120),
  resource_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'processed', 'ignored', 'failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
  error TEXT CHECK (error IS NULL OR char_length(error) <= 500)
);
ALTER TABLE public.community_support_paypal_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_support_paypal_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_support_paypal_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.create_community_support_paypal_checkout_intent(
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
  v_environment TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501';
  END IF;
  SELECT cfg.paypal_checkout_enabled, cfg.paypal_checkout_environment
  INTO v_enabled, v_environment
  FROM public.community_support_payment_config AS cfg WHERE cfg.singleton = true;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'PayPal contributions are disabled' USING ERRCODE = '55000';
  END IF;
  IF p_requested_amount_eur NOT BETWEEN 1 AND 1000 OR round(p_requested_amount_eur, 2) <> p_requested_amount_eur THEN
    RAISE EXCEPTION 'Invalid requested amount' USING ERRCODE = '22023';
  END IF;
  IF char_length(trim(p_payer_name_private)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid payer name' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.community_support_payment_intents AS intent
      WHERE intent.user_id = auth.uid() AND intent.created_at > now() - INTERVAL '24 hours') >= 3 THEN
    RAISE EXCEPTION 'Too many payment attempts' USING ERRCODE = '42900';
  END IF;
  UPDATE public.community_support_payment_intents
  SET status = 'expired', resolved_at = now()
  WHERE user_id = auth.uid() AND status = 'pending' AND expires_at <= now();
  INSERT INTO public.community_support_payment_intents (
    user_id, requested_amount_eur, payer_name_private, show_supporter_name, show_amount, payment_flow, paypal_environment
  ) VALUES (
    auth.uid(), round(p_requested_amount_eur, 2), trim(p_payer_name_private),
    coalesce(p_show_supporter_name, false), coalesce(p_show_amount, false), 'paypal_checkout', v_environment
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_community_support_paypal_checkout_intent(p_intent_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_intent public.community_support_payment_intents%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_intent
  FROM public.community_support_payment_intents
  WHERE id = p_intent_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_intent.user_id <> auth.uid() THEN RETURN 'wrong_user'; END IF;
  IF v_intent.payment_flow <> 'paypal_checkout' THEN RETURN 'invalid_flow'; END IF;
  IF v_intent.status = 'expired' THEN RETURN 'already_cancelled'; END IF;
  IF v_intent.status <> 'pending' OR v_intent.paypal_capture_id IS NOT NULL THEN RETURN 'not_cancellable'; END IF;
  UPDATE public.community_support_payment_intents
  SET status = 'expired', resolved_at = now(), checkout_error = 'cancelled_by_user'
  WHERE id = p_intent_id;
  RETURN 'cancelled';
END;
$$;

-- Recover capture-in-progress intents after refresh or closing the browser.
CREATE OR REPLACE FUNCTION public.get_community_support_paypal_checkout_recovery_intent()
RETURNS TABLE(intent_id UUID, status TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT intent.id, intent.status
  FROM public.community_support_payment_intents AS intent
  WHERE intent.user_id = auth.uid()
    AND intent.payment_flow = 'paypal_checkout'
    AND (
      intent.status = 'approved'
      OR (intent.status = 'pending' AND intent.expires_at > now())
    )
  ORDER BY CASE WHEN intent.status = 'approved' THEN 0 ELSE 1 END, intent.created_at DESC
  LIMIT 1;
END;
$$;

-- Keep the manual PayPal.Me path available only when its own independent toggle is active.
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
  SELECT cfg.paypal_enabled
    AND NOT cfg.paypal_checkout_enabled
    AND cfg.paypal_me_url <> ''
    AND cfg.payment_admin_discord_id <> ''
  INTO v_enabled
  FROM public.community_support_payment_config AS cfg
  WHERE cfg.singleton = true;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'Manual PayPal.Me contributions are disabled' USING ERRCODE = '55000';
  END IF;
  IF p_requested_amount_eur NOT BETWEEN 1 AND 1000 OR round(p_requested_amount_eur, 2) <> p_requested_amount_eur THEN
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
    user_id, requested_amount_eur, payer_name_private, show_supporter_name, show_amount, payment_flow
  ) VALUES (
    auth.uid(), round(p_requested_amount_eur, 2), trim(p_payer_name_private),
    coalesce(p_show_supporter_name, false), coalesce(p_show_amount, false), 'paypal_me_manual'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Automatic checkout intents never enter the legacy manual Discord verification queue.
CREATE OR REPLACE FUNCTION public.discord_claim_community_support_payment_intents(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  id UUID, requested_amount_eur NUMERIC, payer_name_private TEXT,
  show_supporter_name BOOLEAN, show_amount BOOLEAN, created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ, notification_claim_token UUID, payment_admin_discord_id TEXT
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
    WHERE cfg.singleton = true AND cfg.paypal_enabled = true AND cfg.payment_admin_discord_id <> ''
    FOR SHARE
  ), candidates AS (
    SELECT intent.id
    FROM public.community_support_payment_intents AS intent
    WHERE intent.status = 'pending'
      AND intent.payment_flow = 'paypal_me_manual'
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
    SET notification_claimed_at = now(), notification_claim_token = gen_random_uuid(),
        notification_attempts = intent.notification_attempts + 1, notification_error = NULL
    FROM candidates WHERE intent.id = candidates.id
    RETURNING intent.*
  )
  SELECT claimed.id, claimed.requested_amount_eur, claimed.payer_name_private,
         claimed.show_supporter_name, claimed.show_amount, claimed.created_at, claimed.expires_at,
         claimed.notification_claim_token, payment_config.payment_admin_discord_id
  FROM claimed CROSS JOIN payment_config ORDER BY claimed.created_at;
END;
$$;

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
  IF p_environment NOT IN ('sandbox', 'live') OR trim(coalesce(p_order_id, '')) = '' OR trim(coalesce(p_merchant_id, '')) = '' THEN
    RETURN 'invalid_order';
  END IF;

  SELECT * INTO v_intent
  FROM public.community_support_payment_intents
  WHERE id = p_intent_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_intent.user_id <> p_user_id THEN RETURN 'wrong_user'; END IF;
  IF v_intent.payment_flow <> 'paypal_checkout' THEN RETURN 'invalid_flow'; END IF;
  IF v_intent.paypal_environment <> p_environment THEN RETURN 'environment_mismatch'; END IF;
  IF v_intent.status <> 'pending' OR v_intent.expires_at <= now() THEN RETURN 'not_pending'; END IF;
  IF v_intent.paypal_order_id IS NOT NULL THEN
    IF v_intent.paypal_environment = p_environment AND v_intent.paypal_order_id = p_order_id THEN RETURN 'already_attached'; END IF;
    RETURN 'different_order_exists';
  END IF;

  UPDATE public.community_support_payment_intents
  SET paypal_environment = p_environment,
      paypal_order_id = trim(p_order_id),
      paypal_merchant_id = trim(p_merchant_id),
      checkout_error = NULL
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
  SELECT * INTO v_intent
  FROM public.community_support_payment_intents
  WHERE id = p_intent_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_intent.user_id <> p_user_id THEN RETURN 'wrong_user'; END IF;
  IF v_intent.payment_flow <> 'paypal_checkout' THEN RETURN 'invalid_flow'; END IF;
  IF v_intent.paypal_environment IS DISTINCT FROM p_environment
     OR v_intent.paypal_order_id IS DISTINCT FROM p_order_id THEN RETURN 'binding_mismatch'; END IF;
  IF v_intent.status = 'approved' THEN RETURN 'already_begun'; END IF;
  IF v_intent.status <> 'pending' OR v_intent.expires_at <= now() THEN RETURN 'not_pending'; END IF;
  UPDATE public.community_support_payment_intents
  SET status = 'approved', checkout_error = NULL
  WHERE id = p_intent_id;
  RETURN 'begun';
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_settle_community_support_capture(
  p_intent_id UUID,
  p_environment TEXT,
  p_order_id TEXT,
  p_capture_id TEXT,
  p_merchant_id TEXT,
  p_currency TEXT,
  p_gross_amount_eur NUMERIC,
  p_fee_amount_eur NUMERIC,
  p_net_amount_eur NUMERIC,
  p_captured_at TIMESTAMPTZ
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
  SELECT * INTO v_intent
  FROM public.community_support_payment_intents
  WHERE id = p_intent_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_intent.payment_flow <> 'paypal_checkout' THEN RETURN 'invalid_flow'; END IF;
  IF v_intent.paypal_capture_id = p_capture_id AND v_intent.status IN ('confirmed', 'partially_refunded', 'refunded', 'reversed') THEN RETURN 'already_confirmed'; END IF;
  IF v_intent.status <> 'approved' THEN RETURN 'not_settleable'; END IF;
  IF v_intent.paypal_environment IS DISTINCT FROM p_environment
     OR v_intent.paypal_order_id IS DISTINCT FROM p_order_id
     OR v_intent.paypal_merchant_id IS DISTINCT FROM p_merchant_id THEN RETURN 'binding_mismatch'; END IF;
  IF p_currency <> 'EUR' OR round(p_gross_amount_eur, 2) <> v_intent.requested_amount_eur THEN RETURN 'amount_mismatch'; END IF;
  IF p_fee_amount_eur < 0 OR p_net_amount_eur < 0
     OR round(p_gross_amount_eur - p_fee_amount_eur, 2) <> round(p_net_amount_eur, 2) THEN RETURN 'settlement_mismatch'; END IF;
  IF trim(coalesce(p_capture_id, '')) = '' OR p_captured_at IS NULL THEN RETURN 'incomplete_capture'; END IF;

  INSERT INTO public.community_support_payment_ledger (
    source_payment_intent_id, direction, category, description, amount_eur,
    supporter_name, show_supporter_name, show_amount, paypal_resource_id
  ) VALUES (
    v_intent.id, 'income', 'contribution', 'Vrijwillige PayPal-bijdrage', round(p_gross_amount_eur, 2),
    v_intent.payer_name_private, v_intent.show_supporter_name, v_intent.show_amount, p_environment || ':' || p_capture_id || ':gross'
  ) ON CONFLICT DO NOTHING;
  IF p_fee_amount_eur > 0 THEN
    INSERT INTO public.community_support_payment_ledger (
      source_payment_intent_id, direction, category, description, amount_eur, paypal_resource_id
    ) VALUES (
      v_intent.id, 'expense', 'payment_fee', 'PayPal-transactiekosten', round(p_fee_amount_eur, 2), p_environment || ':' || p_capture_id || ':fee'
    ) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.community_support_payment_intents
  SET status = 'confirmed', resolved_at = now(), gross_amount_eur = round(p_gross_amount_eur, 2),
      fee_amount_eur = round(p_fee_amount_eur, 2), paypal_net_amount_eur = round(p_net_amount_eur, 2),
      paypal_capture_id = trim(p_capture_id), paypal_currency = 'EUR', paypal_captured_at = p_captured_at,
      resolution_note = 'Automatisch bevestigd via PayPal Checkout', checkout_error = NULL,
      notification_claimed_at = NULL, notification_claim_token = NULL
  WHERE id = p_intent_id;
  RETURN 'confirmed';
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_refund_community_support_capture(
  p_environment TEXT,
  p_capture_id TEXT,
  p_refund_id TEXT,
  p_currency TEXT,
  p_refund_amount_eur NUMERIC,
  p_refunded_at TIMESTAMPTZ,
  p_correction_type TEXT DEFAULT 'refund'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_intent public.community_support_payment_intents%ROWTYPE;
  v_remaining NUMERIC;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_intent
  FROM public.community_support_payment_intents
  WHERE paypal_environment = p_environment
    AND paypal_capture_id = p_capture_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'capture_not_found'; END IF;
  IF p_environment NOT IN ('sandbox', 'live') THEN RETURN 'invalid_environment'; END IF;
  IF EXISTS (SELECT 1 FROM public.community_support_payment_ledger WHERE paypal_resource_id = p_environment || ':' || p_refund_id) THEN RETURN 'already_refunded'; END IF;
  IF p_correction_type NOT IN ('refund', 'reversal') THEN RETURN 'invalid_correction'; END IF;
  IF trim(coalesce(p_capture_id, '')) = '' OR trim(coalesce(p_refund_id, '')) = '' OR p_refunded_at IS NULL THEN RETURN 'incomplete_correction'; END IF;
  IF v_intent.status NOT IN ('confirmed', 'partially_refunded') OR p_currency <> 'EUR' OR p_refund_amount_eur <= 0 THEN RETURN 'invalid_refund'; END IF;
  v_remaining := coalesce(v_intent.gross_amount_eur, 0) - v_intent.paypal_refunded_amount_eur;
  IF round(p_refund_amount_eur, 2) > round(v_remaining, 2) THEN RETURN 'refund_exceeds_capture'; END IF;
  IF p_correction_type = 'reversal' AND round(p_refund_amount_eur, 2) <> round(v_remaining, 2) THEN RETURN 'reversal_amount_mismatch'; END IF;

  INSERT INTO public.community_support_payment_ledger (
    source_payment_intent_id, booked_at, direction, category, description, amount_eur,
    paypal_resource_id, supporter_name, show_supporter_name, show_amount
  ) VALUES (
    v_intent.id, coalesce(p_refunded_at, now()), 'expense', 'payment_refund',
    CASE WHEN p_correction_type = 'reversal' THEN 'Terugboeking PayPal-bijdrage' ELSE 'Terugbetaling PayPal-bijdrage' END,
    round(p_refund_amount_eur, 2), p_environment || ':' || trim(p_refund_id), v_intent.payer_name_private,
    v_intent.show_supporter_name, v_intent.show_amount
  );
  UPDATE public.community_support_payment_intents
  SET paypal_refunded_amount_eur = paypal_refunded_amount_eur + round(p_refund_amount_eur, 2),
      status = CASE
        WHEN p_correction_type = 'reversal' THEN 'reversed'
        WHEN paypal_refunded_amount_eur + round(p_refund_amount_eur, 2) >= gross_amount_eur THEN 'refunded'
        ELSE 'partially_refunded'
      END
  WHERE id = v_intent.id;
  RETURN 'refunded';
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_claim_community_support_webhook_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_resource_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_claimed UUID;
  v_claim_token UUID := gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.community_support_paypal_webhook_events (paypal_event_id, event_type, resource_id, claim_token)
  VALUES (trim(p_event_id), trim(p_event_type), nullif(trim(coalesce(p_resource_id, '')), ''), v_claim_token)
  ON CONFLICT (paypal_event_id) DO UPDATE
  SET status = 'processing', received_at = now(), processed_at = NULL, error = NULL, claim_token = v_claim_token
  WHERE community_support_paypal_webhook_events.status = 'failed'
     OR (community_support_paypal_webhook_events.status = 'processing'
         AND community_support_paypal_webhook_events.received_at < now() - interval '5 minutes')
  RETURNING claim_token INTO v_claimed;
  RETURN v_claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_finish_community_support_webhook_event(
  p_event_id TEXT,
  p_claim_token UUID,
  p_status TEXT,
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
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('processed', 'ignored', 'failed') THEN RETURN false; END IF;
  UPDATE public.community_support_paypal_webhook_events
  SET status = p_status, processed_at = now(), error = left(p_error, 500)
  WHERE paypal_event_id = p_event_id AND claim_token = p_claim_token AND status = 'processing';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- Refunds preserve the original contribution privacy choices.
CREATE OR REPLACE FUNCTION public.get_public_community_support_payment_ledger()
RETURNS TABLE (
  id UUID, date DATE, direction TEXT, category TEXT, description TEXT,
  amount_eur NUMERIC, supporter_name TEXT
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
           WHEN ledger.category IN ('contribution', 'payment_refund') AND ledger.show_amount = false THEN NULL
           ELSE ledger.amount_eur::NUMERIC
         END,
         CASE
           WHEN ledger.category IN ('contribution', 'payment_refund') AND ledger.show_supporter_name = true THEN ledger.supporter_name
           ELSE NULL
         END
  FROM public.community_support_payment_ledger AS ledger
  ORDER BY ledger.booked_at DESC;
$$;

-- Refunds reduce net community income while the original contribution and correction remain auditable.
CREATE OR REPLACE FUNCTION public.get_public_community_support_payment_totals()
RETURNS TABLE (month TEXT, contribution_total_eur NUMERIC, fee_total_eur NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT to_char(ledger.booked_at AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM'),
         (
           coalesce(sum(ledger.amount_eur) FILTER (WHERE ledger.category = 'contribution'), 0)
           - coalesce(sum(ledger.amount_eur) FILTER (WHERE ledger.category = 'payment_refund'), 0)
         )::NUMERIC,
         coalesce(sum(ledger.amount_eur) FILTER (WHERE ledger.category = 'payment_fee'), 0)::NUMERIC
  FROM public.community_support_payment_ledger AS ledger
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

REVOKE ALL ON FUNCTION public.get_community_support_payment_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_community_support_payment_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_community_support_paypal_checkout(BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_community_support_payment_config(BOOLEAN, BOOLEAN, TEXT, TEXT, NUMERIC[], TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_community_support_paypal_checkout_intent(NUMERIC, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_community_support_paypal_checkout_intent(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_community_support_paypal_checkout_recovery_intent() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.paypal_attach_community_support_order(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_begin_community_support_capture(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_settle_community_support_capture(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_refund_community_support_capture(TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_claim_community_support_webhook_event(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_finish_community_support_webhook_event(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_community_support_payment_config() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_community_support_payment_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_community_support_paypal_checkout(BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_community_support_payment_config(BOOLEAN, BOOLEAN, TEXT, TEXT, NUMERIC[], TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_community_support_paypal_checkout_intent(NUMERIC, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_community_support_paypal_checkout_intent(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_community_support_paypal_checkout_recovery_intent() TO authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_attach_community_support_order(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_begin_community_support_capture(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_settle_community_support_capture(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_refund_community_support_capture(TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_claim_community_support_webhook_event(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_finish_community_support_webhook_event(TEXT, UUID, TEXT, TEXT) TO service_role;

COMMIT;
