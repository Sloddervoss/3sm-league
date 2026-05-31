-- Professional news editor fields: category taxonomy and clarified publishing statuses.

ALTER TABLE public.news_posts
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'League Updates';

UPDATE public.news_posts
SET status = 'draft'
WHERE status = 'review';

ALTER TABLE public.news_posts
  DROP CONSTRAINT IF EXISTS news_posts_status_check;

ALTER TABLE public.news_posts
  ADD CONSTRAINT news_posts_status_check
  CHECK (status IN ('draft', 'planned', 'published', 'archived'));

ALTER TABLE public.news_posts
  DROP CONSTRAINT IF EXISTS news_posts_category_check;

ALTER TABLE public.news_posts
  ADD CONSTRAINT news_posts_category_check
  CHECK (category IN (
    'Raceverslagen',
    'League Updates',
    'Race Recaps',
    'Interviews',
    'Reviews',
    'Community',
    'iRacing Nieuws',
    'Special Events'
  ));

CREATE INDEX IF NOT EXISTS idx_news_posts_category ON public.news_posts(category);
CREATE INDEX IF NOT EXISTS idx_news_posts_status_category ON public.news_posts(status, category);
