
-- Create study_pdfs table for tracking PDF downloads
CREATE TABLE public.study_pdfs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.research_reports(id) ON DELETE CASCADE,
  doi TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  storage_path TEXT,
  public_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.study_pdfs ENABLE ROW LEVEL SECURITY;

-- Public access policies (matches research_reports)
CREATE POLICY "Anyone can view study_pdfs" ON public.study_pdfs FOR SELECT USING (true);
CREATE POLICY "Anyone can insert study_pdfs" ON public.study_pdfs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update study_pdfs" ON public.study_pdfs FOR UPDATE USING (true);

-- Index for fast lookups by report
CREATE INDEX idx_study_pdfs_report_id ON public.study_pdfs(report_id);
CREATE UNIQUE INDEX idx_study_pdfs_report_doi ON public.study_pdfs(report_id, doi);
