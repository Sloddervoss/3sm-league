-- Admins en super_admins mogen elk profiel updaten (o.a. iRating + safety_rating na race import)
CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin')
  );
