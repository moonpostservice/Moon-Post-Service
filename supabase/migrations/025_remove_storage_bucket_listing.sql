-- Phase 3: stop anyone from enumerating every file in the public buckets.
-- These broad SELECT policies on storage.objects let any client LIST all
-- filenames. Public buckets serve object downloads via the public CDN endpoint
-- without an RLS SELECT policy, so dropping these does not affect getPublicUrl
-- image display — it only removes the ability to list the bucket contents.
DROP POLICY IF EXISTS "Anyone can read avatars"     ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view moon photos" ON storage.objects;
