-- Profielschrijfrechten dichtzetten en teamtoewijzing transactief maken.
--
-- Aanleiding: de policy "Users can update own profile" gaf een ingelogde
-- gebruiker UPDATE op alle kolommen van zijn eigen rij. Via de REST-API kon hij
-- dus profiles.discord_id zetten (de /koppel-flow met discord_link_tokens
-- omzeilen) en profiles.team_id wijzigen (buiten de teamindeling om).
--
-- Daarnaast stond teamtoewijzing op twee plekken: profiles.team_id (de site) en
-- team_memberships (de bot). De frontend schreef die twee los van elkaar en
-- negeerde foutresultaten, waardoor een mislukte membership-insert een
-- profiles.team_id achterliet die naar het nieuwe team wees terwijl de
-- membership nog de oude was.
--
-- Deze migratie:
--   1. doet de schema-aanvulling: rating-herkomst op profiles en een partiële
--      unieke index op iracing_id;
--   2. beperkt de kolomrechten van authenticated tot de echte zelfservice-
--      kolommen (display_name, iracing_name, avatar_url);
--   3. zet teamtoewijzing achter drie SECURITY DEFINER-RPC's die profiles.team_id
--      en team_memberships in één transactie schrijven, met één team per
--      gebruiker;
--   4. houdt de overige zelfservice-schrijfacties (iRacing-koppeling, Discord
--      ontkoppelen, iRating-snapshots van de resultatenimport) werken via smalle
--      RPC's in plaats van tabelrechten;
--   5. rapporteert de bestaande toewijzingen en valideert ze voordat de migratie
--      klaar is. Er wordt niets bijgeschreven: zie punt 5 onderaan.
--
-- Forward-only. Dit bestand is in één keer uitvoerbaar met `psql -f` en sluit
-- zelf af met COMMIT, net als de andere migraties in deze map.

BEGIN;

-- 1. Schema-aanvulling --------------------------------------------------------

-- Rating-herkomst. Zelf invullen blijft toegestaan (beginwaarde voor nieuwe
-- coureurs), maar vanaf nu is zichtbaar waar de waarde vandaan komt: 'self' is
-- door de coureur zelf ingevuld, 'imported' komt uit de resultatenimport of de
-- iRacing-sync. Bij 'imported' wint de import: self-service laat irating en
-- safety_rating dan staan.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rating_source TEXT NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS rating_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_rating_source_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_rating_source_check
      CHECK (rating_source IN ('self', 'imported'));
  END IF;
END;
$$;

-- Eén iRacing Customer ID per profiel. De check in update_own_racing_profile
-- hieronder geeft de nette melding; deze index is de harde grens, ook als twee
-- gebruikers tegelijk dezelfde ID claimen.
-- Eerst kijken of dat kan: bestaande dubbele waarden zouden de index creatie
-- laten klappen met een onduidelijke fout.
DO $$
DECLARE
  v_duplicates TEXT;
BEGIN
  SELECT string_agg(format('%s (%sx)', duplicate.iracing_id, duplicate.hits), ', ' ORDER BY duplicate.iracing_id)
    INTO v_duplicates
  FROM (
    SELECT profile.iracing_id, count(*) AS hits
    FROM public.profiles AS profile
    WHERE profile.iracing_id IS NOT NULL
    GROUP BY profile.iracing_id
    HAVING count(*) > 1
  ) AS duplicate;

  IF v_duplicates IS NOT NULL THEN
    RAISE EXCEPTION
      'iracing_id moet uniek zijn, maar deze waarden staan op meerdere profielen: %',
      v_duplicates
      USING ERRCODE = '23505',
            HINT = 'Los de dubbele iracing_id-waarden eerst handmatig op en draai de migratie opnieuw.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_iracing_id_uniq
  ON public.profiles (iracing_id)
  WHERE iracing_id IS NOT NULL;

-- 2. Kolomrechten op profiles ------------------------------------------------
--
-- De RLS-policy blijft staan (auth.uid() = user_id), maar de tabelgrant wordt
-- vervangen door kolomgrants. Zonder grant op een kolom weigert Postgres de
-- schrijfactie, ook als RLS de rij toestaat. discord_id, team_id, user_id,
-- iracing_id, irating, safety_rating en rating_source zijn daarmee niet meer
-- rechtstreeks schrijfbaar.
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, iracing_name, avatar_url) ON TABLE public.profiles TO authenticated;

-- Zelfde gat bestond op de INSERT-policy: een upsert op een ontbrekende rij kon
-- team_id of discord_id meteen meekrijgen. Alleen de zelfservice-kolommen blijven
-- invoegbaar; de signup-trigger draait als owner en heeft deze grant niet nodig.
REVOKE INSERT ON TABLE public.profiles FROM anon, authenticated;
GRANT INSERT (user_id, display_name, iracing_name, avatar_url) ON TABLE public.profiles TO authenticated;

-- Dezelfde dubbele schrijfweg bestond op team_memberships: de policy "Users can
-- manage own team memberships" gaf elke gebruiker INSERT/DELETE op zijn eigen
-- rij, dus de bot kon een team zien dat de site (profiles.team_id) niet kende.
-- De RPC's hieronder zijn vanaf nu de enige schrijfweg; lezen blijft openbaar.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.team_memberships FROM anon, authenticated;

-- 3. Teamtoewijzing: één transactie voor profiles.team_id + team_memberships ---
--
-- Beleid is één team per gebruiker. Daarom verwijdert elke toewijzing eerst de
-- memberships van dat lid bij andere teams, binnen dezelfde transactie als de
-- nieuwe rij en de profiles.team_id-update. Zo wijzen profiles.team_id en
-- team_memberships na elke RPC naar hetzelfde team, ook als de gebruiker eerder
-- in een ander team zat.

CREATE OR REPLACE FUNCTION public.join_team(p_team_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd' USING ERRCODE = '42501';
  END IF;

  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'Geen team opgegeven' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.teams AS team WHERE team.id = p_team_id) THEN
    RAISE EXCEPTION 'Team bestaat niet' USING ERRCODE = '23503';
  END IF;

  -- Eerst het oude team opruimen, dan pas het nieuwe zetten.
  DELETE FROM public.team_memberships
  WHERE user_id = v_user_id
    AND team_id <> p_team_id;

  INSERT INTO public.team_memberships (user_id, team_id, role)
  VALUES (v_user_id, p_team_id, 'driver')
  ON CONFLICT (user_id, team_id) DO NOTHING;

  UPDATE public.profiles
  SET team_id = p_team_id
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profiel niet gevonden' USING ERRCODE = '23503';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_team()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.team_memberships WHERE user_id = v_user_id;

  UPDATE public.profiles
  SET team_id = NULL
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profiel niet gevonden' USING ERRCODE = '23503';
  END IF;
END;
$$;

-- Zelfde autorisatie als de bestaande adminflows op teams en team_memberships
-- (policies "Admins can manage team memberships"): admin of super_admin.
CREATE OR REPLACE FUNCTION public.admin_set_team(p_user_id UUID, p_team_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Alleen beheerders mogen teamtoewijzingen wijzigen' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Geen gebruiker opgegeven' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.user_id = p_user_id) THEN
    RAISE EXCEPTION 'Profiel niet gevonden' USING ERRCODE = '23503';
  END IF;

  -- p_team_id NULL betekent: uit het team halen. Ook dan geldt één team per
  -- gebruiker, dus alle memberships gaan weg.
  IF p_team_id IS NULL THEN
    DELETE FROM public.team_memberships WHERE user_id = p_user_id;

    UPDATE public.profiles
    SET team_id = NULL
    WHERE user_id = p_user_id;

    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.teams AS team WHERE team.id = p_team_id) THEN
    RAISE EXCEPTION 'Team bestaat niet' USING ERRCODE = '23503';
  END IF;

  -- Zelfde opruimstap als in join_team: één team per gebruiker.
  DELETE FROM public.team_memberships
  WHERE user_id = p_user_id
    AND team_id <> p_team_id;

  INSERT INTO public.team_memberships (user_id, team_id, role)
  VALUES (p_user_id, p_team_id, 'driver')
  ON CONFLICT (user_id, team_id) DO NOTHING;

  UPDATE public.profiles
  SET team_id = p_team_id
  WHERE user_id = p_user_id;
END;
$$;

-- 4. Overige zelfservice-schrijfacties via smalle RPC's -----------------------
--
-- Deze kolommen vielen onder de oude alles-toestaande policy. Ze zijn geen
-- team- of Discord-identiteit, maar wel rechtstreeks schrijfbaar vanuit de
-- browser. Ze verdwijnen daarom uit de tabelgrant en krijgen elk één functie met
-- eigen validatie, zodat de UI blijft werken zonder brede schrijfrechten.

CREATE OR REPLACE FUNCTION public.update_own_racing_profile(
  p_iracing_id TEXT,
  p_irating INTEGER,
  p_safety_rating TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_iracing_id TEXT := NULLIF(btrim(p_iracing_id), '');
  v_safety_rating TEXT := NULLIF(btrim(p_safety_rating), '');
  v_rating_source TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd' USING ERRCODE = '42501';
  END IF;

  -- iRacing Customer ID: leeg (NULL) betekent ontkoppelen en mag altijd.
  IF v_iracing_id IS NOT NULL AND v_iracing_id !~ '^[0-9]{1,12}$' THEN
    RAISE EXCEPTION 'iRacing Customer ID moet numeriek zijn' USING ERRCODE = '22023';
  END IF;

  -- Een customer ID mag maar aan één profiel hangen; anders koppelt de
  -- resultatenimport andermans races aan dit account. Een ID dat al op dit
  -- profiel staat is geen conflict (opnieuw opslaan blijft werken).
  IF v_iracing_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.iracing_id = v_iracing_id
      AND profile.user_id <> v_user_id
  ) THEN
    RAISE EXCEPTION
      'iracing_id_in_use: deze iRacing Customer ID (%) is al aan een ander profiel gekoppeld',
      v_iracing_id
      USING ERRCODE = '23505',
            HINT = 'Vraag een beheerder om de koppeling na te kijken; twee profielen op één customer ID is niet toegestaan.';
  END IF;

  SELECT profile.rating_source INTO v_rating_source
  FROM public.profiles AS profile
  WHERE profile.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profiel niet gevonden' USING ERRCODE = '23503';
  END IF;

  -- Self-service mag ratings alleen zetten als de import ze niet bezit, en
  -- alleen binnen de grenzen van een beginwaarde. Boven 5000 iRating of 5.00 SR
  -- is import-werk; weigeren is beter dan stil een verkeerde waarde opslaan.
  IF v_rating_source <> 'imported' THEN
    IF p_irating IS NOT NULL AND (p_irating < 0 OR p_irating > 5000) THEN
      RAISE EXCEPTION
        'iRating moet tussen 0 en 5000 liggen; laat het veld leeg als je daarboven zit (de resultatenimport vult je rating)'
        USING ERRCODE = '22023';
    END IF;

    IF v_safety_rating IS NOT NULL AND (
      v_safety_rating !~ '^([A-Z]{1,3} )?[0-9](\.[0-9]{1,2})?$'
      OR substring(v_safety_rating from '([0-9]+(\.[0-9]{1,2})?)$')::numeric > 5.00
    ) THEN
      RAISE EXCEPTION
        'Safety Rating moet een waarde tussen 0.00 en 5.00 zijn, bijvoorbeeld "A 4.50"'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  BEGIN
    UPDATE public.profiles AS profile
    SET iracing_id = v_iracing_id,
        irating = CASE WHEN v_rating_source = 'imported' THEN profile.irating ELSE p_irating END,
        safety_rating = CASE WHEN v_rating_source = 'imported' THEN profile.safety_rating ELSE v_safety_rating END,
        -- Alleen een echte wijziging van de ratings krijgt een nieuw tijdstempel;
        -- iemand die alleen zijn customer ID koppelt vervuilt de historie niet.
        rating_updated_at = CASE
          WHEN v_rating_source = 'imported' THEN profile.rating_updated_at
          WHEN profile.irating IS DISTINCT FROM p_irating
            OR profile.safety_rating IS DISTINCT FROM v_safety_rating THEN now()
          ELSE profile.rating_updated_at
        END
    WHERE profile.user_id = v_user_id;
  EXCEPTION
    -- Twee gebruikers die tegelijk dezelfde customer ID claimen: de EXISTS-check
    -- hierboven ziet elkaars rij nog niet, de unieke index wel.
    WHEN unique_violation THEN
      RAISE EXCEPTION
        'iracing_id_in_use: deze iRacing Customer ID is al aan een ander profiel gekoppeld'
        USING ERRCODE = '23505';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profiel niet gevonden' USING ERRCODE = '23503';
  END IF;
END;
$$;

-- Ontkoppelen mag alleen leegmaken, nooit een andere discord_id zetten.
CREATE OR REPLACE FUNCTION public.unlink_own_discord()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET discord_id = NULL
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profiel niet gevonden' USING ERRCODE = '23503';
  END IF;
END;
$$;

-- De resultatenimport schrijft iRating/safety-snapshots voor willekeurige
-- coureurs. Dat blijft beheerderswerk, met dezelfde rolcheck als admin_set_team.
-- Dit is ook de plek die de herkomst op 'imported' zet: vanaf dat moment is de
-- import eigenaar van de ratings en laat update_own_racing_profile ze staan.
CREATE OR REPLACE FUNCTION public.admin_update_driver_ratings(
  p_user_id UUID,
  p_irating INTEGER,
  p_safety_rating TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Alleen beheerders mogen ratings bijwerken' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Geen gebruiker opgegeven' USING ERRCODE = '22023';
  END IF;

  IF p_irating IS NOT NULL AND (p_irating < 0 OR p_irating > 20000) THEN
    RAISE EXCEPTION 'iRating buiten bereik' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET irating = p_irating,
      safety_rating = NULLIF(btrim(p_safety_rating), ''),
      rating_source = 'imported',
      rating_updated_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profiel niet gevonden' USING ERRCODE = '23503';
  END IF;
END;
$$;

-- API-grants: alleen ingelogde gebruikers, nooit anon. De functies zelf doen de
-- rol- en eigenaarscheck.
REVOKE ALL ON FUNCTION public.join_team(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_team() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_team(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_own_racing_profile(TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_own_discord() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_driver_ratings(UUID, INTEGER, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.join_team(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_team() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_team(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_racing_profile(TEXT, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_own_discord() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_driver_ratings(UUID, INTEGER, TEXT) TO authenticated;

-- 5. Bestaande data rapporteren en valideren ---------------------------------
--
-- Bewust geen backfill meer. profiles.team_id is tot deze migratie vrij
-- schrijfbaar geweest, dus een membership die daaruit geraden wordt kan net zo
-- goed een achtergebleven waarde zijn. Deze stap schrijft niets: hij meldt wat
-- een backfill zou toevoegen (met de user_id's) en faalt alleen als de bestaande
-- toewijzingen al inconsistent zijn. Opruimen of aanvullen is handwerk, met de
-- bot en de site naast elkaar.
DO $$
DECLARE
  v_memberships BIGINT;
  v_teams BIGINT;
  v_profiles_with_team BIGINT;
  v_missing BIGINT;
  v_missing_ids TEXT;
  v_orphans BIGINT;
  v_multi_team_users BIGINT;
BEGIN
  SELECT count(*) INTO v_memberships FROM public.team_memberships;
  SELECT count(DISTINCT membership.team_id) INTO v_teams
  FROM public.team_memberships AS membership;
  SELECT count(*) INTO v_profiles_with_team FROM public.profiles WHERE team_id IS NOT NULL;

  -- Profielen met een team_id zonder bijpassende membership: dit zou een
  -- backfill zijn. Alleen tellen en benoemen, niet invoegen.
  SELECT count(*), coalesce(string_agg(missing.user_id::text, ', ' ORDER BY missing.user_id), '(geen)')
    INTO v_missing, v_missing_ids
  FROM (
    SELECT profile.user_id
    FROM public.profiles AS profile
    WHERE profile.team_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.team_memberships AS membership
        WHERE membership.user_id = profile.user_id
          AND membership.team_id = profile.team_id
      )
  ) AS missing;

  -- Een membership zonder profielrij kan de bot wel lezen maar de site niet.
  SELECT count(*) INTO v_orphans
  FROM public.team_memberships AS membership
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile WHERE profile.user_id = membership.user_id
  );

  -- Beleid is één team per gebruiker; meerdere memberships zijn een restant uit
  -- de tijd dat de site en de bot los schreven.
  SELECT count(*) INTO v_multi_team_users
  FROM (
    SELECT membership.user_id
    FROM public.team_memberships AS membership
    GROUP BY membership.user_id
    HAVING count(*) > 1
  ) AS multi;

  RAISE NOTICE
    'Teamtoewijzing rapport: % memberships over % teams, % profielen met team_id, % profielen zonder membership (user_id: %), % memberships zonder profiel, % gebruikers met meer dan één membership',
    v_memberships, v_teams, v_profiles_with_team, v_missing, v_missing_ids, v_orphans, v_multi_team_users;

  IF v_missing > 0 OR v_orphans > 0 THEN
    RAISE EXCEPTION
      'Teamtoewijzing inconsistent: memberships=%, teams=%, profielen met team_id=%, ontbrekende memberships=%, memberships zonder profiel=%',
      v_memberships, v_teams, v_profiles_with_team, v_missing, v_orphans
      USING ERRCODE = '23514',
            HINT = 'Herstel de toewijzingen handmatig (site en bot samen) en draai de migratie opnieuw.';
  END IF;

  RAISE NOTICE
    'Teamtoewijzing gevalideerd: % memberships over % teams, % profielen met team_id',
    v_memberships, v_teams, v_profiles_with_team;
END;
$$;

COMMIT;
