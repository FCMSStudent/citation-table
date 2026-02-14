-- Make papers bucket private
UPDATE storage.buckets SET public = false WHERE id = 'papers';

-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Anyone can view papers" ON storage.objects;

-- Add owner-scoped SELECT policy
CREATE POLICY "Users can view own papers"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'papers' AND
    auth.uid() IN (
      SELECT user_id FROM public.study_pdfs
      WHERE storage_path = name
    )
  );
