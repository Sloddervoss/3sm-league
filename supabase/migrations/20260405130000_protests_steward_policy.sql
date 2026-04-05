-- Voeg steward (moderator) toe aan protests SELECT policy
DROP POLICY IF EXISTS "Protests viewable by involved users and admins" ON public.protests;
CREATE POLICY "Protests viewable by involved users and admins" ON public.protests FOR SELECT USING (
  auth.uid() = reporter_user_id OR
  auth.uid() = accused_user_id OR
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'moderator')
);

-- Voeg protest_decision kolom toe (voor de uitspraak melding)
ALTER TABLE public.protests ADD COLUMN IF NOT EXISTS penalty_type TEXT CHECK (penalty_type IN ('warning', 'points_deduction', 'disqualification'));
ALTER TABLE public.protests ADD COLUMN IF NOT EXISTS penalty_points INTEGER DEFAULT 0;
ALTER TABLE public.protests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE public.protests ADD COLUMN IF NOT EXISTS notified BOOLEAN NOT NULL DEFAULT false;
