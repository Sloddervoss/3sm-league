-- Discord rol-id per team (voor automatische rol-toewijzing)
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS discord_role_id TEXT;
