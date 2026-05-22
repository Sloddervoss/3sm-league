-- Tighten public policies that were originally opened for anon-key bot access.
-- Production bot uses SUPABASE_SERVICE_KEY and bypasses RLS, so bot flows do not need public table access.

-- ── Teams ─────────────────────────────────────────────────────────────────────
-- Bot syncTeamRoles writes discord_role_id/discord_category_id with service role.
-- Public users should not have broad UPDATE rights on teams.
DROP POLICY IF EXISTS "Anon can update discord_role_id on teams" ON public.teams;

-- ── Announcements ─────────────────────────────────────────────────────────────
-- Admin UI inserts announcements; bot service role reads unsent rows and marks sent.
DROP POLICY IF EXISTS "Admins can do everything on announcements" ON public.announcements;
DROP POLICY IF EXISTS "Anyone can insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Anyone can update sent on announcements" ON public.announcements;

CREATE POLICY "Admins can insert announcements"
  ON public.announcements
  FOR INSERT
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

CREATE POLICY "Admins can update announcements"
  ON public.announcements
  FOR UPDATE
  USING (public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

CREATE POLICY "Admins can delete announcements"
  ON public.announcements
  FOR DELETE
  USING (public.has_role((SELECT auth.uid()), 'admin'));

-- Announcement images are public to read, but only admins should upload/delete them.
DROP POLICY IF EXISTS "Authenticated upload announcement images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete announcement images" ON storage.objects;

CREATE POLICY "Admins can upload announcement images"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'announcement-images'
    AND public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE POLICY "Admins can delete announcement images"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'announcement-images'
    AND public.has_role((SELECT auth.uid()), 'admin')
  );

-- ── Discord link tokens ───────────────────────────────────────────────────────
-- /koppel bot creates tokens with service role; website claims via SECURITY DEFINER discord_claim_token().
-- Direct public table access is not required.
DROP POLICY IF EXISTS "Anyone can insert link tokens" ON public.discord_link_tokens;
DROP POLICY IF EXISTS "Anyone can read link tokens" ON public.discord_link_tokens;
DROP POLICY IF EXISTS "Anyone can update link tokens" ON public.discord_link_tokens;

-- ── Protests ──────────────────────────────────────────────────────────────────
-- Keep involved-user/admin/steward SELECT policy; remove public read-all policy.
DROP POLICY IF EXISTS "Anon can read protests" ON public.protests;

-- ── User roles ────────────────────────────────────────────────────────────────
-- Frontend uses has_role/admin_get_user_roles RPCs. Bot uses service role.
-- Remove public read-all and replace overly broad permissive role policies.
DROP POLICY IF EXISTS "Anon can read all user_roles for bot sync" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Prevent super_admin role deletion" ON public.user_roles;

CREATE POLICY "Admins can view all user roles"
  ON public.user_roles
  FOR SELECT
  USING (public.has_role((SELECT auth.uid()), 'admin') OR public.has_role((SELECT auth.uid()), 'super_admin'));

CREATE POLICY "Admins can insert non-super-admin roles"
  ON public.user_roles
  FOR INSERT
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin')
    AND role <> 'super_admin'::public.app_role
  );

CREATE POLICY "Admins can update non-super-admin roles"
  ON public.user_roles
  FOR UPDATE
  USING (
    public.has_role((SELECT auth.uid()), 'admin')
    AND role <> 'super_admin'::public.app_role
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin')
    AND role <> 'super_admin'::public.app_role
  );

CREATE POLICY "Admins can delete non-super-admin roles"
  ON public.user_roles
  FOR DELETE
  USING (
    public.has_role((SELECT auth.uid()), 'admin')
    AND role <> 'super_admin'::public.app_role
  );
