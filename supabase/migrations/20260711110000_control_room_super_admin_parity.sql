-- A super_admin is admitted to the Control Room alongside an admin. Keep the
-- database boundary aligned with that UI contract for every Control Room direct
-- mutation. This intentionally does not alter ordinary user self-service or
-- privileged role-management policies.

-- Calendar ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can insert leagues" ON public.leagues;
DROP POLICY IF EXISTS "Admins can update leagues" ON public.leagues;
DROP POLICY IF EXISTS "Admins can delete leagues" ON public.leagues;
CREATE POLICY "Admins can insert leagues" ON public.leagues FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update leagues" ON public.leagues FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete leagues" ON public.leagues FOR DELETE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Admins can insert races" ON public.races;
DROP POLICY IF EXISTS "Admins can update races" ON public.races;
DROP POLICY IF EXISTS "Admins can delete races" ON public.races;
CREATE POLICY "Admins can insert races" ON public.races FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update races" ON public.races FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete races" ON public.races FOR DELETE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Result import and stewarding -------------------------------------------------
DROP POLICY IF EXISTS "Admins can insert results" ON public.race_results;
DROP POLICY IF EXISTS "Admins can update results" ON public.race_results;
DROP POLICY IF EXISTS "Admins and stewards can update results" ON public.race_results;
DROP POLICY IF EXISTS "Admins can delete results" ON public.race_results;
CREATE POLICY "Admins can insert results" ON public.race_results FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins and stewards can update results" ON public.race_results FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'moderator')
  );
CREATE POLICY "Admins can delete results" ON public.race_results FOR DELETE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Session results viewable by everyone" ON public.race_session_results;
DROP POLICY IF EXISTS "Admins can insert session results" ON public.race_session_results;
DROP POLICY IF EXISTS "Admins can update session results" ON public.race_session_results;
DROP POLICY IF EXISTS "Admins can delete session results" ON public.race_session_results;
CREATE POLICY "Session results viewable by everyone" ON public.race_session_results FOR SELECT USING (true);
CREATE POLICY "Admins can insert session results" ON public.race_session_results FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update session results" ON public.race_session_results FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete session results" ON public.race_session_results FOR DELETE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Protests viewable by involved users and admins" ON public.protests;
DROP POLICY IF EXISTS "Admins and stewards can update protests" ON public.protests;
CREATE POLICY "Protests viewable by involved users and admins" ON public.protests FOR SELECT USING (
  auth.uid() = reporter_user_id
  OR auth.uid() = accused_user_id
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'moderator')
);
CREATE POLICY "Admins and stewards can update protests" ON public.protests FOR UPDATE USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'moderator')
);

DROP POLICY IF EXISTS "Admins and stewards can manage penalties" ON public.penalties;
CREATE POLICY "Admins and stewards can manage penalties" ON public.penalties FOR ALL USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'moderator')
);

DROP POLICY IF EXISTS "Admins can manage points config" ON public.points_config;
CREATE POLICY "Admins can manage points config" ON public.points_config FOR ALL USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
);

-- Community --------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can insert teams" ON public.teams;
DROP POLICY IF EXISTS "Admins can update teams" ON public.teams;
DROP POLICY IF EXISTS "Admins can delete teams" ON public.teams;
CREATE POLICY "Admins can insert teams" ON public.teams FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update teams" ON public.teams FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete teams" ON public.teams FOR DELETE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Admins can manage team memberships" ON public.team_memberships;
CREATE POLICY "Admins can manage team memberships" ON public.team_memberships FOR ALL USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
);

DROP POLICY IF EXISTS "Users can view own team requests" ON public.team_creation_requests;
DROP POLICY IF EXISTS "Users can delete own team requests" ON public.team_creation_requests;
DROP POLICY IF EXISTS "Admins can update team requests" ON public.team_creation_requests;
CREATE POLICY "Users can view own team requests" ON public.team_creation_requests FOR SELECT USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
);
CREATE POLICY "Users can delete own team requests" ON public.team_creation_requests FOR DELETE USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
);
CREATE POLICY "Admins can update team requests" ON public.team_creation_requests FOR UPDATE USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
);

-- Discord communications -------------------------------------------------------
DROP POLICY IF EXISTS "Admins can insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can delete announcements" ON public.announcements;
CREATE POLICY "Admins can insert announcements" ON public.announcements FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update announcements" ON public.announcements FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete announcements" ON public.announcements FOR DELETE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Admins can upload announcement images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete announcement images" ON storage.objects;
CREATE POLICY "Admins can upload announcement images" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'announcement-images'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
);
CREATE POLICY "Admins can delete announcement images" ON storage.objects FOR DELETE USING (
  bucket_id = 'announcement-images'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
);
