-- Add notified and source columns to penalties for abandon penalty Discord notifications
ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS notified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'steward';

-- Allow abandon as penalty type
ALTER TABLE public.penalties
  DROP CONSTRAINT IF EXISTS penalties_penalty_type_check;

ALTER TABLE public.penalties
  ADD CONSTRAINT penalties_penalty_type_check
  CHECK (penalty_type IN ('time_penalty', 'points_deduction', 'warning', 'disqualification', 'abandon'));
