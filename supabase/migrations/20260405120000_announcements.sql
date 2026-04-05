CREATE TABLE public.announcements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  image_url TEXT,
  tag TEXT NOT NULL DEFAULT 'none',
  sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can do everything on announcements" ON public.announcements
  USING (true) WITH CHECK (true);

-- Anon kan lezen (bot gebruikt anon key)
CREATE POLICY "Anyone can read announcements" ON public.announcements
  FOR SELECT USING (true);

-- Anon kan sent updaten (bot markeert als verzonden)
CREATE POLICY "Anyone can update sent on announcements" ON public.announcements
  FOR UPDATE USING (true) WITH CHECK (true);

-- Anon kan inserten (site gebruikt anon key)
CREATE POLICY "Anyone can insert announcements" ON public.announcements
  FOR INSERT WITH CHECK (true);
