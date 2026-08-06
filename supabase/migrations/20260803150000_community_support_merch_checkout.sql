-- PayPal Checkout for Community Support merchandise.
-- Reserves one unit atomically, stores immutable product/cost snapshots and
-- persists the PayPal shipping address server-side for admin fulfilment.

ALTER TABLE public.community_support_products
  ADD COLUMN fulfillment_mode TEXT NOT NULL DEFAULT 'physical'
    CHECK (fulfillment_mode IN ('physical','digital'));
ALTER TABLE public.community_support_products
  ADD CONSTRAINT community_support_products_digital_shipping_check
  CHECK (fulfillment_mode='physical' OR shipping_cost_eur=0);

ALTER TABLE public.community_support_ledger_entries
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','merch_order','merch_refund')),
  ADD COLUMN IF NOT EXISTS source_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS community_support_ledger_automatic_source_uidx
  ON public.community_support_ledger_entries(source_type, source_id, category)
  WHERE source_type <> 'manual' AND source_id IS NOT NULL;

CREATE TABLE public.community_support_merch_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES public.community_support_products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL CHECK (length(btrim(product_name)) BETWEEN 1 AND 100),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  unit_price_eur NUMERIC(12,2) NOT NULL CHECK (unit_price_eur >= 1 AND unit_price_eur <= 1000),
  purchase_price_eur NUMERIC(12,2) NOT NULL CHECK (purchase_price_eur >= 0 AND purchase_price_eur <= 1000),
  shipping_cost_eur NUMERIC(12,2) NOT NULL CHECK (shipping_cost_eur >= 0 AND shipping_cost_eur <= 1000),
  fulfillment_mode TEXT NOT NULL CHECK (fulfillment_mode IN ('physical','digital')),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','confirmed','cancelled','expired','partially_refunded','refunded','reversed')),
  paypal_environment TEXT NOT NULL CHECK (paypal_environment IN ('sandbox','live')),
  paypal_order_id TEXT,
  paypal_capture_id TEXT,
  paypal_merchant_id TEXT,
  paypal_fee_eur NUMERIC(12,2),
  paypal_net_eur NUMERIC(12,2),
  shipping_name TEXT CHECK (shipping_name IS NULL OR length(shipping_name) <= 160),
  shipping_address JSONB CHECK (shipping_address IS NULL OR (jsonb_typeof(shipping_address) = 'object' AND octet_length(shipping_address::TEXT) <= 4000)),
  delivery_email TEXT CHECK (delivery_email IS NULL OR length(delivery_email) <= 254),
  refunded_amount_eur NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (refunded_amount_eur >= 0),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  captured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status IN ('confirmed','partially_refunded','refunded','reversed')) = (paypal_capture_id IS NOT NULL)),
  CHECK (refunded_amount_eur <= unit_price_eur)
);

CREATE UNIQUE INDEX community_support_merch_orders_environment_order_uidx
  ON public.community_support_merch_orders(paypal_environment, paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;
CREATE UNIQUE INDEX community_support_merch_orders_environment_capture_uidx
  ON public.community_support_merch_orders(paypal_environment, paypal_capture_id)
  WHERE paypal_capture_id IS NOT NULL;
CREATE UNIQUE INDEX community_support_merch_orders_one_active_per_user_product_uidx
  ON public.community_support_merch_orders(user_id, product_id)
  WHERE status IN ('pending','approved');

CREATE TABLE public.community_support_merch_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.community_support_merch_orders(id) ON DELETE RESTRICT,
  paypal_environment TEXT NOT NULL CHECK (paypal_environment IN ('sandbox','live')),
  paypal_refund_id TEXT NOT NULL,
  amount_eur NUMERIC(12,2) NOT NULL CHECK (amount_eur > 0),
  refunded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (paypal_environment, paypal_refund_id)
);

ALTER TABLE public.community_support_merch_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_merch_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_merch_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_merch_refunds FORCE ROW LEVEL SECURITY;

CREATE POLICY community_support_merch_orders_owner_select ON public.community_support_merch_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY community_support_merch_orders_admin_select ON public.community_support_merch_orders
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

REVOKE ALL ON public.community_support_merch_orders, public.community_support_merch_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_support_merch_orders, public.community_support_merch_refunds TO service_role;

CREATE OR REPLACE FUNCTION public.get_owned_active_community_support_merch_product_ids()
RETURNS TABLE(product_id UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT orders.product_id
  FROM public.community_support_merch_orders AS orders
  WHERE orders.user_id = auth.uid()
    AND orders.status IN ('pending', 'approved')
    AND orders.product_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_owned_active_community_support_merch_product_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owned_active_community_support_merch_product_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.paypal_create_community_support_merch_order(
  p_user_id UUID,
  p_product_id UUID,
  p_environment TEXT
)
RETURNS public.community_support_merch_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_product public.community_support_products%ROWTYPE;
  v_payment_config public.community_support_payment_config%ROWTYPE;
  v_existing public.community_support_merch_orders%ROWTYPE;
  v_order public.community_support_merch_orders%ROWTYPE;
  v_expired RECORD;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_environment NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'Invalid PayPal environment' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO STRICT v_payment_config
  FROM public.community_support_payment_config
  WHERE singleton = true
  FOR SHARE;
  IF NOT v_payment_config.paypal_checkout_enabled
     OR v_payment_config.paypal_checkout_environment <> p_environment THEN
    RAISE EXCEPTION 'PayPal Checkout is disabled or the environment does not match' USING ERRCODE = '55000';
  END IF;

  FOR v_expired IN
    SELECT id, product_id, quantity
    FROM public.community_support_merch_orders
    WHERE status = 'pending' AND paypal_order_id IS NULL AND expires_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.community_support_merch_orders SET status = 'expired', updated_at = now() WHERE id = v_expired.id;
    UPDATE public.community_support_products SET stock = stock + v_expired.quantity, updated_at = now() WHERE id = v_expired.product_id;
  END LOOP;

  SELECT * INTO v_existing
  FROM public.community_support_merch_orders
  WHERE user_id = p_user_id AND product_id = p_product_id AND status IN ('pending','approved')
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.paypal_environment <> p_environment THEN
      RAISE EXCEPTION 'Existing order environment mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing;
  END IF;

  SELECT * INTO STRICT v_product FROM public.community_support_products WHERE id = p_product_id FOR UPDATE;
  IF NOT v_product.active OR v_product.concept OR v_product.stock < 1 OR v_product.price_eur < 1 OR v_product.price_eur > 1000 THEN
    RAISE EXCEPTION 'Product is not available' USING ERRCODE = '22023';
  END IF;

  UPDATE public.community_support_products SET stock = stock - 1, updated_at = now() WHERE id = p_product_id;
  INSERT INTO public.community_support_merch_orders (
    user_id, product_id, product_name, unit_price_eur, purchase_price_eur,
    shipping_cost_eur, fulfillment_mode, paypal_environment
  ) VALUES (
    p_user_id, p_product_id, v_product.name, v_product.price_eur,
    v_product.purchase_price_eur, CASE WHEN v_product.fulfillment_mode='physical' THEN v_product.shipping_cost_eur ELSE 0 END,
    v_product.fulfillment_mode, p_environment
  ) RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_attach_community_support_merch_order(
  p_order_id UUID, p_user_id UUID, p_environment TEXT, p_paypal_order_id TEXT, p_merchant_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE v_order public.community_support_merch_orders%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT v_order FROM public.community_support_merch_orders WHERE id=p_order_id FOR UPDATE;
  IF v_order.user_id<>p_user_id OR v_order.paypal_environment<>p_environment THEN RETURN 'binding_mismatch'; END IF;
  IF v_order.paypal_order_id IS NOT NULL THEN
    RETURN CASE WHEN v_order.paypal_order_id=p_paypal_order_id AND v_order.paypal_merchant_id=p_merchant_id THEN 'already_attached' ELSE 'already_bound' END;
  END IF;
  IF v_order.status<>'pending' OR v_order.expires_at<=now() THEN RETURN 'not_pending'; END IF;
  UPDATE public.community_support_merch_orders
  SET paypal_order_id=p_paypal_order_id,paypal_merchant_id=p_merchant_id,
      expires_at=now()+interval '73 hours',updated_at=now()
  WHERE id=p_order_id;
  RETURN 'attached';
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_begin_community_support_merch_capture(
  p_order_id UUID, p_user_id UUID, p_environment TEXT, p_paypal_order_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE v_order public.community_support_merch_orders%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT v_order FROM public.community_support_merch_orders WHERE id=p_order_id FOR UPDATE;
  IF v_order.user_id<>p_user_id OR v_order.paypal_environment<>p_environment OR v_order.paypal_order_id<>p_paypal_order_id THEN RETURN 'binding_mismatch'; END IF;
  IF v_order.status='approved' THEN RETURN 'already_begun'; END IF;
  IF v_order.status<>'pending' THEN RETURN 'not_pending'; END IF;
  UPDATE public.community_support_merch_orders SET status='approved',updated_at=now() WHERE id=p_order_id;
  RETURN 'begun';
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_cancel_community_support_merch_order(
  p_order_id UUID, p_user_id UUID, p_environment TEXT, p_provider_status TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE v_order public.community_support_merch_orders%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT v_order FROM public.community_support_merch_orders WHERE id=p_order_id FOR UPDATE;
  IF v_order.user_id<>p_user_id OR v_order.paypal_environment<>p_environment THEN RETURN 'binding_mismatch'; END IF;
  IF v_order.status='cancelled' THEN RETURN 'already_cancelled'; END IF;
  IF v_order.status<>'pending' THEN RETURN 'not_cancellable'; END IF;
  IF v_order.paypal_order_id IS NOT NULL AND p_provider_status IS DISTINCT FROM 'VOIDED' THEN
    RETURN 'awaiting_provider_expiry';
  END IF;
  UPDATE public.community_support_merch_orders SET status='cancelled',updated_at=now() WHERE id=p_order_id;
  UPDATE public.community_support_products SET stock=stock+v_order.quantity,updated_at=now() WHERE id=v_order.product_id;
  RETURN 'cancelled';
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_settle_community_support_merch_capture(
  p_order_id UUID, p_environment TEXT, p_paypal_order_id TEXT, p_capture_id TEXT,
  p_merchant_id TEXT, p_currency TEXT, p_gross_amount_eur NUMERIC,
  p_fee_amount_eur NUMERIC, p_net_amount_eur NUMERIC, p_captured_at TIMESTAMPTZ,
  p_delivery_email TEXT, p_shipping_name TEXT, p_shipping_address JSONB
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE v_order public.community_support_merch_orders%ROWTYPE; v_date DATE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT v_order FROM public.community_support_merch_orders WHERE id=p_order_id FOR UPDATE;
  IF v_order.status IN ('confirmed','partially_refunded','refunded','reversed') THEN
    RETURN CASE WHEN v_order.paypal_capture_id=p_capture_id THEN 'already_confirmed' ELSE 'capture_conflict' END;
  END IF;
  IF v_order.status<>'approved' OR v_order.paypal_environment<>p_environment OR v_order.paypal_order_id<>p_paypal_order_id OR v_order.paypal_merchant_id<>p_merchant_id THEN RETURN 'binding_mismatch'; END IF;
  IF p_currency<>'EUR' OR p_gross_amount_eur<>v_order.unit_price_eur OR p_fee_amount_eur<0 OR p_net_amount_eur<>p_gross_amount_eur-p_fee_amount_eur THEN RETURN 'amount_mismatch'; END IF;
  IF length(btrim(coalesce(p_delivery_email,'')))<3 OR length(p_delivery_email)>254 OR p_delivery_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RETURN 'delivery_email_missing'; END IF;
  IF v_order.fulfillment_mode='physical' AND (p_shipping_address IS NULL OR jsonb_typeof(p_shipping_address)<>'object' OR octet_length(p_shipping_address::TEXT)>4000 OR length(btrim(coalesce(p_shipping_name,'')))<1) THEN RETURN 'shipping_missing'; END IF;
  v_date := (p_captured_at AT TIME ZONE 'UTC')::DATE;
  UPDATE public.community_support_merch_orders SET status='confirmed',paypal_capture_id=p_capture_id,paypal_fee_eur=p_fee_amount_eur,paypal_net_eur=p_net_amount_eur,delivery_email=lower(btrim(p_delivery_email)),shipping_name=CASE WHEN v_order.fulfillment_mode='physical' THEN left(btrim(p_shipping_name),160) ELSE NULL END,shipping_address=CASE WHEN v_order.fulfillment_mode='physical' THEN p_shipping_address ELSE NULL END,captured_at=p_captured_at,updated_at=now() WHERE id=p_order_id;
  INSERT INTO public.community_support_ledger_entries(entry_date,direction,category,description,amount_eur,is_public,source_type,source_id)
  VALUES (v_date,'income','merchandise_income',left('Merchandise: '||v_order.product_name,160),p_gross_amount_eur,true,'merch_order',p_order_id)
  ON CONFLICT (source_type,source_id,category) WHERE source_type<>'manual' AND source_id IS NOT NULL DO NOTHING;
  IF p_fee_amount_eur>0 THEN
    INSERT INTO public.community_support_ledger_entries(entry_date,direction,category,description,amount_eur,is_public,source_type,source_id)
    VALUES (v_date,'expense','payment_fee',left('PayPal-kosten merchandise: '||v_order.product_name,160),p_fee_amount_eur,true,'merch_order',p_order_id)
    ON CONFLICT (source_type,source_id,category) WHERE source_type<>'manual' AND source_id IS NOT NULL DO NOTHING;
  END IF;
  IF v_order.purchase_price_eur>0 THEN
    INSERT INTO public.community_support_ledger_entries(entry_date,direction,category,description,amount_eur,is_public,source_type,source_id)
    VALUES (v_date,'expense','merchandise_purchase',left('Inkoop: '||v_order.product_name,160),v_order.purchase_price_eur,true,'merch_order',p_order_id)
    ON CONFLICT (source_type,source_id,category) WHERE source_type<>'manual' AND source_id IS NOT NULL DO NOTHING;
  END IF;
  IF v_order.shipping_cost_eur>0 THEN
    INSERT INTO public.community_support_ledger_entries(entry_date,direction,category,description,amount_eur,is_public,source_type,source_id)
    VALUES (v_date,'expense','shipping',left('Verzending: '||v_order.product_name,160),v_order.shipping_cost_eur,true,'merch_order',p_order_id)
    ON CONFLICT (source_type,source_id,category) WHERE source_type<>'manual' AND source_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN 'confirmed';
END;
$$;

CREATE OR REPLACE FUNCTION public.paypal_refund_community_support_merch_capture(
  p_environment TEXT, p_capture_id TEXT, p_refund_id TEXT, p_currency TEXT,
  p_refund_amount_eur NUMERIC, p_refunded_at TIMESTAMPTZ, p_reversal BOOLEAN DEFAULT false
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE v_order public.community_support_merch_orders%ROWTYPE; v_refund_id UUID; v_total NUMERIC;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT v_order FROM public.community_support_merch_orders WHERE paypal_environment=p_environment AND paypal_capture_id=p_capture_id FOR UPDATE;
  SELECT id INTO v_refund_id FROM public.community_support_merch_refunds WHERE paypal_environment=p_environment AND paypal_refund_id=p_refund_id;
  IF FOUND THEN RETURN 'already_refunded'; END IF;
  IF p_currency<>'EUR' OR p_refund_amount_eur<=0 OR v_order.refunded_amount_eur+p_refund_amount_eur>v_order.unit_price_eur THEN RETURN 'amount_mismatch'; END IF;
  INSERT INTO public.community_support_merch_refunds(order_id,paypal_environment,paypal_refund_id,amount_eur,refunded_at)
  VALUES(v_order.id,p_environment,p_refund_id,p_refund_amount_eur,p_refunded_at) RETURNING id INTO v_refund_id;
  v_total:=v_order.refunded_amount_eur+p_refund_amount_eur;
  UPDATE public.community_support_merch_orders SET refunded_amount_eur=v_total,status=CASE WHEN p_reversal THEN 'reversed' WHEN v_total=unit_price_eur THEN 'refunded' ELSE 'partially_refunded' END,updated_at=now() WHERE id=v_order.id;
  INSERT INTO public.community_support_ledger_entries(entry_date,direction,category,description,amount_eur,is_public,source_type,source_id)
  VALUES((p_refunded_at AT TIME ZONE 'UTC')::DATE,'expense','payment_refund',left(CASE WHEN p_reversal THEN 'Terugboeking: ' ELSE 'Refund: ' END||v_order.product_name,160),p_refund_amount_eur,true,'merch_refund',v_refund_id);
  RETURN 'refunded';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_community_support_merch_orders()
RETURNS SETOF public.community_support_merch_orders
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT orders.* FROM public.community_support_merch_orders AS orders
  WHERE public.has_role(auth.uid(),'admin'::public.app_role) OR public.has_role(auth.uid(),'super_admin'::public.app_role)
  ORDER BY orders.created_at DESC LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.paypal_create_community_support_merch_order(UUID,UUID,TEXT), public.paypal_attach_community_support_merch_order(UUID,UUID,TEXT,TEXT,TEXT), public.paypal_begin_community_support_merch_capture(UUID,UUID,TEXT,TEXT), public.paypal_cancel_community_support_merch_order(UUID,UUID,TEXT,TEXT), public.paypal_settle_community_support_merch_capture(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,TIMESTAMPTZ,TEXT,TEXT,JSONB), public.paypal_refund_community_support_merch_capture(TEXT,TEXT,TEXT,TEXT,NUMERIC,TIMESTAMPTZ,BOOLEAN), public.get_admin_community_support_merch_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_create_community_support_merch_order(UUID,UUID,TEXT), public.paypal_attach_community_support_merch_order(UUID,UUID,TEXT,TEXT,TEXT), public.paypal_begin_community_support_merch_capture(UUID,UUID,TEXT,TEXT), public.paypal_cancel_community_support_merch_order(UUID,UUID,TEXT,TEXT), public.paypal_settle_community_support_merch_capture(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,TIMESTAMPTZ,TEXT,TEXT,JSONB), public.paypal_refund_community_support_merch_capture(TEXT,TEXT,TEXT,TEXT,NUMERIC,TIMESTAMPTZ,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_community_support_merch_orders() TO authenticated;

DO $migration$
DECLARE v_definition TEXT; v_updated TEXT;
BEGIN
  v_definition := pg_get_functiondef('public.get_public_community_support_data()'::regprocedure);
  v_updated := replace(v_definition, '''stock'', product.stock,', '''stock'', product.stock, ''fulfillmentMode'', product.fulfillment_mode,');
  IF v_updated=v_definition THEN RAISE EXCEPTION 'Public product projection could not be upgraded'; END IF;
  EXECUTE v_updated;
END
$migration$;

CREATE OR REPLACE FUNCTION public.admin_delete_community_support_item(p_entity TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  CASE p_entity
    WHEN 'ledger' THEN DELETE FROM public.community_support_ledger_entries WHERE id=p_id AND source_type='manual';
    WHEN 'recurring_cost' THEN DELETE FROM public.community_support_recurring_costs WHERE id=p_id;
    WHEN 'product' THEN DELETE FROM public.community_support_products product WHERE product.id=p_id AND NOT EXISTS (SELECT 1 FROM public.community_support_merch_orders orders WHERE orders.product_id=product.id AND orders.status IN ('pending','approved'));
    WHEN 'race_cost' THEN UPDATE public.community_support_race_costs SET deleted_at=now(),updated_at=now(),updated_by=auth.uid() WHERE id=p_id AND deleted_at IS NULL;
    ELSE RAISE EXCEPTION 'Unsupported Community Support entity' USING ERRCODE='22023';
  END CASE;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_community_support_data()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only super-admins can clear shared Community Support data' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.community_support_products product WHERE NOT EXISTS (SELECT 1 FROM public.community_support_merch_orders orders WHERE orders.product_id=product.id AND orders.status IN ('pending','approved'));
  DELETE FROM public.community_support_race_costs;
  DELETE FROM public.community_support_recurring_costs;
  DELETE FROM public.community_support_ledger_entries WHERE source_type='manual';
  UPDATE public.community_support_settings SET reserve_eur=0,reserve_start_year=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER,race_pricing_initialized=false,usd_eur_rate=0.9200,public_supporter_names_by_default=true,public_supporter_amounts_by_default=false,updated_at=now(),updated_by=auth.uid() WHERE singleton=true;
END;
$$;
