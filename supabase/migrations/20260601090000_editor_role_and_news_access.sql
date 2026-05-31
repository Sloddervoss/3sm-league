-- Add an independent editor role for news/content workflows.
-- Editors can exist next to steward/moderator without receiving admin rights.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'editor';

CREATE TABLE IF NOT EXISTS public.news_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_html TEXT NOT NULL DEFAULT '',
  hero_image_url TEXT,
  hero_image_alt TEXT,
  seo_title TEXT,
  seo_description TEXT,
  og_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  language TEXT NOT NULL DEFAULT 'nl' CHECK (language IN ('nl', 'en')),
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.news_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Published news is public" ON public.news_posts;
CREATE POLICY "Published news is public"
  ON public.news_posts FOR SELECT
  USING (status = 'published');

DROP POLICY IF EXISTS "Editors and admins can read news drafts" ON public.news_posts;
CREATE POLICY "Editors and admins can read news drafts"
  ON public.news_posts FOR SELECT
  USING (
    public.has_role((SELECT auth.uid()), 'editor')
    OR public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  );

DROP POLICY IF EXISTS "Editors and admins can insert news" ON public.news_posts;
CREATE POLICY "Editors and admins can insert news"
  ON public.news_posts FOR INSERT
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'editor')
    OR public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  );

DROP POLICY IF EXISTS "Editors and admins can update news" ON public.news_posts;
CREATE POLICY "Editors and admins can update news"
  ON public.news_posts FOR UPDATE
  USING (
    public.has_role((SELECT auth.uid()), 'editor')
    OR public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'editor')
    OR public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  );

DROP POLICY IF EXISTS "Admins can delete news" ON public.news_posts;
CREATE POLICY "Admins can delete news"
  ON public.news_posts FOR DELETE
  USING (
    public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  );

DROP TRIGGER IF EXISTS update_news_posts_updated_at ON public.news_posts;
CREATE TRIGGER update_news_posts_updated_at
  BEFORE UPDATE ON public.news_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'news-images',
  'news-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read news images" ON storage.objects;
CREATE POLICY "Public read news images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'news-images');

DROP POLICY IF EXISTS "Editors and admins can upload news images" ON storage.objects;
CREATE POLICY "Editors and admins can upload news images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'news-images'
    AND (
      public.has_role((SELECT auth.uid()), 'editor')
      OR public.has_role((SELECT auth.uid()), 'admin')
      OR public.has_role((SELECT auth.uid()), 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Editors and admins can delete news images" ON storage.objects;
CREATE POLICY "Editors and admins can delete news images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'news-images'
    AND (
      public.has_role((SELECT auth.uid()), 'editor')
      OR public.has_role((SELECT auth.uid()), 'admin')
      OR public.has_role((SELECT auth.uid()), 'super_admin')
    )
  );

CREATE OR REPLACE FUNCTION public.admin_grant_role(target_user_id UUID, target_role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_role = 'super_admin' THEN
    RAISE EXCEPTION 'De super admin rol kan niet worden toegewezen';
  END IF;

  IF target_role = 'editor' THEN
    IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
      RAISE EXCEPTION 'Alleen admins mogen de editor rol toekennen';
    END IF;
  ELSIF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Alleen de super admin mag deze rol toekennen';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, target_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_role(target_user_id UUID, target_role TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_role public.app_role;
BEGIN
  BEGIN
    normalized_role := target_role::public.app_role;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Ongeldige rol: %', target_role USING ERRCODE = '22023';
  END;

  PERFORM public.admin_grant_role(target_user_id, normalized_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(target_user_id UUID, target_role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_role = 'super_admin' THEN
    RAISE EXCEPTION 'De super admin rol kan niet worden ingetrokken';
  END IF;

  IF target_role = 'editor' THEN
    IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
      RAISE EXCEPTION 'Alleen admins mogen de editor rol intrekken';
    END IF;
  ELSIF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Alleen de super admin mag deze rol intrekken';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = target_user_id AND role = target_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(target_user_id UUID, target_role TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_role public.app_role;
BEGIN
  BEGIN
    normalized_role := target_role::public.app_role;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Ongeldige rol: %', target_role USING ERRCODE = '22023';
  END;

  PERFORM public.admin_revoke_role(target_user_id, normalized_role);
END;
$$;
