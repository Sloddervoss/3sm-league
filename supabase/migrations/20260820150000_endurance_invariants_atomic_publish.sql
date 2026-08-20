-- Endurance invariants + atomic plan publication (Fase 3 hardening, additive).
-- ----------------------------------------------------------------------------
-- Backwards-compatibele verharding over de bestaande data-laag:
--   1) eventgebonden team-lidmaatschap: nullable `event_id` op
--      endurance_team_members, backfill + trigger om het af te leiden uit de
--      owning team, en een partiële unique index zodat één gebruiker hooguit
--      één effectief team-lidmaatschap per event heeft. Legacy-inserts die
--      `event_id` weglaten blijven werken (de trigger vult het dan zelf in).
--   2) hoogstens één open practice-sessie per event/team via een partiële
--      unique index op `ended_at IS NULL`.
--   3) één SECURITY DEFINER RPC die versie + alle confirmations atomair
--      publiceert en de manager/event/team-autorisatie server-side valideert.
-- Geen destructieve opschoning; geen andere tabellen/policies gewijzigd.
BEGIN;

-- =====================================================================
-- (1) event_id op endurance_team_members, afgeleid uit de owning team
-- =====================================================================

ALTER TABLE public.endurance_team_members
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.endurance_events(id) ON DELETE CASCADE;

-- Backfill voor bestaande rijen: event_id volgt altijd uit team_id.
UPDATE public.endurance_team_members AS member
SET event_id = team.event_id
FROM public.endurance_teams AS team
WHERE team.id = member.team_id
  AND member.event_id IS NULL;

-- Niet-destructieve preflight: stop met een gerichte herstelmelding wanneer
-- bestaande data een nieuwe invariant schendt. Deze migratie kiest nooit zelf
-- een crew, sluit nooit een practice en depubliseert geen historisch plan.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.endurance_team_members
    WHERE event_id IS NOT NULL
    GROUP BY event_id, user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight failed: duplicate team membership per user/event; reconcile before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.endurance_practice_sessions
    WHERE ended_at IS NULL
    GROUP BY event_id, COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight failed: multiple open practices per event/team; reconcile before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.endurance_planning_versions
    WHERE published = true
    GROUP BY event_id, team_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight failed: multiple published plans per event/team; reconcile before migration';
  END IF;
END;
$$;

-- Trigger houdt event_id automatisch in sync bij INSERT en bij team-wissel.
-- Legacy client-payloads die `event_id` niet meesturen blijven geldig:
-- de trigger leidt event_id af uit de owning team. Zo blijft de API-shape
-- backward-compatibel terwijl de invariant in de database hard is.
CREATE OR REPLACE FUNCTION public.endurance_team_members_derive_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.team_id IS NOT NULL THEN
    SELECT team.event_id INTO NEW.event_id
    FROM public.endurance_teams AS team
    WHERE team.id = NEW.team_id;
    IF NOT FOUND THEN
      NEW.event_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS endurance_team_members_derive_event_trg ON public.endurance_team_members;
CREATE TRIGGER endurance_team_members_derive_event_trg
  BEFORE INSERT OR UPDATE ON public.endurance_team_members
  FOR EACH ROW EXECUTE FUNCTION public.endurance_team_members_derive_event();

-- Invariant: hoogstens één effectief team-lidmaatschap per gebruiker per
-- event. NULL event_id wordt niet afgedwongen (backward-compatibele legacy
-- regels), maar doordat de trigger elke nieuwe/gewijzigde rij een event_id
-- geeft, is de index praktisch volledig. Een tweede team voor dezelfde
-- gebruiker binnen hetzelfde event wordt hierdoor hard geweigerd
-- (geen zachte is_primary-keuze).
CREATE UNIQUE INDEX IF NOT EXISTS endurance_team_members_one_per_user_event_idx
  ON public.endurance_team_members (event_id, user_id)
  WHERE event_id IS NOT NULL;

-- =====================================================================
-- (2) één open practice-sessie per event/team
-- =====================================================================
-- Preflight: deze migratie is additief en doet GEEN destructieve opschoning.
-- Als er in de huidige data al meerdere open sessies voor één event/team
-- bestaan, moet dat vóór toepassing gereconcilieerd worden (anders faalt de
-- index-aanmaak). De index zelf is de énige garantie; er worden geen rijen
-- gesloten of verwijderd door deze migration.
CREATE UNIQUE INDEX IF NOT EXISTS endurance_practice_sessions_one_open_per_event_team_idx
  ON public.endurance_practice_sessions (COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid), event_id)
  WHERE ended_at IS NULL;

-- =====================================================================
-- (3) Eén actuele gepubliceerde planning per event/team
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS endurance_planning_versions_one_published_per_event_team_idx
  ON public.endurance_planning_versions (event_id, team_id)
  WHERE published = true;

-- =====================================================================
-- Atomic plan-publication RPC
-- =====================================================================
CREATE OR REPLACE FUNCTION public.endurance_publish_plan(
  p_event_id uuid,
  p_team_id uuid,
  p_label text,
  p_stints jsonb,
  p_confirmations jsonb
)
RETURNS public.endurance_planning_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_team public.endurance_teams%ROWTYPE;
  v_created_version public.endurance_planning_versions;
  v_confirm RECORD;
  v_json_status public.endurance_confirmation_status;
BEGIN
  -- Expliciet client-auth: anon / geen sessie wordt hard geweigerd.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Serialiseer ook de eerste publicatie, wanneer nog geen published rij bestaat.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_team_id::text, 0));

  SELECT team.* INTO v_team
  FROM public.endurance_teams AS team
  WHERE team.id = p_team_id AND team.event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown event/team combination' USING ERRCODE = '22023';
  END IF;

  -- Globale Endurance Managers én de toegewezen manager van deze crew mogen
  -- publiceren. Dit sluit aan op de bestaande StintPlanner-editability.
  IF NOT public.is_endurance_manager(v_user_id) AND v_team.manager_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_label IS NULL OR char_length(trim(p_label)) = 0 THEN
    RAISE EXCEPTION 'Label is required' USING ERRCODE = '22023';
  END IF;

  IF p_stints IS NULL OR jsonb_typeof(p_stints) <> 'array' THEN
    RAISE EXCEPTION 'Stints must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF p_confirmations IS NULL OR jsonb_typeof(p_confirmations) <> 'array' THEN
    RAISE EXCEPTION 'Confirmations must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_confirmations) > 500 THEN
    RAISE EXCEPTION 'Too many confirmations' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_confirmations) AS item(user_id uuid)
    GROUP BY item.user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate confirmation user_id' USING ERRCODE = '22023';
  END IF;

  -- Nieuwe gepubliceerde versie deelt de vorige uit: exact één actieve.
  UPDATE public.endurance_planning_versions
  SET published = false
  WHERE event_id = p_event_id AND team_id = p_team_id AND published = true;

  INSERT INTO public.endurance_planning_versions (
    event_id, team_id, label, created_by, published, stints, created_at
  ) VALUES (
    p_event_id, p_team_id, trim(p_label), v_user_id, true, p_stints, now()
  )
  RETURNING * INTO v_created_version;

  -- Alle confirmations in dezelfde transactie als de versie (atomic publicatie).
  FOR v_confirm IN SELECT * FROM jsonb_to_recordset(p_confirmations) AS item(
    user_id uuid, status text, note text
  )
  LOOP
    IF v_confirm.user_id IS NULL THEN
      RAISE EXCEPTION 'Confirmation user_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.endurance_team_members AS member
      WHERE member.team_id = p_team_id AND member.user_id = v_confirm.user_id
    ) THEN
      RAISE EXCEPTION 'Confirmation user is not a member of this team' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_json_status := COALESCE(v_confirm.status::public.endurance_confirmation_status, 'unseen');
    EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Invalid confirmation status' USING ERRCODE = '22023';
    END;

    INSERT INTO public.endurance_confirmations (
      event_id, version_id, user_id, status, note, updated_at
    ) VALUES (
      p_event_id, v_created_version.id, v_confirm.user_id, v_json_status, v_confirm.note, now()
    );
  END LOOP;

  RETURN v_created_version;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_publish_plan(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_publish_plan(uuid, uuid, text, jsonb, jsonb) TO authenticated;

COMMIT;