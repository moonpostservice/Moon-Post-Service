-- Migration: Storage bucket security policies
-- Requirements: 11.1, 11.2, 11.3, 11.4

-- ============================================================
-- Avatars bucket
-- ============================================================

-- Authenticated users can upload avatars only to their own folder ({auth.uid()}/...).
CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read access for avatars (images referenced by public URL in messages).
CREATE POLICY "Public avatar read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- ============================================================
-- Moon-photos bucket
-- ============================================================

-- Authenticated users can upload moon photos only to their own folder ({context}/{auth.uid()}/...).
CREATE POLICY "Users upload own moon photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'moon-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Public read access for moon photos.
CREATE POLICY "Public moon photo read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'moon-photos');

-- Unauthenticated uploads are denied by default:
-- All INSERT policies above use TO authenticated, so anon role has no INSERT policy.
-- No INSERT policy for anon = deny by default (Requirement 11.4).
