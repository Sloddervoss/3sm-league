-- Add fields for Discord message tracking and revoke flow
ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS discord_message_id TEXT,
  ADD COLUMN IF NOT EXISTS revoked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS correction_sent BOOLEAN DEFAULT false;
