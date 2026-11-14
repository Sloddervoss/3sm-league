-- ============================================================================
-- S2E2 — public.simhub_observation_policy_v1(text)
--
-- Additief, alleen-lezen service-role-RPC. De Edge-ontvanger (simhub-ingest-v3)
-- publiceert hiermee na een GEACCEPTEERDE V3-write één optioneel
-- identity-scoped policyfeit aan de client:
--
--   {"captureAllowed": true,  "policyVersion": 1}
--   {"captureAllowed": false, "policyVersion": null}
--
-- Autoriteit is uitsluitend de bestaande device-tokenbinding:
--   public.simhub_devices.token_hash -> owner_user_id   (revoked_at IS NULL)
-- en het bestaande persoonlijke beleid:
--   pitwall_learning.account_policy.capture_enabled, policy_version
--
-- De gebruiker geeft nooit een owner, token of hash mee: de aanvrager is de
-- backend die de al gevalideerde tokenhash doorgeeft. Er wordt geen nieuwe
-- allocator, enrollment of policyrij gemaakt. Onbekend/ingetrokken/geen
-- policy/uitgeschakeld betekent weigeren; een ontbrekende policyrij is GEEN
-- inschrijving.
--
-- Deze migratie voegt exact één functie plus haar ACL toe. Geen tabellen,
-- kolommen, grants op andere objecten of return-typewijzigingen.
--
-- Prefix 20261114000945 is door de parent toegewezen en verder ongebruikt.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regprocedure('public.simhub_observation_policy_v1(text)') IS NOT NULL THEN
    RAISE EXCEPTION
      'public.simhub_observation_policy_v1(text) already exists; refusing to adopt it'
      USING ERRCODE = 'PWL20';
  END IF;
  -- De autoriteit moet echt bestaan; anders is dit geen geldige omgeving.
  IF to_regclass('public.simhub_devices') IS NULL THEN
    RAISE EXCEPTION 'public.simhub_devices is missing' USING ERRCODE = 'PWL21';
  END IF;
  IF to_regclass('pitwall_learning.account_policy') IS NULL THEN
    RAISE EXCEPTION 'pitwall_learning.account_policy is missing' USING ERRCODE = 'PWL22';
  END IF;
END
$guard$;

CREATE FUNCTION public.simhub_observation_policy_v1(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_owner   uuid;
  v_capture boolean;
  v_version integer;
BEGIN
  -- Defense-in-depth naast de ACL. De route is backend/machine-tokenauth, dus
  -- er wordt bewust GEEN auth.uid()/JWT-owner geëist: dat zou de bewezen
  -- device-auth-route ten onrechte als browserroute behandelen.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied for observation policy'
      USING ERRCODE = '42501';
  END IF;

  -- NULL-safe en zonder normalisatie: exact 64 kleine hextekens. Een NULL,
  -- hoofdletters, spaties, `0x`-prefix of andere lengte is geen geldige
  -- tokenhash en wordt dus geweigerd in plaats van "gerepareerd".
  IF NOT coalesce(p_token_hash ~ '^[0-9a-f]{64}$', false) THEN
    RETURN jsonb_build_object('captureAllowed', false, 'policyVersion', NULL);
  END IF;

  -- Eén begrensde lookup. De owner komt uit de actieve devicebinding, nooit
  -- uit de aanvraag. LEFT JOIN: een device zonder policyrij is niet ingeschreven.
  SELECT device.owner_user_id, policy.capture_enabled, policy.policy_version
    INTO v_owner, v_capture, v_version
    FROM public.simhub_devices AS device
    LEFT JOIN pitwall_learning.account_policy AS policy
           ON policy.owner_user_id = device.owner_user_id
   WHERE device.token_hash = p_token_hash
     AND device.revoked_at IS NULL;

  IF v_owner IS NULL
     OR v_capture IS NOT TRUE
     OR v_version IS NULL
     OR v_version < 1 THEN
    RETURN jsonb_build_object('captureAllowed', false, 'policyVersion', NULL);
  END IF;

  -- Nooit een onbekende/negatieve versie tot 1 omdopen: de echte versie gaat
  -- mee en de client beslist zelf of hij die ondersteunt.
  RETURN jsonb_build_object('captureAllowed', true, 'policyVersion', v_version);
END
$fn$;

COMMENT ON FUNCTION public.simhub_observation_policy_v1(text) IS
  'Read-only, service-role-only projection of the existing account capture policy for an active device token hash. Denies unknown/revoked/no-policy/disabled accounts. No owner, token or hash is returned.';

-- PostgreSQL geeft nieuwe functies standaard EXECUTE aan PUBLIC. Die default
-- wordt hier expliciet ingetrokken; alleen service_role houdt EXECUTE.
REVOKE ALL ON FUNCTION public.simhub_observation_policy_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_observation_policy_v1(text)
  TO service_role;
