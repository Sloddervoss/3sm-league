-- Supabase Storage bucket voor aankondiging-afbeeldingen
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcement-images',
  'announcement-images',
  true,
  5242880, -- 5 MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Iedereen mag lezen (public bucket)
CREATE POLICY "Public read announcement images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'announcement-images');

-- Alleen ingelogde gebruikers mogen uploaden
CREATE POLICY "Authenticated upload announcement images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'announcement-images' AND auth.role() = 'authenticated');

-- Alleen ingelogde gebruikers mogen verwijderen
CREATE POLICY "Authenticated delete announcement images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'announcement-images' AND auth.role() = 'authenticated');
