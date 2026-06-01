-- Metadata needed for professional news platform features.
-- Keeps existing articles valid: season linking is optional and analytics start at zero.

ALTER TABLE public.news_posts
  ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES public.leagues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_news_posts_season_id ON public.news_posts(season_id);
CREATE INDEX IF NOT EXISTS idx_news_posts_status_published_at ON public.news_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_posts_view_count ON public.news_posts(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_news_posts_is_featured ON public.news_posts(is_featured) WHERE is_featured = true;
