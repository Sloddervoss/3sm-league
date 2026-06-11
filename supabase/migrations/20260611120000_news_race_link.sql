-- Optional race-result link for public news articles.
-- Editors can connect a recap/article to the expanded race result page.

ALTER TABLE public.news_posts
  ADD COLUMN IF NOT EXISTS race_id UUID REFERENCES public.races(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_news_posts_race_id ON public.news_posts(race_id);
