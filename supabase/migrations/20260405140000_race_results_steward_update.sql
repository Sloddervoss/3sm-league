-- Allow stewards (moderator role) to update race_results for applying penalties
DROP POLICY IF EXISTS "Admins can update results" ON public.race_results;

CREATE POLICY "Admins and stewards can update results" ON public.race_results
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')
  );
