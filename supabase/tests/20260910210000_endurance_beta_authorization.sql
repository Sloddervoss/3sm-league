-- ============================================================================
-- ENDURANCE OPEN BETA — AUTORISATIEMATRIX
-- Positieve EN negatieve controles, per rol, in twee fasen:
--   fase A: schakelaars UIT (deur dicht)  -> leden mogen nog niets
--   fase B: schakelaars AAN (deur open)   -> leden mogen deelnemen
-- Draait op de gemigreerde kloon. Maakt eigen testdata.
-- ============================================================================
\set ON_ERROR_STOP on

DROP TABLE IF EXISTS public._beta_results;
CREATE TABLE public._beta_results (
  nr int, fase text, rol text, controle text, waarde bigint, verwacht text, ok boolean
);

-- ---------------------------------------------------------------------------
-- 1. TESTGEBRUIKERS
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-a000-00000000000a','b-member@example.invalid'),
  ('00000000-0000-4000-a000-00000000000b','b-tester@example.invalid'),
  ('00000000-0000-4000-a000-00000000000c','b-manager@example.invalid'),
  ('00000000-0000-4000-a000-00000000000d','b-superadmin@example.invalid'),
  ('00000000-0000-4000-a000-00000000000e','b-deelnemer@example.invalid')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-a000-000000000001','b-andermans@example.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT * FROM (VALUES
  ('00000000-0000-4000-a000-00000000000b'::uuid,'tester'::public.app_role),
  ('00000000-0000-4000-a000-00000000000c'::uuid,'endurance_manager'::public.app_role),
  ('00000000-0000-4000-a000-00000000000d'::uuid,'super_admin'::public.app_role)
) v WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=v.column1 AND ur.role=v.column2);

-- ---------------------------------------------------------------------------
-- 2. TESTDATA
-- ---------------------------------------------------------------------------
INSERT INTO public.endurance_events
  (id, name, circuit, configuration, start_at, end_at, slots, class_ids,
   max_drivers_per_car, visibility, status, source, invited_user_ids, manager_ids)
VALUES
  ('10000000-0000-4000-a000-000000000001','Open race','Spa','GP', now()+interval '7 days', now()+interval '7 days 6 hours',
   '[]'::jsonb, ARRAY['gt3'], 2, 'open', 'registration_open', 'test', ARRAY[]::uuid[], ARRAY[]::uuid[]),
  ('10000000-0000-4000-a000-000000000002','Concept-race','Monza','GP', now()+interval '14 days', now()+interval '14 days 6 hours',
   '[]'::jsonb, ARRAY['gt3'], 2, 'open', 'draft', 'test', ARRAY[]::uuid[], ARRAY[]::uuid[]),
  ('10000000-0000-4000-a000-000000000003','Alleen op uitnodiging','Suzuka','GP', now()+interval '21 days', now()+interval '21 days 6 hours',
   '[]'::jsonb, ARRAY['gt3'], 2, 'invite_only', 'registration_open', 'test', ARRAY[]::uuid[], ARRAY[]::uuid[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.endurance_registrations
  (id, event_id, user_id, status, night_driving, willing_to_start, willing_to_finish, registered_at, team_approach)
VALUES
  ('20000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-00000000000e','confirmed', false, true, true, now(), 'either')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.endurance_teams (id, event_id, name, team_approach, plan_needs_review)
VALUES ('30000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001','Testteam','either', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.endurance_team_members (id, team_id, user_id, role)
VALUES ('40000000-0000-4000-a000-000000000001','30000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-00000000000e','driver')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.endurance_stints
  (id, event_id, team_id, original_start_at, original_end_at, tyre_change, double_stint, status)
VALUES ('50000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001',
        '30000000-0000-4000-a000-000000000001', now()+interval '7 days', now()+interval '7 days 2 hours',
        false, false, 'draft')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.endurance_availability (id, event_id, user_id, start_at, end_at, type)
VALUES
  ('60000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-00000000000e', now()+interval '7 days', now()+interval '7 days 3 hours','available'),
  ('60000000-0000-4000-a000-000000000002','10000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000001', now()+interval '7 days', now()+interval '7 days 3 hours','available')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.endurance_notifications (id, user_id, type, title, read, discord_status)
VALUES ('70000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-00000000000e',
        'deadline','Testmelding', false, 'pending')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. CHECK-HULP
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._beta_check(
  p_nr int, p_fase text, p_rol text, p_controle text,
  p_user text, p_sql text, p_verwacht text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v bigint; v_ok boolean;
BEGIN
  IF p_user IS NULL THEN
    PERFORM set_config('role','anon', true);
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub',p_user,'role','authenticated')::text, true);
    PERFORM set_config('role','authenticated', true);
  END IF;
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := NULL;   -- geweigerd (RLS/GRANT) telt als "geen toegang"
  END;
  PERFORM set_config('role','none', true);
  v_ok := CASE p_verwacht
            WHEN '>0'   THEN v IS NOT NULL AND v > 0
            WHEN '=0'   THEN v IS NOT NULL AND v = 0
            WHEN 'deny' THEN v IS NULL OR v = 0
            WHEN 'fail' THEN v IS NULL
            ELSE false END;
  INSERT INTO public._beta_results VALUES (p_nr,p_fase,p_rol,p_controle,COALESCE(v,-1),p_verwacht,v_ok);
END $$;

-- gebruikers
\set LID  '''00000000-0000-4000-a000-00000000000a'''
\set TST  '''00000000-0000-4000-a000-00000000000b'''
\set MGR  '''00000000-0000-4000-a000-00000000000c'''
\set SUP  '''00000000-0000-4000-a000-00000000000d'''
\set DEEL '''00000000-0000-4000-a000-00000000000e'''
\set ANDR '''00000000-0000-4000-a000-000000000001'''

SELECT public._beta_check(1,'A','lid','ziet open race (niet-concept)',
  :LID, 'SELECT count(*) FROM public.endurance_events WHERE status <> ''draft''','>0');
SELECT public._beta_check(2,'A','lid','ziet GEEN concept-race',
  :LID, 'SELECT count(*) FROM public.endurance_events WHERE status = ''draft''','=0');
SELECT public._beta_check(3,'A','lid','ziet GEEN invite-only race',
  :LID, 'SELECT count(*) FROM public.endurance_events WHERE visibility = ''invite_only''','=0');
SELECT public._beta_check(4,'A','lid','leest GEEN beschikbaarheid (ook niet eigen)',
  :LID, 'SELECT count(*) FROM public.endurance_availability','=0');
SELECT public._beta_check(5,'A','lid','leest GEEN stints',
  :LID, 'SELECT count(*) FROM public.endurance_stints','=0');
SELECT public._beta_check(6,'A','lid','leest GEEN teamleden',
  :LID, 'SELECT count(*) FROM public.endurance_team_members','=0');
SELECT public._beta_check(7,'A','lid','leest GEEN notificaties',
  :LID, 'SELECT count(*) FROM public.endurance_notifications','=0');
SELECT public._beta_check(8,'A','lid','leest GEEN instellingentabel',
  :LID, 'SELECT count(*) FROM public.endurance_runtime_settings','deny');
SELECT public._beta_check(9,'A','anoniem','ziet GEEN events',
  NULL, 'SELECT count(*) FROM public.endurance_events','deny');
SELECT public._beta_check(10,'A','tester','heeft als staff nog volledige toegang',
  :TST, 'SELECT count(*) FROM public.endurance_events','>0');
SELECT public._beta_check(11,'A','manager','ziet alle events',
  :MGR, 'SELECT count(*) FROM public.endurance_events','>0');
