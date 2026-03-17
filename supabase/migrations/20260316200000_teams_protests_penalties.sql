-- Teams table
CREATE TABLE public.teams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  color TEXT NOT NULL DEFAULT '#f97316',
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teams viewable by everyone" ON public.teams FOR SELECT USING (true);
CREATE POLICY "Admins can insert teams" ON public.teams FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update teams" ON public.teams FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete teams" ON public.teams FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Team memberships
CREATE TABLE public.team_memberships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('driver', 'reserve')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, team_id)
);

ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team memberships viewable by everyone" ON public.team_memberships FOR SELECT USING (true);
CREATE POLICY "Admins can manage team memberships" ON public.team_memberships FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Protests table
CREATE TABLE public.protests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  race_id UUID REFERENCES public.races(id) ON DELETE CASCADE NOT NULL,
  reporter_user_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
  accused_user_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
  lap_number INTEGER,
  description TEXT NOT NULL,
  video_link TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'resolved', 'dismissed')),
  steward_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.protests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Protests viewable by involved users and admins" ON public.protests FOR SELECT USING (
  auth.uid() = reporter_user_id OR
  auth.uid() = accused_user_id OR
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'moderator')
);
CREATE POLICY "Users can submit protests" ON public.protests FOR INSERT WITH CHECK (auth.uid() = reporter_user_id);
CREATE POLICY "Admins and stewards can update protests" ON public.protests FOR UPDATE USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')
);

CREATE TRIGGER update_protests_updated_at BEFORE UPDATE ON public.protests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Penalties table
CREATE TABLE public.penalties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  protest_id UUID REFERENCES public.protests(id) ON DELETE SET NULL,
  race_id UUID REFERENCES public.races(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  penalty_type TEXT NOT NULL CHECK (penalty_type IN ('time_penalty', 'points_deduction', 'warning', 'disqualification')),
  time_penalty_seconds INTEGER DEFAULT 0,
  points_deduction INTEGER DEFAULT 0,
  reason TEXT NOT NULL,
  applied_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.penalties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Penalties viewable by everyone" ON public.penalties FOR SELECT USING (true);
CREATE POLICY "Admins and stewards can manage penalties" ON public.penalties FOR ALL USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')
);

-- Points config table
CREATE TABLE public.points_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL,
  points INTEGER NOT NULL,
  UNIQUE (league_id, position)
);

ALTER TABLE public.points_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Points config viewable by everyone" ON public.points_config FOR SELECT USING (true);
CREATE POLICY "Admins can manage points config" ON public.points_config FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Add extra columns to race_results
ALTER TABLE public.race_results
  ADD COLUMN IF NOT EXISTS laps INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_lap TEXT,
  ADD COLUMN IF NOT EXISTS incidents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iracing_cust_id TEXT;

-- Add extra columns to races
ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS car TEXT,
  ADD COLUMN IF NOT EXISTS total_laps INTEGER,
  ADD COLUMN IF NOT EXISTS iracing_session_id TEXT;

-- Add team_id to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS irating INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS safety_rating TEXT DEFAULT 'A 4.00';
