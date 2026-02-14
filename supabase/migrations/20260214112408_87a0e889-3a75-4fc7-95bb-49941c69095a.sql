
-- Add user_id column to research_reports
ALTER TABLE public.research_reports ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id column to study_pdfs
ALTER TABLE public.study_pdfs ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop old permissive policies on research_reports
DROP POLICY IF EXISTS "Anyone can create reports" ON public.research_reports;
DROP POLICY IF EXISTS "Anyone can update reports" ON public.research_reports;
DROP POLICY IF EXISTS "Anyone can view reports" ON public.research_reports;

-- Drop old permissive policies on study_pdfs
DROP POLICY IF EXISTS "Anyone can insert study_pdfs" ON public.study_pdfs;
DROP POLICY IF EXISTS "Anyone can update study_pdfs" ON public.study_pdfs;
DROP POLICY IF EXISTS "Anyone can view study_pdfs" ON public.study_pdfs;

-- New RLS policies for research_reports
CREATE POLICY "Users can view own reports"
  ON public.research_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own reports"
  ON public.research_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports"
  ON public.research_reports FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role needs to update reports from edge functions (background tasks)
CREATE POLICY "Service role can manage all reports"
  ON public.research_reports FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- New RLS policies for study_pdfs
CREATE POLICY "Users can view own pdfs"
  ON public.study_pdfs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own pdfs"
  ON public.study_pdfs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pdfs"
  ON public.study_pdfs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all pdfs"
  ON public.study_pdfs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Rate limits table: service role policy already exists, no changes needed
