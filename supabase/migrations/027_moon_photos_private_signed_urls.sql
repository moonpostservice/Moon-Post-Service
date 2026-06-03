-- Phase 4 (photo privacy): make moon-photos a PRIVATE bucket so message photos
-- are no longer world-readable by URL. Access is now via short-lived signed URLs
-- generated client-side, which requires the caller to have SELECT on the object.
UPDATE storage.buckets SET public = false WHERE id = 'moon-photos';

-- Allow logged-in users to read moon-photos objects (needed for createSignedUrl).
-- Paths are unguessable (context/{uuid}/{ms-timestamp}.jpg); combined with a
-- private bucket and expiring signed URLs this removes permanent public access
-- and bucket enumeration. (A participant-scoped policy is a possible future
-- hardening if read access should be limited to the message's sender/recipient.)
CREATE POLICY "Authenticated can read moon photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'moon-photos');
