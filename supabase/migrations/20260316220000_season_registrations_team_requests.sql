-- Season registrations (per-season signup, locked once first race completes)
CREATE TABLE public.season_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'withdrawn')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (league_id, user_id)
);

ALTER TABLE public.season_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Season registrations viewable by everyone" ON public.season_registrations FOR SELECT USING (true);
CREATE POLICY "Users can register themselves for season" ON public.season_registrations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own season registration" ON public.season_registrations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own season registration" ON public.season_registrations FOR DELETE USING (auth.uid() = user_id);

-- Team creation requests (users request a brand-new team, admin approves)
CREATE TABLE public.team_creation_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  team_name TEXT NOT NULL,
  team_description TEXT,
  team_color TEXT NOT NULL DEFAULT '#f97316',
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.team_creation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own team requests" ON public.team_creation_requests FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can submit team requests" ON public.team_creation_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own team requests" ON public.team_creation_requests FOR DELETE USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update team requests" ON public.team_creation_requests FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_team_creation_requests_updated_at BEFORE UPDATE ON public.team_creation_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Allow admins to manage user roles (for promoting other users to admin)
CREATE POLICY "Admins can manage user roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Allow users to join/leave teams directly
CREATE POLICY "Users can manage own team memberships" ON public.team_memberships
  FOR ALL USING (auth.uid() = user_id);
