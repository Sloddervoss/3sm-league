-- Een profielrij hoort bij een bestaand account.
--
-- De publieke projectie filterde alleen op het testdomein. Een rij waarvan het
-- account al weg is, viel daardoor buiten de filter en bleef in de coureurslijst
-- staan. Vanaf nu komt een profiel alleen in beeld als het account bestaat én
-- geen testadres is.

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  p.user_id,
  p.display_name,
  p.iracing_name,
  p.avatar_url,
  p.irating,
  p.safety_rating,
  p.team_id
FROM public.profiles AS p
WHERE EXISTS (
  SELECT 1
  FROM auth.users AS u
  WHERE u.id = p.user_id
    AND u.email NOT ILIKE '%@test.cc'
);

REVOKE ALL ON TABLE public.public_profiles FROM PUBLIC;
GRANT SELECT ON TABLE public.public_profiles TO anon, authenticated;

COMMIT;
