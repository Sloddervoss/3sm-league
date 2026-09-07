-- Hide seeded test accounts from the public driver-facing surfaces.
--
-- public_profiles is THE safe display projection read by every public driver list
-- (Coureurs page, Standings, Teams, Seasons, Results, homepage strip等). Test accounts
-- seeded with reserved @test.cc emails (owner@, super@, regular@, edge-test-*) leaked
-- into those public lists because the view returned all profiles unfiltered.
--
-- Filter on the reserved test domain (test.cc is a reserved test TLD, so no real
-- driver is affected; these accounts carry zero race/registration data and are retained
-- ind the DB for reuse in development/QA testing.)

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
WHERE NOT EXISTS (
  SELECT 1
  FROM auth.users AS u
  WHERE u.id = p.user_id
    AND u.email ILIKE '%@test.cc'
);

REVOKE ALL ON TABLE public.public_profiles FROM PUBLIC;
GRANT SELECT ON TABLE public.public_profiles TO anon, authenticated;

COMMIT;