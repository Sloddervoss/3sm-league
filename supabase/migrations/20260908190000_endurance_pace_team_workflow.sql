BEGIN;

-- Reconcile prerequisite invariants on installations that predate atomic planning.
ALTER TABLE public.endurance_team_members
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.endurance_events(id) ON DELETE CASCADE;

-- Backfill voor bestaande rijen: event_id volgt altijd uit team_id.
UPDATE public.endurance_team_members AS member
SET event_id = team.event_id
FROM public.endurance_teams AS team
WHERE team.id = member.team_id
  AND member.event_id IS NULL;

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


CREATE UNIQUE INDEX IF NOT EXISTS endurance_planning_versions_one_published_per_event_team_idx ON public.endurance_planning_versions(event_id,team_id) WHERE published=true;

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

  PERFORM 1 FROM public.endurance_events WHERE id=p_event_id FOR UPDATE;

  SELECT team.* INTO v_team
  FROM public.endurance_teams AS team
  WHERE team.id = p_team_id AND team.event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown event/team combination' USING ERRCODE = '22023';
  END IF;

  -- Globale Endurance Managers én de toegewezen manager van deze crew mogen
  -- publiceren. Dit sluit aan op de bestaande StintPlanner-editability.
  IF NOT public.endurance_can_manage_roster(p_event_id) AND v_team.manager_id IS DISTINCT FROM v_user_id THEN
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


CREATE OR REPLACE FUNCTION public.endurance_replace_draft_stints(
  p_event_id uuid,
  p_team_id uuid,
  p_stints jsonb
)
RETURNS SETOF public.endurance_stints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_event public.endurance_events%ROWTYPE;
  v_team public.endurance_teams%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_event FROM public.endurance_events WHERE id = p_event_id FOR UPDATE;
  SELECT * INTO v_team FROM public.endurance_teams WHERE id = p_team_id AND event_id = p_event_id;
  IF NOT FOUND OR v_event.id IS NULL THEN
    RAISE EXCEPTION 'Unknown event/team combination' USING ERRCODE = '22023';
  END IF;

  IF NOT public.endurance_can_manage_roster(p_event_id) AND v_team.manager_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_stints IS NULL OR jsonb_typeof(p_stints) <> 'array'
     OR jsonb_array_length(p_stints) < 1 OR jsonb_array_length(p_stints) > 200 THEN
    RAISE EXCEPTION 'Stints must be a non-empty array of at most 200 items' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.endurance_stints
    WHERE event_id = p_event_id AND team_id = p_team_id AND status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'A non-draft plan already exists' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_stints) AS item(
      driver_id uuid, original_start_at timestamptz, original_end_at timestamptz,
      actual_start_at timestamptz, actual_end_at timestamptz,
      expected_laps integer, fuel_litres numeric, tyre_change boolean,
      double_stint boolean, notes text
    )
    WHERE item.original_start_at IS NULL OR item.original_end_at IS NULL
       OR item.actual_start_at IS NULL OR item.actual_end_at IS NULL
       OR item.original_start_at >= item.original_end_at
       OR item.actual_start_at >= item.actual_end_at
       OR item.actual_start_at < v_event.start_at OR item.actual_end_at > v_event.end_at
       OR item.expected_laps < 0 OR item.fuel_litres < 0
       OR (item.driver_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.endurance_team_members member
         WHERE member.team_id = p_team_id AND member.user_id = item.driver_id
       ))
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_stints) WITH ORDINALITY AS left_item(value, position)
    JOIN jsonb_array_elements(p_stints) WITH ORDINALITY AS right_item(value, position)
      ON left_item.position < right_item.position
     AND tstzrange((left_item.value->>'actual_start_at')::timestamptz, (left_item.value->>'actual_end_at')::timestamptz, '[)')
         && tstzrange((right_item.value->>'actual_start_at')::timestamptz, (right_item.value->>'actual_end_at')::timestamptz, '[)')
  ) THEN
    RAISE EXCEPTION 'Invalid or overlapping stint payload' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.endurance_stints
  WHERE event_id = p_event_id AND team_id = p_team_id AND status = 'draft';

  RETURN QUERY
  INSERT INTO public.endurance_stints (
    event_id, team_id, driver_id,
    original_start_at, original_end_at, actual_start_at, actual_end_at,
    expected_laps, fuel_litres, tyre_change, double_stint, notes, status
  )
  SELECT
    p_event_id, p_team_id, item.driver_id,
    item.original_start_at, item.original_end_at,
    item.actual_start_at, item.actual_end_at,
    item.expected_laps, item.fuel_litres,
    COALESCE(item.tyre_change, false), COALESCE(item.double_stint, false),
    item.notes, 'draft'::public.endurance_stint_status
  FROM jsonb_to_recordset(p_stints) AS item(
    driver_id uuid, original_start_at timestamptz, original_end_at timestamptz,
    actual_start_at timestamptz, actual_end_at timestamptz,
    expected_laps integer, fuel_litres numeric, tyre_change boolean,
    double_stint boolean, notes text
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_replace_draft_stints(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_replace_draft_stints(uuid, uuid, jsonb) TO authenticated;



ALTER TABLE public.endurance_registrations
  ADD COLUMN IF NOT EXISTS team_approach text NOT NULL DEFAULT 'either' CHECK (team_approach IN ('competitive','fun','either')),
  ADD COLUMN IF NOT EXISTS preferred_team_size integer CHECK (preferred_team_size BETWEEN 1 AND 64);
ALTER TABLE public.endurance_teams
  ADD COLUMN IF NOT EXISTS target_size integer CHECK (target_size BETWEEN 1 AND 64),
  ADD COLUMN IF NOT EXISTS team_approach text NOT NULL DEFAULT 'either' CHECK (team_approach IN ('competitive','fun','either')),
  ADD COLUMN IF NOT EXISTS plan_needs_review boolean NOT NULL DEFAULT false;

-- Existing race values remain unchanged: this is the event ceiling, not a crew target.
CREATE OR REPLACE FUNCTION public.endurance_can_manage_roster(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (public.is_endurance_manager(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.endurance_events WHERE id=p_event_id AND auth.uid()=ANY(manager_ids)
  ));
$$;
REVOKE ALL ON FUNCTION public.endurance_can_manage_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_can_manage_roster(uuid) TO authenticated;

CREATE POLICY "endurance event manager teams" ON public.endurance_teams FOR SELECT TO authenticated USING(public.endurance_can_manage_roster(event_id));
CREATE POLICY "endurance event manager members" ON public.endurance_team_members FOR SELECT TO authenticated USING(public.endurance_can_manage_roster(event_id));
CREATE POLICY "endurance event manager availability" ON public.endurance_availability FOR SELECT TO authenticated USING(public.endurance_can_manage_roster(event_id));
CREATE POLICY "endurance event manager pace" ON public.endurance_pace_entries FOR ALL TO authenticated USING(public.endurance_can_manage_roster(event_id)) WITH CHECK(public.endurance_can_manage_roster(event_id));
CREATE POLICY "endurance event manager practice" ON public.endurance_practice_sessions FOR ALL TO authenticated USING(public.endurance_can_manage_roster(event_id)) WITH CHECK(public.endurance_can_manage_roster(event_id));
CREATE POLICY "endurance event manager laps" ON public.endurance_practice_laps FOR SELECT TO authenticated USING(public.endurance_can_manage_roster(event_id));
CREATE POLICY "endurance assigned manager stints" ON public.endurance_stints FOR ALL TO authenticated
  USING(public.endurance_can_manage_roster(event_id) OR EXISTS(SELECT 1 FROM public.endurance_teams t WHERE t.id=team_id AND t.event_id=endurance_stints.event_id AND t.manager_id=auth.uid()))
  WITH CHECK(public.endurance_can_manage_roster(event_id) OR EXISTS(SELECT 1 FROM public.endurance_teams t WHERE t.id=team_id AND t.event_id=endurance_stints.event_id AND t.manager_id=auth.uid()));
CREATE POLICY "endurance event manager plans" ON public.endurance_planning_versions FOR SELECT TO authenticated USING(public.endurance_can_manage_roster(event_id));
CREATE POLICY "endurance event manager confirmations" ON public.endurance_confirmations FOR SELECT TO authenticated USING(public.endurance_can_manage_roster(event_id));

-- Race managers and the manager of a driver's team need the planning constraints.
CREATE POLICY "endurance roster manager registrations" ON public.endurance_registrations
  FOR SELECT TO authenticated USING (public.endurance_can_manage_roster(event_id) OR EXISTS (
    SELECT 1 FROM public.endurance_team_members m JOIN public.endurance_teams t ON t.id=m.team_id
    WHERE m.user_id=endurance_registrations.user_id AND t.event_id=endurance_registrations.event_id AND t.manager_id=auth.uid()
  ));

-- A single snapshot supplies the proposal and its optimistic concurrency token.
CREATE OR REPLACE FUNCTION public.endurance_team_workspace(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp AS $$
DECLARE v_data jsonb;
BEGIN
  IF NOT public.endurance_can_manage_roster(p_event_id) THEN RAISE EXCEPTION 'Geen toegang tot de teamindeling.' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'event', (SELECT to_jsonb(e) FROM public.endurance_events e WHERE e.id=p_event_id),
    'teams', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.endurance_teams t WHERE t.event_id=p_event_id),'[]'::jsonb),
    'members', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.endurance_team_members m JOIN public.endurance_teams t ON t.id=m.team_id WHERE t.event_id=p_event_id),'[]'::jsonb),
    'registrations', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.endurance_registrations r WHERE r.event_id=p_event_id),'[]'::jsonb),
    'pace', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.endurance_pace_entries p WHERE p.event_id=p_event_id),'[]'::jsonb),
    'availability', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.endurance_availability a WHERE a.event_id=p_event_id),'[]'::jsonb)
  ) INTO v_data;
  RETURN jsonb_build_object('data',v_data,'revision',md5(v_data::text));
END;
$$;
REVOKE ALL ON FUNCTION public.endurance_team_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_team_workspace(uuid) TO authenticated;

-- Serialize roster changes, including legacy direct writes, against one event row.
CREATE OR REPLACE FUNCTION public.endurance_roster_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp AS $$
DECLARE v_event uuid; v_max integer; v_target integer; v_team uuid; v_count integer;
BEGIN
  IF TG_TABLE_NAME='endurance_teams' THEN
    v_event:=NEW.event_id;
    SELECT max_drivers_per_car INTO v_max FROM public.endurance_events WHERE id=v_event FOR UPDATE;
    IF NEW.target_size IS NOT NULL AND NEW.target_size>v_max THEN RAISE EXCEPTION 'Teamgrootte overschrijdt het racemaximum (%).',v_max; END IF;
    SELECT count(*) INTO v_count FROM public.endurance_team_members WHERE team_id=NEW.id AND role<>'reserve';
    IF v_count>COALESCE(NEW.target_size,v_max) THEN RAISE EXCEPTION 'Dit team heeft al % coureurs. Verplaats eerst coureurs.',v_count; END IF;
    RETURN NEW;
  END IF;
  v_team:=CASE WHEN TG_OP='DELETE' THEN OLD.team_id ELSE NEW.team_id END;
  SELECT event_id, target_size INTO v_event,v_target FROM public.endurance_teams WHERE id=v_team;
  SELECT max_drivers_per_car INTO v_max FROM public.endurance_events WHERE id=v_event FOR UPDATE;
  IF TG_OP<>'DELETE' AND NEW.role<>'reserve' THEN
    IF NOT EXISTS (SELECT 1 FROM public.endurance_registrations WHERE event_id=v_event AND user_id=NEW.user_id AND status IN ('provisional','confirmed')) THEN
      RAISE EXCEPTION 'Deze coureur heeft geen actieve deelname. Bevestig eerst de inschrijving.';
    END IF;
    SELECT count(*) INTO v_count FROM public.endurance_team_members WHERE team_id=v_team AND role<>'reserve' AND id<>NEW.id;
    IF v_count>=COALESCE(v_target,v_max) THEN RAISE EXCEPTION 'Dit team is vol. Pas de teamgrootte aan of kies een ander team.'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER endurance_roster_team_guard BEFORE INSERT OR UPDATE OF target_size,event_id ON public.endurance_teams FOR EACH ROW EXECUTE FUNCTION public.endurance_roster_guard();
CREATE TRIGGER endurance_roster_member_guard BEFORE INSERT OR UPDATE OR DELETE ON public.endurance_team_members FOR EACH ROW EXECUTE FUNCTION public.endurance_roster_guard();

CREATE OR REPLACE FUNCTION public.endurance_mark_plan_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_old jsonb; v_new jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN v_old:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN v_new:=to_jsonb(NEW); END IF;
  IF v_old IS NOT DISTINCT FROM v_new THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='endurance_stints' AND COALESCE(v_new->>'status',v_old->>'status')<>'draft' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('endurance_team_members','endurance_stints') THEN
    UPDATE public.endurance_teams SET plan_needs_review=true WHERE id IN ((v_old->>'team_id')::uuid,(v_new->>'team_id')::uuid);
  ELSE
    UPDATE public.endurance_teams SET plan_needs_review=true WHERE id IN (
      SELECT team_id FROM public.endurance_team_members WHERE
      (event_id=(v_old->>'event_id')::uuid AND user_id=(v_old->>'user_id')::uuid) OR
      (event_id=(v_new->>'event_id')::uuid AND user_id=(v_new->>'user_id')::uuid)
    );
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER endurance_roster_review AFTER INSERT OR UPDATE OR DELETE ON public.endurance_team_members FOR EACH ROW EXECUTE FUNCTION public.endurance_mark_plan_review();
CREATE TRIGGER endurance_availability_review AFTER INSERT OR UPDATE OR DELETE ON public.endurance_availability FOR EACH ROW EXECUTE FUNCTION public.endurance_mark_plan_review();
CREATE TRIGGER endurance_registration_review AFTER UPDATE ON public.endurance_registrations FOR EACH ROW EXECUTE FUNCTION public.endurance_mark_plan_review();
CREATE TRIGGER endurance_draft_review AFTER INSERT OR UPDATE OR DELETE ON public.endurance_stints FOR EACH ROW EXECUTE FUNCTION public.endurance_mark_plan_review();

CREATE OR REPLACE FUNCTION public.endurance_apply_team_proposal(p_event_id uuid,p_revision text,p_teams jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp AS $$
DECLARE e public.endurance_events; item jsonb; person jsonb; tid uuid; v_created jsonb:='[]';
BEGIN
  IF NOT public.endurance_can_manage_roster(p_event_id) THEN RAISE EXCEPTION 'Geen toegang tot de teamindeling.' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.endurance_events WHERE id=p_event_id FOR UPDATE;
  IF e.status IN ('live','completed') THEN RAISE EXCEPTION 'De race is gestart of afgerond; de teamindeling is vergrendeld.'; END IF;
  IF (public.endurance_team_workspace(p_event_id)->>'revision') IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Gegevens zijn veranderd. Vernieuw het voorstel voordat je opslaat.' USING ERRCODE='40001'; END IF;
  IF e.selected_car_id IS NULL THEN RAISE EXCEPTION 'Bevestig eerst de raceauto in Overzicht.'; END IF;
  IF jsonb_typeof(p_teams) IS DISTINCT FROM 'array' OR jsonb_array_length(p_teams) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Ongeldig teamvoorstel.'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_teams) LOOP
    IF length(trim(item->>'name')) NOT BETWEEN 1 AND 100 OR item->>'name' IS NULL THEN RAISE EXCEPTION 'Geef ieder team een naam.'; END IF;
    IF (item->>'capacity')::integer NOT BETWEEN 1 AND e.max_drivers_per_car OR item->>'capacity' IS NULL THEN RAISE EXCEPTION 'Ongeldige teamgrootte.'; END IF;
    IF jsonb_typeof(item->'userIds') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'userIds')>(item->>'capacity')::integer THEN RAISE EXCEPTION 'Te veel coureurs in een team.'; END IF;
    INSERT INTO public.endurance_teams(event_id,name,car_id,manager_id,target_size,team_approach)
    VALUES(p_event_id,trim(item->>'name'),e.selected_car_id,auth.uid(),(item->>'capacity')::integer,COALESCE(item->>'approach','either')) RETURNING id INTO tid;
    FOR person IN SELECT value FROM jsonb_array_elements(item->'userIds') LOOP
      INSERT INTO public.endurance_team_members(team_id,user_id,role) VALUES(tid,(person#>>'{}')::uuid,'driver');
    END LOOP;
    v_created:=v_created||jsonb_build_array(tid);
  END LOOP;
  INSERT INTO public.endurance_audit_log(event_id,actor_id,action,entity_type,after_data) VALUES(p_event_id,auth.uid(),'teams_proposed','endurance_teams',p_teams);
  RETURN v_created;
END;
$$;
REVOKE ALL ON FUNCTION public.endurance_apply_team_proposal(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.endurance_apply_team_proposal(uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.endurance_manage_team(p_event_id uuid,p_revision text,p_action jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp AS $$
DECLARE e public.endurance_events; tid uuid:=(p_action->>'team_id')::uuid; uid uuid:=(p_action->>'user_id')::uuid; v_old jsonb;
BEGIN
  IF NOT public.endurance_can_manage_roster(p_event_id) THEN RAISE EXCEPTION 'Geen toegang tot de teamindeling.' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.endurance_events WHERE id=p_event_id FOR UPDATE;
  IF e.status IN ('live','completed') THEN RAISE EXCEPTION 'De race is gestart of afgerond; de teamindeling is vergrendeld.'; END IF;
  IF (public.endurance_team_workspace(p_event_id)->>'revision') IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Gegevens zijn veranderd. Vernieuw de teamindeling.' USING ERRCODE='40001'; END IF;
  IF tid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.endurance_teams WHERE id=tid AND event_id=p_event_id) THEN RAISE EXCEPTION 'Team hoort niet bij deze race.'; END IF;
  IF p_action->>'kind'='move' THEN
    IF uid IS NULL THEN RAISE EXCEPTION 'Kies een coureur.'; END IF;
    SELECT to_jsonb(m) INTO v_old FROM public.endurance_team_members m WHERE event_id=p_event_id AND user_id=uid;
    IF EXISTS(SELECT 1 FROM public.endurance_stints WHERE event_id=p_event_id AND driver_id=uid AND status IN ('ready','in_car','completed')) THEN RAISE EXCEPTION 'Deze coureur heeft actieve racestints en kan niet worden verplaatst.'; END IF;
    IF tid IS NULL THEN DELETE FROM public.endurance_team_members WHERE event_id=p_event_id AND user_id=uid;
    ELSIF v_old IS NOT NULL THEN UPDATE public.endurance_team_members SET team_id=tid,role=COALESCE((p_action->>'role')::public.endurance_team_role,'driver') WHERE event_id=p_event_id AND user_id=uid;
    ELSE INSERT INTO public.endurance_team_members(team_id,user_id,role) VALUES(tid,uid,COALESCE((p_action->>'role')::public.endurance_team_role,'driver')); END IF;
  ELSIF p_action->>'kind'='settings' THEN
    IF tid IS NULL OR length(trim(p_action->>'name')) NOT BETWEEN 1 AND 100 OR p_action->>'name' IS NULL THEN RAISE EXCEPTION 'Geef het team een naam.'; END IF;
    IF (p_action->>'capacity')::integer NOT BETWEEN 1 AND e.max_drivers_per_car OR p_action->>'capacity' IS NULL THEN RAISE EXCEPTION 'Ongeldige teamgrootte.'; END IF;
    IF p_action->>'manager_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.endurance_team_members WHERE team_id=tid AND user_id=(p_action->>'manager_id')::uuid) AND (p_action->>'manager_id')::uuid<>auth.uid() THEN RAISE EXCEPTION 'Kies jezelf of een lid van dit team als manager.'; END IF;
    SELECT to_jsonb(t) INTO v_old FROM public.endurance_teams t WHERE id=tid;
    UPDATE public.endurance_teams SET name=trim(p_action->>'name'),target_size=(p_action->>'capacity')::integer,team_approach=p_action->>'approach',car_number=NULLIF(trim(p_action->>'car_number'),''),manager_id=COALESCE((p_action->>'manager_id')::uuid,manager_id) WHERE id=tid;
  ELSE RAISE EXCEPTION 'Onbekende teamactie.';
  END IF;
  INSERT INTO public.endurance_audit_log(event_id,actor_id,action,entity_type,before_data,after_data) VALUES(p_event_id,auth.uid(),'team_'||(p_action->>'kind'),'endurance_teams',v_old,p_action);
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.endurance_manage_team(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.endurance_manage_team(uuid,text,jsonb) TO authenticated;

-- Input writes use the same lock as proposal confirmation; an outdated preview
-- cannot slip through while a driver saves availability in another browser.
CREATE OR REPLACE FUNCTION public.endurance_lock_roster_input()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE eid uuid;
BEGIN
  eid:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  PERFORM 1 FROM public.endurance_events WHERE id=eid FOR UPDATE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER endurance_registration_lock BEFORE INSERT OR UPDATE OR DELETE ON public.endurance_registrations FOR EACH ROW EXECUTE FUNCTION public.endurance_lock_roster_input();
CREATE TRIGGER endurance_availability_lock BEFORE INSERT OR UPDATE OR DELETE ON public.endurance_availability FOR EACH ROW EXECUTE FUNCTION public.endurance_lock_roster_input();
CREATE TRIGGER endurance_pace_lock BEFORE INSERT OR UPDATE OR DELETE ON public.endurance_pace_entries FOR EACH ROW EXECUTE FUNCTION public.endurance_lock_roster_input();

CREATE OR REPLACE FUNCTION public.endurance_event_roster_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.max_drivers_per_car<1 OR NEW.max_drivers_per_car>64 THEN RAISE EXCEPTION 'Kies een racemaximum tussen 1 en 64.'; END IF;
  IF EXISTS(SELECT 1 FROM public.endurance_teams t WHERE t.event_id=NEW.id AND (t.target_size>NEW.max_drivers_per_car OR (SELECT count(*) FROM public.endurance_team_members m WHERE m.team_id=t.id AND m.role<>'reserve')>NEW.max_drivers_per_car)) THEN RAISE EXCEPTION 'Het maximum is kleiner dan een bestaande teamgrootte. Pas eerst de teams aan.'; END IF;
  IF TG_OP='UPDATE' AND (NEW.start_at,NEW.end_at,NEW.selected_car_id) IS DISTINCT FROM (OLD.start_at,OLD.end_at,OLD.selected_car_id) THEN
    UPDATE public.endurance_teams SET plan_needs_review=true WHERE event_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER endurance_event_roster_guard BEFORE INSERT OR UPDATE OF max_drivers_per_car,start_at,end_at,selected_car_id ON public.endurance_events FOR EACH ROW EXECUTE FUNCTION public.endurance_event_roster_guard();

-- Publication must validate current database inputs, not trust a stale browser.
CREATE OR REPLACE FUNCTION public.endurance_validate_plan_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE e public.endurance_events; s record; r public.endurance_registrations;
  cursor_at timestamptz; prev_uid uuid; consecutive integer:=0; mins numeric;
  totals jsonb:='{}'; counts jsonb:='{}'; ends jsonb:='{}'; covered timestamptz; win record;
BEGIN
  IF NOT NEW.published THEN RETURN NEW; END IF;
  SELECT * INTO e FROM public.endurance_events WHERE id=NEW.event_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.endurance_teams WHERE id=NEW.team_id AND event_id=NEW.event_id) THEN RAISE EXCEPTION 'Team hoort niet bij deze race.'; END IF;
  IF jsonb_typeof(NEW.stints) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.stints)=0 THEN RAISE EXCEPTION 'Publiceer eerst een volledige stintplanning.'; END IF;
  cursor_at:=e.start_at;
  FOR s IN SELECT (value->>'driverId')::uuid AS uid,(value->>'actualStartAt')::timestamptz AS starts,(value->>'actualEndAt')::timestamptz AS ends_at FROM jsonb_array_elements(NEW.stints) ORDER BY (value->>'actualStartAt')::timestamptz LOOP
    IF s.uid IS NULL OR s.starts IS NULL OR s.ends_at IS NULL OR s.starts<>cursor_at OR s.ends_at<=s.starts OR s.ends_at>e.end_at THEN RAISE EXCEPTION 'De planning bevat een gat, overlap of ongeldige racetijd.'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.endurance_team_members WHERE team_id=NEW.team_id AND user_id=s.uid AND role<>'reserve') THEN RAISE EXCEPTION 'Een geplande coureur zit niet meer in dit team.'; END IF;
    SELECT * INTO r FROM public.endurance_registrations WHERE event_id=NEW.event_id AND user_id=s.uid AND status IN ('provisional','confirmed');
    IF NOT FOUND THEN RAISE EXCEPTION 'Een geplande coureur heeft geen actieve deelname.'; END IF;
    mins:=extract(epoch FROM s.ends_at-s.starts)/60;
    totals:=jsonb_set(totals,ARRAY[s.uid::text],to_jsonb(COALESCE((totals->>s.uid::text)::numeric,0)+mins));
    counts:=jsonb_set(counts,ARRAY[s.uid::text],to_jsonb(COALESCE((counts->>s.uid::text)::integer,0)+1));
    consecutive:=CASE WHEN prev_uid=s.uid THEN consecutive+1 ELSE 1 END;
    IF mins>COALESCE(r.max_stint_minutes,2147483647) OR (totals->>s.uid::text)::numeric>COALESCE(r.max_total_minutes,2147483647) OR (counts->>s.uid::text)::integer>COALESCE(r.max_stints,2147483647) OR consecutive>COALESCE(r.max_consecutive_stints,2147483647) THEN RAISE EXCEPTION 'De planning overschrijdt een persoonlijke rijlimiet.'; END IF;
    IF prev_uid IS DISTINCT FROM s.uid AND ends ? s.uid::text AND extract(epoch FROM s.starts-(ends->>s.uid::text)::timestamptz)/60<COALESCE(r.min_rest_minutes,0) THEN RAISE EXCEPTION 'Een coureur heeft onvoldoende rusttijd.'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.endurance_availability WHERE event_id=NEW.event_id AND user_id=s.uid) THEN RAISE EXCEPTION 'Laat iedere coureur eerst beschikbaarheid invullen.'; END IF;
    IF EXISTS(SELECT 1 FROM public.endurance_availability WHERE event_id=NEW.event_id AND user_id=s.uid AND type IN ('unavailable','avoid','uncertain') AND start_at<s.ends_at AND end_at>s.starts) THEN RAISE EXCEPTION 'Een stint valt buiten de beschikbaarheid.'; END IF;
    covered:=s.starts;
    FOR win IN SELECT start_at,end_at FROM public.endurance_availability WHERE event_id=NEW.event_id AND user_id=s.uid AND type IN ('available','preferred') AND end_at>s.starts ORDER BY start_at LOOP
      EXIT WHEN win.start_at>covered;
      covered:=GREATEST(covered,win.end_at);
      EXIT WHEN covered>=s.ends_at;
    END LOOP;
    IF covered<s.ends_at THEN RAISE EXCEPTION 'Een stint valt buiten de opgegeven beschikbaarheid.'; END IF;
    ends:=jsonb_set(ends,ARRAY[s.uid::text],to_jsonb(s.ends_at));prev_uid:=s.uid;cursor_at:=s.ends_at;
  END LOOP;
  IF cursor_at<>e.end_at THEN RAISE EXCEPTION 'De planning dekt de race nog niet volledig.'; END IF;
  UPDATE public.endurance_teams SET plan_needs_review=false WHERE id=NEW.team_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER endurance_validate_plan_version BEFORE INSERT OR UPDATE OF published,stints ON public.endurance_planning_versions FOR EACH ROW EXECUTE FUNCTION public.endurance_validate_plan_version();

CREATE OR REPLACE FUNCTION public.endurance_confirmation_current_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.status='accepted' AND NOT EXISTS(SELECT 1 FROM public.endurance_planning_versions v JOIN public.endurance_teams t ON t.id=v.team_id WHERE v.id=NEW.version_id AND v.published AND NOT t.plan_needs_review) THEN RAISE EXCEPTION 'De planning is gewijzigd. Wacht op de nieuwe gepubliceerde versie.'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER endurance_confirmation_current_plan BEFORE UPDATE ON public.endurance_confirmations FOR EACH ROW EXECUTE FUNCTION public.endurance_confirmation_current_plan();

ALTER TABLE public.endurance_practice_sessions ADD COLUMN IF NOT EXISTS car_id text, ADD COLUMN IF NOT EXISTS circuit text, ADD COLUMN IF NOT EXISTS configuration text,
  ADD COLUMN IF NOT EXISTS conditions text NOT NULL DEFAULT 'dry' CHECK(conditions IN ('dry','wet'));
ALTER TABLE public.endurance_pace_entries ADD COLUMN IF NOT EXISTS practice_session_id uuid REFERENCES public.endurance_practice_sessions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS endurance_practice_pace_identity ON public.endurance_pace_entries(practice_session_id,user_id) WHERE practice_session_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.endurance_practice_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  SELECT selected_car_id,circuit,configuration INTO NEW.car_id,NEW.circuit,NEW.configuration FROM public.endurance_events WHERE id=NEW.event_id;
  IF NEW.car_id IS NULL THEN RAISE EXCEPTION 'Bevestig eerst de raceauto voordat je practice start.'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER endurance_practice_context BEFORE INSERT ON public.endurance_practice_sessions FOR EACH ROW EXECUTE FUNCTION public.endurance_practice_context();

CREATE OR REPLACE FUNCTION public.endurance_sync_practice_pace(p_session_id uuid,p_car_alias text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE session public.endurance_practice_sessions; e public.endurance_events; affected integer;
BEGIN
  SELECT * INTO session FROM public.endurance_practice_sessions WHERE id=p_session_id;
  IF NOT FOUND OR NOT public.endurance_can_manage_roster(session.event_id) THEN RAISE EXCEPTION 'Geen toegang tot deze practice.' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.endurance_events WHERE id=session.event_id FOR UPDATE;
  IF session.ended_at IS NULL THEN RAISE EXCEPTION 'Beëindig de practice voordat je pace doorvoert.'; END IF;
  IF session.car_id IS NULL OR (session.car_id,session.circuit,session.configuration) IS DISTINCT FROM (e.selected_car_id,e.circuit,e.configuration) THEN RAISE EXCEPTION 'Deze sessie heeft geen passende vastgelegde auto/baancombinatie. Start een nieuwe practice voor de huidige racekeuze.'; END IF;
  WITH valid AS (
    SELECT l.*,row_number() OVER(PARTITION BY l.user_id ORDER BY l.lap_seconds) AS rank
    FROM public.endurance_practice_laps l WHERE l.session_id=p_session_id AND l.event_id=e.id AND l.user_id IS NOT NULL
      AND l.car_id IN (session.car_id,p_car_alias) AND l.circuit=session.circuit
      AND l.lap_seconds>0 AND l.lap_seconds::text NOT IN ('NaN','Infinity','-Infinity')
      AND EXISTS(SELECT 1 FROM public.endurance_registrations r WHERE r.event_id=e.id AND r.user_id=l.user_id AND r.status IN ('provisional','confirmed','reserve'))
  ), aggregated AS (
    SELECT user_id,avg(lap_seconds) AS average,percentile_cont(.5) WITHIN GROUP(ORDER BY lap_seconds) AS median,
      min(lap_seconds) AS best,avg(lap_seconds) FILTER(WHERE rank<=5) AS best_five,stddev_pop(lap_seconds) AS deviation,count(*) AS laps,sum(incident_count) AS incidents
    FROM valid GROUP BY user_id
  )
  INSERT INTO public.endurance_pace_entries(event_id,user_id,circuit,configuration,car,conditions,average_lap_seconds,median_lap_seconds,best_lap_seconds,best_five_average_seconds,consistency_seconds,valid_laps,incidents,recorded_at,source,practice_session_id)
  SELECT e.id,user_id,session.circuit,session.configuration,session.car_id,session.conditions,average,median,best,best_five,deviation,laps,incidents,session.ended_at,'practice',session.id FROM aggregated
  ON CONFLICT(practice_session_id,user_id) WHERE practice_session_id IS NOT NULL DO UPDATE SET
    average_lap_seconds=EXCLUDED.average_lap_seconds,median_lap_seconds=EXCLUDED.median_lap_seconds,best_lap_seconds=EXCLUDED.best_lap_seconds,best_five_average_seconds=EXCLUDED.best_five_average_seconds,consistency_seconds=EXCLUDED.consistency_seconds,valid_laps=EXCLUDED.valid_laps,incidents=EXCLUDED.incidents,recorded_at=EXCLUDED.recorded_at;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.endurance_sync_practice_pace(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.endurance_sync_practice_pace(uuid,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
