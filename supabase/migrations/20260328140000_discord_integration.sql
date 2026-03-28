-- ── Discord integratie ────────────────────────────────────────────────────────

-- 1. discord_id op profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS discord_id TEXT UNIQUE;

-- 2. Tijdelijke koppelcodes (verlopen na 15 minuten)
CREATE TABLE IF NOT EXISTS public.discord_link_codes (
  code        TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);
ALTER TABLE public.discord_link_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own link codes"
  ON public.discord_link_codes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. RPC: bot koppelt discord_id aan profiel via code
CREATE OR REPLACE FUNCTION public.discord_link_account(p_discord_id TEXT, p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.discord_link_codes
  WHERE code = p_code AND expires_at > now();

  IF v_user_id IS NULL THEN
    RETURN 'invalid_code';
  END IF;

  UPDATE public.profiles SET discord_id = p_discord_id WHERE user_id = v_user_id;
  DELETE FROM public.discord_link_codes WHERE code = p_code;
  RETURN 'ok';
END;
$$;

-- 4. RPC: bot meldt rijder aan/af voor race via discord_id
CREATE OR REPLACE FUNCTION public.discord_register_race(
  p_discord_id TEXT,
  p_race_id    UUID,
  p_action     TEXT   -- 'register' of 'unregister'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE discord_id = p_discord_id;

  IF v_user_id IS NULL THEN
    RETURN 'not_linked';
  END IF;

  IF p_action = 'register' THEN
    INSERT INTO public.race_registrations (race_id, user_id, status)
    VALUES (p_race_id, v_user_id, 'registered')
    ON CONFLICT (race_id, user_id) DO NOTHING;
    RETURN 'registered';
  ELSIF p_action = 'unregister' THEN
    DELETE FROM public.race_registrations
    WHERE race_id = p_race_id AND user_id = v_user_id;
    RETURN 'unregistered';
  END IF;

  RETURN 'unknown_action';
END;
$$;
