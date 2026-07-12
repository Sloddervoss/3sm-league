-- Penalty rows can link to confidential protests and contain internal steward rationale.
-- Keep all penalty details available only to staff; service_role importers and the bot
-- bypass RLS, while the existing staff management policy remains in place.
DROP POLICY IF EXISTS "Penalties viewable by everyone" ON public.penalties;

CREATE POLICY "Staff can view penalties" ON public.penalties
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'moderator')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );