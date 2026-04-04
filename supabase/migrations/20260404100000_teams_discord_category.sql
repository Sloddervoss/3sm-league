ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS discord_category_id TEXT;
