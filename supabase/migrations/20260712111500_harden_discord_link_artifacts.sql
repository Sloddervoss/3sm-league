-- Discord link codes and tokens are bearer secrets. They are consumed only by
-- hardened SECURITY DEFINER RPCs or the Discord bot's service-role client; they
-- must never be enumerable or writable through browser table endpoints.

BEGIN;

DROP POLICY IF EXISTS "Users manage own link codes" ON public.discord_link_codes;
DROP POLICY IF EXISTS "Users can view own link codes" ON public.discord_link_codes;
DROP POLICY IF EXISTS "Users can manage own link tokens" ON public.discord_link_tokens;
DROP POLICY IF EXISTS "Users can view own link tokens" ON public.discord_link_tokens;

REVOKE ALL ON TABLE public.discord_link_codes FROM anon, authenticated;
REVOKE ALL ON TABLE public.discord_link_tokens FROM anon, authenticated;

COMMIT;
