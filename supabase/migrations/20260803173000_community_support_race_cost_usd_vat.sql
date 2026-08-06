BEGIN;

ALTER TABLE public.community_support_race_costs
  ADD COLUMN vat_amount_usd NUMERIC(12,2),
  ADD COLUMN gross_amount_usd NUMERIC(12,2),
  DROP CONSTRAINT community_support_race_costs_vat_amount_check,
  DROP CONSTRAINT community_support_race_costs_total_amount_check;

UPDATE public.community_support_race_costs
SET vat_amount_usd = round(source_amount_usd * vat_rate, 2),
    gross_amount_usd = source_amount_usd + round(source_amount_usd * vat_rate, 2),
    net_amount_eur = round(source_amount_usd * exchange_rate_usd_eur, 2),
    amount_eur = round((source_amount_usd + round(source_amount_usd * vat_rate, 2)) * exchange_rate_usd_eur, 2),
    vat_amount_eur = round((source_amount_usd + round(source_amount_usd * vat_rate, 2)) * exchange_rate_usd_eur, 2)
      - round(source_amount_usd * exchange_rate_usd_eur, 2);

ALTER TABLE public.community_support_race_costs
  ALTER COLUMN vat_amount_usd SET NOT NULL,
  ALTER COLUMN gross_amount_usd SET NOT NULL,
  ADD CONSTRAINT community_support_race_costs_vat_amount_usd_check CHECK (vat_amount_usd = round(source_amount_usd * vat_rate, 2)),
  ADD CONSTRAINT community_support_race_costs_gross_amount_usd_check CHECK (gross_amount_usd = source_amount_usd + vat_amount_usd),
  ADD CONSTRAINT community_support_race_costs_total_amount_check CHECK (amount_eur = round(gross_amount_usd * exchange_rate_usd_eur, 2)),
  ADD CONSTRAINT community_support_race_costs_vat_amount_check CHECK (vat_amount_eur = amount_eur - net_amount_eur);

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
  v_vat_rate CONSTANT NUMERIC(5,4) := 0.21;
  v_vat_usd NUMERIC(12,2);
  v_gross_usd NUMERIC(12,2);
  v_net NUMERIC(12,2);
  v_vat NUMERIC(12,2);
  v_total NUMERIC(12,2);
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
    v_vat_usd := round(v_source * v_vat_rate, 2);
    v_gross_usd := v_source + v_vat_usd;
    v_net := round(v_source * v_rate, 2);
    v_total := round(v_gross_usd * v_rate, 2);
    v_vat := v_total - v_net;

    IF p_initialize_only THEN
      INSERT INTO public.community_support_race_costs (
        race_id, race_scope, league_id, league_name, season, race_name, track, race_date, race_format,
        hosted_hours, discount_applied, source_amount_usd, exchange_rate_usd_eur,
        vat_rate, vat_amount_usd, gross_amount_usd, net_amount_eur, vat_amount_eur, amount_eur,
        is_public, note, created_by, updated_by
      ) VALUES (
        v_race.id, CASE WHEN v_race.league_id IS NULL THEN 'standalone' ELSE 'season' END,
        v_race.league_id, v_league.name, v_league.season, v_race.name, v_race.track, v_race.race_date::DATE,
        nullif(btrim(v_race.race_type), ''), v_hours, v_discount, v_source, v_rate,
        v_vat_rate, v_vat_usd, v_gross_usd, v_net, v_vat, v_total, v_public, v_note, auth.uid(), auth.uid()
      ) ON CONFLICT (race_id) DO NOTHING;
    ELSE
      INSERT INTO public.community_support_race_costs (
        race_id, race_scope, league_id, league_name, season, race_name, track, race_date, race_format,
        hosted_hours, discount_applied, source_amount_usd, exchange_rate_usd_eur,
        vat_rate, vat_amount_usd, gross_amount_usd, net_amount_eur, vat_amount_eur, amount_eur,
        is_public, note, created_by, updated_by
      ) VALUES (
        v_race.id, CASE WHEN v_race.league_id IS NULL THEN 'standalone' ELSE 'season' END,
        v_race.league_id, v_league.name, v_league.season, v_race.name, v_race.track, v_race.race_date::DATE,
        nullif(btrim(v_race.race_type), ''), v_hours, v_discount, v_source, v_rate,
        v_vat_rate, v_vat_usd, v_gross_usd, v_net, v_vat, v_total, v_public, v_note, auth.uid(), auth.uid()
      )
      ON CONFLICT (race_id) DO UPDATE SET
        hosted_hours = EXCLUDED.hosted_hours,
        discount_applied = EXCLUDED.discount_applied,
        source_amount_usd = EXCLUDED.source_amount_usd,
        vat_rate = v_vat_rate,
        vat_amount_usd = round(EXCLUDED.source_amount_usd * v_vat_rate, 2),
        gross_amount_usd = EXCLUDED.source_amount_usd + round(EXCLUDED.source_amount_usd * v_vat_rate, 2),
        net_amount_eur = round(EXCLUDED.source_amount_usd * community_support_race_costs.exchange_rate_usd_eur, 2),
        amount_eur = round((EXCLUDED.source_amount_usd + round(EXCLUDED.source_amount_usd * v_vat_rate, 2)) * community_support_race_costs.exchange_rate_usd_eur, 2),
        vat_amount_eur = round((EXCLUDED.source_amount_usd + round(EXCLUDED.source_amount_usd * v_vat_rate, 2)) * community_support_race_costs.exchange_rate_usd_eur, 2)
          - round(EXCLUDED.source_amount_usd * community_support_race_costs.exchange_rate_usd_eur, 2),
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

DO $migration$
DECLARE
  v_definition TEXT;
  v_updated TEXT;
BEGIN
  v_definition := pg_get_functiondef('public.get_public_community_support_data()'::regprocedure);
  v_updated := replace(
    v_definition,
    '''vatRate'', cost.vat_rate, ''netAmount'', cost.net_amount_eur, ''vatAmount'', cost.vat_amount_eur, ''amount'', cost.amount_eur, ''isPublic'', true',
    '''vatRate'', cost.vat_rate, ''vatAmountUsd'', cost.vat_amount_usd, ''grossAmountUsd'', cost.gross_amount_usd, ''netAmount'', cost.net_amount_eur, ''vatAmount'', cost.vat_amount_eur, ''amount'', cost.amount_eur, ''isPublic'', true'
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Public race-cost USD VAT projection could not be upgraded';
  END IF;
  EXECUTE v_updated;
END
$migration$;

COMMENT ON COLUMN public.community_support_race_costs.vat_amount_usd IS 'VAT in USD after the optional discount, rounded per race before EUR conversion.';
COMMENT ON COLUMN public.community_support_race_costs.gross_amount_usd IS 'Gross USD race-hosting cost including VAT, converted to EUR using the immutable race rate.';
COMMENT ON COLUMN public.community_support_race_costs.vat_amount_eur IS 'Allocated EUR VAT component: gross EUR minus net EUR.';
COMMENT ON COLUMN public.community_support_race_costs.amount_eur IS 'Gross USD including VAT converted to EUR using the immutable race exchange rate.';

COMMIT;
