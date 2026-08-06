BEGIN;

-- ============================================================================
-- 3SM Endurance Control Center — datalaag (Fase 2)
-- ----------------------------------------------------------------------------
-- VEILIGHEIDSCONTRACT:
--  - Alle nieuwe tabellen krijgen de prefix `endurance_` en zijn fysiek
--    gescheiden van bestaande productie-tabellen.
--  - ELKE tabel heeft RLS ingeschakeld en uitsluitend super-admin policies via
--    public.has_role(auth.uid(), 'super_admin').
--  - Er worden GEEN bestaande tabellen, RLS-policies of privileges gewijzigd.
--  - Bestaande rollen (admin/moderator/editor/user) en anon kunnen deze
--    tabellen niet lezen of schrijven. Alleen service_role (server/Edge) kan
--    er schrijven namens super-admin-flows.
-- ============================================================================

-- ======================= ENUMS & event-modellen =============================

CREATE TYPE public.endurance_event_status AS ENUM (
  'draft', 'registration_open', 'registration_closed', 'planning', 'live', 'completed'
);
CREATE TYPE public.endurance_event_visibility AS ENUM ('open', 'invite_only', 'hidden');
CREATE TYPE public.endurance_registration_status AS ENUM (
  'interest', 'provisional', 'confirmed', 'reserve', 'rejected', 'withdrawn'
);
CREATE TYPE public.endurance_availability_type AS ENUM (
  'available', 'preferred', 'avoid', 'unavailable', 'uncertain'
);
CREATE TYPE public.endurance_stint_status AS ENUM (
  'draft', 'confirmed', 'ready', 'in_car', 'completed', 'expired', 'replaced'
);
CREATE TYPE public.endurance_team_role AS ENUM ('manager', 'driver', 'reserve');
CREATE TYPE public.endurance_confirmation_status AS ENUM ('unseen', 'viewed', 'accepted', 'change_requested');
CREATE TYPE public.endurance_notification_type AS ENUM (
  'invitation', 'deadline', 'availability_missing', 'team_assigned',
  'plan_published', 'plan_changed', 'confirmation_needed', 'stint_soon'
);

-- ======================= EVENTS =============================================

CREATE TABLE public.endurance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  circuit TEXT NOT NULL,
  configuration TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  briefing_start_at TIMESTAMPTZ,
  expected_end_at TIMESTAMPTZ,
  registration_deadline TIMESTAMPTZ,
  slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  class_ids TEXT[] NOT NULL DEFAULT '{}',
  selected_class_id TEXT,
  selected_car_id TEXT,
  max_drivers_per_car INTEGER NOT NULL DEFAULT 4,
  visibility public.endurance_event_visibility NOT NULL DEFAULT 'open',
  status public.endurance_event_status NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'manual',
  invited_user_ids UUID[] NOT NULL DEFAULT '{}',
  manager_ids UUID[] NOT NULL DEFAULT '{}',
  race_id UUID REFERENCES public.races(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.endurance_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status public.endurance_registration_status NOT NULL DEFAULT 'interest',
  class_preference TEXT,
  preferred_car_id TEXT,
  slot_id TEXT,
  max_stints INTEGER,
  night_driving BOOLEAN NOT NULL DEFAULT false,
  willing_to_start BOOLEAN NOT NULL DEFAULT false,
  willing_to_finish BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE public.endurance_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  type public.endurance_availability_type NOT NULL DEFAULT 'available',
  note TEXT
);

CREATE TABLE public.endurance_pace_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  circuit TEXT NOT NULL,
  configuration TEXT NOT NULL DEFAULT '',
  car TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT 'dry',
  average_lap_seconds NUMERIC(8,2),
  median_lap_seconds NUMERIC(8,2),
  best_lap_seconds NUMERIC(8,2),
  best_five_average_seconds NUMERIC(8,2),
  consistency_seconds NUMERIC(8,2),
  valid_laps INTEGER,
  incidents INTEGER,
  average_stint_minutes NUMERIC(6,2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT
);

-- ======================= TEAMS & ENTRIES ===================================

CREATE TABLE public.endurance_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  car_id TEXT,
  car_number TEXT,
  manager_id UUID,
  livery TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, car_number)
);

CREATE TABLE public.endurance_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.endurance_teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.endurance_team_role NOT NULL DEFAULT 'driver',
  UNIQUE (team_id, user_id)
);

-- ======================= STINTS & PLANNING =================================

CREATE TABLE public.endurance_stints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.endurance_teams(id) ON DELETE CASCADE,
  driver_id UUID,
  original_start_at TIMESTAMPTZ NOT NULL,
  original_end_at TIMESTAMPTZ NOT NULL,
  actual_start_at TIMESTAMPTZ,
  actual_end_at TIMESTAMPTZ,
  expected_laps INTEGER,
  fuel_litres NUMERIC(8,2),
  tyre_change BOOLEAN NOT NULL DEFAULT false,
  double_stint BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  status public.endurance_stint_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.endurance_planning_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.endurance_teams(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_by UUID,
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stints JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE public.endurance_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES public.endurance_planning_versions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status public.endurance_confirmation_status NOT NULL DEFAULT 'unseen',
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, user_id)
);

-- ======================= NOTIFICATIES & AUDIT ==============================

CREATE TABLE public.endurance_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_id UUID REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  type public.endurance_notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  private_path TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  discord_status TEXT NOT NULL DEFAULT 'disabled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.endurance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.endurance_events(id) ON DELETE SET NULL,
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- RLS: super-admin-only op ELKE endurance_*-tabel
-- ============================================================================

ALTER TABLE public.endurance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_pace_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_stints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_planning_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_audit_log ENABLE ROW LEVEL SECURITY;

-- Super-admin-only policy helper: lees + schrijf uitsluitend voor super-admin,
-- service_role voor server/Edge-flows. anon/authenticated (incl. admin/moderator)
-- wordt hard geweigerd.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'endurance_events',
    'endurance_registrations',
    'endurance_availability',
    'endurance_pace_entries',
    'endurance_teams',
    'endurance_team_members',
    'endurance_stints',
    'endurance_planning_versions',
    'endurance_confirmations',
    'endurance_notifications',
    'endurance_audit_log'
  ] LOOP
    EXECUTE format('
      CREATE POLICY "endurance super admin all" ON public.%I
        FOR ALL
        TO authenticated
        USING (public.has_role(auth.uid(), ''super_admin''))
        WITH CHECK (public.has_role(auth.uid(), ''super_admin''))
    ', t);
  END LOOP;
END;
$$;

-- Bestaande niet-super-admin rollen expliciet uitsluiten van directe toegang
-- door grants te beperken tot authenticated (service_role apart).
REVOKE ALL ON public.endurance_events, public.endurance_registrations,
  public.endurance_availability, public.endurance_pace_entries,
  public.endurance_teams, public.endurance_team_members,
  public.endurance_stints, public.endurance_planning_versions,
  public.endurance_confirmations, public.endurance_notifications,
  public.endurance_audit_log FROM PUBLIC, anon;

-- Optimized updated_at helper
CREATE OR REPLACE FUNCTION public.endurance_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER endurance_events_touch BEFORE UPDATE ON public.endurance_events
  FOR EACH ROW EXECUTE FUNCTION public.endurance_touch_updated_at();
CREATE TRIGGER endurance_teams_touch BEFORE UPDATE ON public.endurance_teams
  FOR EACH ROW EXECUTE FUNCTION public.endurance_touch_updated_at();
CREATE TRIGGER endurance_stints_touch BEFORE UPDATE ON public.endurance_stints
  FOR EACH ROW EXECUTE FUNCTION public.endurance_touch_updated_at();

-- Realtime publicatie voor live Race Control / telemetry (super-admin heeft
-- sowieso al SELECT-recht; dit maakt realtime-kanaal bruikbaar zonder data-escape).
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_stints;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_notifications;

COMMIT;
