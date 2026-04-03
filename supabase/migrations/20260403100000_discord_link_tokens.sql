-- Magic link koppeling: bot genereert token, site claimit
CREATE TABLE IF NOT EXISTS public.discord_link_tokens (
  token        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  discord_id   TEXT NOT NULL,
  discord_tag  TEXT,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  used         BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE public.discord_link_tokens ENABLE ROW LEVEL SECURITY;

-- Bot (anon key) mag tokens aanmaken en lezen
CREATE POLICY "Anyone can insert link tokens"
  ON public.discord_link_tokens FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read link tokens"
  ON public.discord_link_tokens FOR SELECT USING (true);
CREATE POLICY "Anyone can update link tokens"
  ON public.discord_link_tokens FOR UPDATE USING (true);

-- RPC: site claimit token na inloggen
CREATE OR REPLACE FUNCTION public.discord_claim_token(p_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token public.discord_link_tokens%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'not_authenticated';
  END IF;

  SELECT * INTO v_token FROM public.discord_link_tokens WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN 'invalid_token';
  END IF;

  IF v_token.used THEN
    RETURN 'already_used';
  END IF;

  IF v_token.expires_at < now() THEN
    RETURN 'expired';
  END IF;

  UPDATE public.profiles SET discord_id = v_token.discord_id WHERE user_id = auth.uid();
  UPDATE public.discord_link_tokens SET used = true WHERE token = p_token;

  RETURN 'ok';
END;
$$;
