BEGIN;

CREATE TABLE public.community_support_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  reserve_eur NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (reserve_eur >= 0),
  reserve_start_year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER CHECK (reserve_start_year BETWEEN 2000 AND 2100),
  race_pricing_initialized BOOLEAN NOT NULL DEFAULT false,
  usd_eur_rate NUMERIC(8,4) NOT NULL DEFAULT 0.9200 CHECK (usd_eur_rate > 0 AND usd_eur_rate <= 10),
  public_supporter_names_by_default BOOLEAN NOT NULL DEFAULT true,
  public_supporter_amounts_by_default BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.community_support_settings (singleton) VALUES (true);

CREATE TABLE public.community_support_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date DATE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  category TEXT NOT NULL CHECK (category IN ('contribution','merchandise_income','referral_income','hosting','server','domain','software','development','event','payment_fee','payment_refund','merchandise_purchase','shipping','other')),
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 160),
  amount_eur NUMERIC(12,2) NOT NULL CHECK (amount_eur > 0 AND amount_eur <= 1000000),
  is_public BOOLEAN NOT NULL DEFAULT true,
  supporter_name TEXT CHECK (supporter_name IS NULL OR length(supporter_name) <= 100),
  show_supporter_name BOOLEAN NOT NULL DEFAULT false,
  show_amount BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (
    (direction = 'income' AND category IN ('contribution','merchandise_income','referral_income','other'))
    OR (direction = 'expense' AND category IN ('hosting','server','domain','software','development','event','payment_fee','payment_refund','merchandise_purchase','shipping','other'))
  ),
  CHECK (category = 'contribution' OR (supporter_name IS NULL AND NOT show_supporter_name AND NOT show_amount))
);

CREATE TABLE public.community_support_recurring_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_on DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hosting','server','domain','software','development','other')),
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 160),
  amount_eur NUMERIC(12,2) NOT NULL CHECK (amount_eur > 0 AND amount_eur <= 1000000),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','yearly')),
  is_public BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.community_support_race_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL UNIQUE REFERENCES public.races(id) ON DELETE RESTRICT,
  race_scope TEXT NOT NULL CHECK (race_scope IN ('season','standalone')),
  league_id UUID REFERENCES public.leagues(id) ON DELETE RESTRICT,
  league_name TEXT CHECK (league_name IS NULL OR length(league_name) <= 120),
  season TEXT CHECK (season IS NULL OR length(season) <= 40),
  race_name TEXT NOT NULL CHECK (length(btrim(race_name)) BETWEEN 1 AND 160),
  track TEXT NOT NULL CHECK (length(btrim(track)) BETWEEN 1 AND 160),
  race_date DATE NOT NULL,
  race_format TEXT CHECK (race_format IS NULL OR length(race_format) <= 80),
  hosted_hours INTEGER NOT NULL DEFAULT 1 CHECK (hosted_hours BETWEEN 1 AND 24),
  discount_applied BOOLEAN NOT NULL DEFAULT false,
  source_amount_usd NUMERIC(12,2) NOT NULL CHECK (source_amount_usd > 0),
  exchange_rate_usd_eur NUMERIC(8,4) NOT NULL CHECK (exchange_rate_usd_eur > 0 AND exchange_rate_usd_eur <= 10),
  amount_eur NUMERIC(12,2) NOT NULL CHECK (amount_eur > 0),
  is_public BOOLEAN NOT NULL DEFAULT true,
  note TEXT CHECK (note IS NULL OR length(note) <= 240),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK ((race_scope = 'season' AND league_id IS NOT NULL) OR (race_scope = 'standalone' AND league_id IS NULL)),
  CHECK (source_amount_usd = round((hosted_hours::NUMERIC * 0.50 * CASE WHEN discount_applied THEN 0.75 ELSE 1 END), 2)),
  CHECK (amount_eur = round(source_amount_usd * exchange_rate_usd_eur, 2)),
  CHECK (coalesce(race_format, '') = '' OR lower(btrim(race_format)) IN ('feature','sprint')),
  CHECK (concat_ws(' ', race_format, league_name, race_name) !~* 'endurance')
);

CREATE TABLE public.community_support_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  price_eur NUMERIC(12,2) NOT NULL CHECK (price_eur >= 0 AND price_eur <= 1000000),
  purchase_price_eur NUMERIC(12,2) NOT NULL CHECK (purchase_price_eur >= 0 AND purchase_price_eur <= 1000000),
  shipping_cost_eur NUMERIC(12,2) NOT NULL CHECK (shipping_cost_eur >= 0 AND shipping_cost_eur <= 1000000),
  stock INTEGER NOT NULL CHECK (stock BETWEEN 0 AND 1000000),
  active BOOLEAN NOT NULL DEFAULT false,
  concept BOOLEAN NOT NULL DEFAULT true,
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (cardinality(image_urls) <= 4),
  CHECK (octet_length(array_to_string(image_urls, '')) <= 1200000)
);

ALTER TABLE public.community_support_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_ledger_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_recurring_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_recurring_costs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_race_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_race_costs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_support_products FORCE ROW LEVEL SECURITY;

CREATE POLICY community_support_settings_admin_select ON public.community_support_settings FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
CREATE POLICY community_support_settings_admin_update ON public.community_support_settings FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY community_support_ledger_admin_select ON public.community_support_ledger_entries FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
CREATE POLICY community_support_ledger_admin_insert ON public.community_support_ledger_entries FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
CREATE POLICY community_support_ledger_admin_update ON public.community_support_ledger_entries FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY community_support_recurring_admin_select ON public.community_support_recurring_costs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
CREATE POLICY community_support_recurring_admin_insert ON public.community_support_recurring_costs FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
CREATE POLICY community_support_recurring_admin_update ON public.community_support_recurring_costs FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY community_support_race_costs_admin_select ON public.community_support_race_costs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY community_support_products_admin_select ON public.community_support_products FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
CREATE POLICY community_support_products_admin_insert ON public.community_support_products FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
CREATE POLICY community_support_products_admin_update ON public.community_support_products FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

REVOKE ALL ON public.community_support_settings, public.community_support_ledger_entries, public.community_support_recurring_costs, public.community_support_race_costs, public.community_support_products FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.community_support_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.community_support_ledger_entries, public.community_support_recurring_costs, public.community_support_products TO authenticated;
GRANT SELECT ON public.community_support_race_costs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_support_settings, public.community_support_ledger_entries, public.community_support_recurring_costs, public.community_support_race_costs, public.community_support_products TO service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_community_support_race_costs(
  p_items JSONB,
  p_initialize_only BOOLEAN DEFAULT false
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_race public.races%ROWTYPE;
  v_league public.leagues%ROWTYPE;
  v_race_id UUID;
  v_hours INTEGER;
  v_discount BOOLEAN;
  v_public BOOLEAN;
  v_note TEXT;
  v_rate NUMERIC(8,4);
  v_source NUMERIC(12,2);
  v_count INTEGER := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Race cost items must be an array containing 1 to 100 records' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT item->>'raceId') FROM jsonb_array_elements(p_items) AS item) THEN
    RAISE EXCEPTION 'Duplicate race IDs are not allowed' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_race_id := (v_item->>'raceId')::UUID;
    v_hours := (v_item->>'hostedHours')::INTEGER;
    v_discount := coalesce((v_item->>'discountApplied')::BOOLEAN, false);
    v_public := coalesce((v_item->>'isPublic')::BOOLEAN, true);
    v_note := nullif(btrim(v_item->>'note'), '');
    IF v_hours NOT BETWEEN 1 AND 24 OR length(coalesce(v_note, '')) > 240 THEN
      RAISE EXCEPTION 'Invalid hosted hours or note' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO STRICT v_race FROM public.races WHERE id = v_race_id;
    v_league := NULL;
    IF v_race.league_id IS NOT NULL THEN
      SELECT * INTO STRICT v_league FROM public.leagues WHERE id = v_race.league_id;
    END IF;
    IF v_race.status <> 'completed'
       OR concat_ws(' ', v_race.race_type, v_league.name, v_race.name) ~* 'endurance'
       OR NOT (
         lower(btrim(coalesce(v_race.race_type, ''))) IN ('feature','sprint')
         OR (nullif(btrim(coalesce(v_race.race_type, '')), '') IS NULL AND v_race.league_id IS NULL)
       ) THEN
      RAISE EXCEPTION 'Race % is not eligible for Community Support hosting costs', v_race_id USING ERRCODE = '22023';
    END IF;

    SELECT cost.exchange_rate_usd_eur INTO v_rate
    FROM public.community_support_race_costs AS cost
    WHERE cost.race_id = v_race_id;
    IF NOT FOUND THEN
      SELECT settings.usd_eur_rate INTO STRICT v_rate
      FROM public.community_support_settings AS settings WHERE settings.singleton = true;
    END IF;
    v_source := round(v_hours::NUMERIC * 0.50 * CASE WHEN v_discount THEN 0.75 ELSE 1 END, 2);

    IF p_initialize_only THEN
      INSERT INTO public.community_support_race_costs (
        race_id, race_scope, league_id, league_name, season, race_name, track, race_date, race_format,
        hosted_hours, discount_applied, source_amount_usd, exchange_rate_usd_eur, amount_eur,
        is_public, note, created_by, updated_by
      ) VALUES (
        v_race.id, CASE WHEN v_race.league_id IS NULL THEN 'standalone' ELSE 'season' END,
        v_race.league_id, v_league.name, v_league.season, v_race.name, v_race.track, v_race.race_date::DATE,
        nullif(btrim(v_race.race_type), ''), v_hours, v_discount, v_source, v_rate,
        round(v_source * v_rate, 2), v_public, v_note, auth.uid(), auth.uid()
      ) ON CONFLICT (race_id) DO NOTHING;
    ELSE
      INSERT INTO public.community_support_race_costs (
        race_id, race_scope, league_id, league_name, season, race_name, track, race_date, race_format,
        hosted_hours, discount_applied, source_amount_usd, exchange_rate_usd_eur, amount_eur,
        is_public, note, created_by, updated_by
      ) VALUES (
        v_race.id, CASE WHEN v_race.league_id IS NULL THEN 'standalone' ELSE 'season' END,
        v_race.league_id, v_league.name, v_league.season, v_race.name, v_race.track, v_race.race_date::DATE,
        nullif(btrim(v_race.race_type), ''), v_hours, v_discount, v_source, v_rate,
        round(v_source * v_rate, 2), v_public, v_note, auth.uid(), auth.uid()
      )
      ON CONFLICT (race_id) DO UPDATE SET
        hosted_hours = EXCLUDED.hosted_hours,
        discount_applied = EXCLUDED.discount_applied,
        source_amount_usd = EXCLUDED.source_amount_usd,
        amount_eur = round(EXCLUDED.source_amount_usd * community_support_race_costs.exchange_rate_usd_eur, 2),
        is_public = EXCLUDED.is_public,
        note = EXCLUDED.note,
        deleted_at = NULL,
        updated_at = now(),
        updated_by = auth.uid();
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
EXCEPTION WHEN NO_DATA_FOUND THEN
  RAISE EXCEPTION 'Race or league not found' USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_community_support_race_costs(JSONB, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_community_support_race_costs(JSONB, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_community_support_item(p_entity TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  CASE p_entity
    WHEN 'ledger' THEN
      DELETE FROM public.community_support_ledger_entries WHERE id = p_id;
    WHEN 'recurring_cost' THEN
      DELETE FROM public.community_support_recurring_costs WHERE id = p_id;
    WHEN 'product' THEN
      DELETE FROM public.community_support_products WHERE id = p_id;
    WHEN 'race_cost' THEN
      UPDATE public.community_support_race_costs
      SET deleted_at = now(), updated_at = now(), updated_by = auth.uid()
      WHERE id = p_id AND deleted_at IS NULL;
    ELSE
      RAISE EXCEPTION 'Unsupported Community Support entity' USING ERRCODE = '22023';
  END CASE;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_community_support_item(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_community_support_item(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_community_support_data()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT jsonb_build_object(
    'settings', jsonb_build_object(
      'reserve', settings.reserve_eur,
      'reserveStartYear', settings.reserve_start_year::TEXT,
      'racePricingInitialized', settings.race_pricing_initialized,
      'usdEurRate', settings.usd_eur_rate,
      'publicSupporterNamesByDefault', settings.public_supporter_names_by_default,
      'publicSupporterAmountsByDefault', settings.public_supporter_amounts_by_default
    ),
    'ledger', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', entry.id::TEXT,
        'date', entry.entry_date::TEXT,
        'direction', entry.direction,
        'category', entry.category,
        'description', entry.description,
        'amount', CASE WHEN entry.category = 'contribution' AND NOT entry.show_amount THEN NULL ELSE entry.amount_eur END,
        'isPublic', true,
        'supporterName', CASE WHEN entry.category = 'contribution' AND entry.show_supporter_name THEN nullif(btrim(entry.supporter_name), '') ELSE NULL END,
        'showSupporterName', entry.category = 'contribution' AND entry.show_supporter_name,
        'showAmount', entry.category <> 'contribution' OR entry.show_amount
      ) ORDER BY entry.entry_date DESC, entry.created_at DESC)
      FROM public.community_support_ledger_entries AS entry
      WHERE entry.is_public
    ), '[]'::jsonb),
    'ledgerTotals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'month', totals.month,
        'direction', totals.direction,
        'category', totals.category,
        'amount', totals.amount
      ) ORDER BY totals.month DESC, totals.direction, totals.category)
      FROM (
        SELECT to_char(entry.entry_date, 'YYYY-MM') AS month, entry.direction, entry.category, sum(entry.amount_eur) AS amount
        FROM public.community_support_ledger_entries AS entry
        GROUP BY 1, 2, 3
      ) AS totals
    ), '[]'::jsonb),
    'costTotals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'month', totals.month,
        'category', totals.category,
        'amount', totals.amount
      ) ORDER BY totals.month DESC, totals.category)
      FROM (
        SELECT to_char(months.month_start, 'YYYY-MM') AS month, cost.category, sum(cost.amount_eur) AS amount
        FROM public.community_support_recurring_costs AS cost
        CROSS JOIN LATERAL generate_series(
          date_trunc('month', cost.starts_on::TIMESTAMP),
          date_trunc('year', CURRENT_DATE::TIMESTAMP) + INTERVAL '11 months',
          INTERVAL '1 month'
        ) AS months(month_start)
        WHERE cost.active
          AND (cost.frequency = 'monthly' OR EXTRACT(MONTH FROM months.month_start) = EXTRACT(MONTH FROM cost.starts_on))
        GROUP BY 1, 2
        UNION ALL
        SELECT to_char(cost.race_date, 'YYYY-MM') AS month, 'race_hosting' AS category, sum(cost.amount_eur) AS amount
        FROM public.community_support_race_costs AS cost
        WHERE cost.deleted_at IS NULL
        GROUP BY 1
      ) AS totals
    ), '[]'::jsonb),
    'recurringCosts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cost.id::TEXT, 'startsOn', cost.starts_on::TEXT, 'category', cost.category,
        'description', cost.description, 'amount', cost.amount_eur, 'frequency', cost.frequency,
        'isPublic', true, 'active', cost.active
      ) ORDER BY cost.starts_on DESC, cost.created_at DESC)
      FROM public.community_support_recurring_costs AS cost WHERE cost.is_public
    ), '[]'::jsonb),
    'raceCosts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cost.id::TEXT, 'raceId', cost.race_id::TEXT, 'raceScope', cost.race_scope,
        'leagueName', cost.league_name, 'season', cost.season, 'raceName', cost.race_name,
        'track', cost.track, 'date', cost.race_date::TEXT, 'raceFormat', cost.race_format,
        'hostedHours', cost.hosted_hours, 'discountApplied', cost.discount_applied,
        'sourceAmountUsd', cost.source_amount_usd, 'exchangeRateUsdEur', cost.exchange_rate_usd_eur,
        'amount', cost.amount_eur, 'isPublic', true
      ) ORDER BY cost.race_date DESC)
      FROM public.community_support_race_costs AS cost WHERE cost.is_public AND cost.deleted_at IS NULL
    ), '[]'::jsonb),
    'products', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', product.id::TEXT, 'name', product.name, 'description', product.description,
        'price', product.price_eur, 'stock', product.stock,
        'active', product.active, 'concept', product.concept, 'imageUrls', to_jsonb(product.image_urls)
      ) ORDER BY product.created_at DESC)
      FROM public.community_support_products AS product WHERE product.active AND NOT product.concept
    ), '[]'::jsonb)
  )
  FROM public.community_support_settings AS settings
  WHERE settings.singleton = true;
$$;

REVOKE ALL ON FUNCTION public.get_public_community_support_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_community_support_data() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_community_support_data()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only super-admins can clear shared Community Support data' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.community_support_products;
  DELETE FROM public.community_support_race_costs;
  DELETE FROM public.community_support_recurring_costs;
  DELETE FROM public.community_support_ledger_entries;
  UPDATE public.community_support_settings
  SET reserve_eur = 0,
      reserve_start_year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER,
      race_pricing_initialized = false,
      usd_eur_rate = 0.9200,
      public_supporter_names_by_default = true,
      public_supporter_amounts_by_default = false,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE singleton = true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_clear_community_support_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_community_support_data() TO authenticated;

-- Seed exactly the same completed, supported races that the former local
-- Race Costs tab initialized with one hosted hour, no discount and the
-- then-current default exchange rate. Existing source records are snapshots.
INSERT INTO public.community_support_race_costs (
  race_id, race_scope, league_id, league_name, season, race_name, track, race_date,
  race_format, hosted_hours, discount_applied, source_amount_usd,
  exchange_rate_usd_eur, amount_eur, is_public
)
SELECT
  race.id,
  CASE WHEN race.league_id IS NULL THEN 'standalone' ELSE 'season' END,
  race.league_id,
  league.name,
  league.season,
  race.name,
  race.track,
  race.race_date::DATE,
  nullif(btrim(race.race_type), ''),
  1,
  false,
  0.50,
  settings.usd_eur_rate,
  round(0.50 * settings.usd_eur_rate, 2),
  true
FROM public.races AS race
LEFT JOIN public.leagues AS league ON league.id = race.league_id
CROSS JOIN public.community_support_settings AS settings
WHERE settings.singleton = true
  AND race.status = 'completed'
  AND concat_ws(' ', race.race_type, league.name, race.name) !~* 'endurance'
  AND (
    lower(btrim(coalesce(race.race_type, ''))) IN ('feature','sprint')
    OR (nullif(btrim(coalesce(race.race_type, '')), '') IS NULL AND race.league_id IS NULL)
  )
ON CONFLICT (race_id) DO NOTHING;

UPDATE public.community_support_settings
SET race_pricing_initialized = true, updated_at = now()
WHERE singleton = true AND EXISTS (SELECT 1 FROM public.community_support_race_costs);

COMMIT;
