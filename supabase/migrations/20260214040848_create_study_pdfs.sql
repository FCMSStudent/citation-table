-- Create storage bucket for PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('papers', 'papers', true)
ON CONFLICT (id) DO NOTHING;

-- Create study_pdfs table
CREATE TABLE public.study_pdfs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.research_reports(id) ON DELETE CASCADE,
  doi TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'downloaded', 'not_found', 'failed')),
  storage_path TEXT,
  public_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.study_pdfs ENABLE ROW LEVEL SECURITY;

-- Public read access (no auth required - public research tool)
CREATE POLICY "Anyone can view study PDFs"
  ON public.study_pdfs FOR SELECT
  USING (true);

-- Public insert (edge function inserts)
CREATE POLICY "Anyone can create study PDFs"
  ON public.study_pdfs FOR INSERT
  WITH CHECK (true);

-- Public update (edge function updates status)
CREATE POLICY "Anyone can update study PDFs"
  ON public.study_pdfs FOR UPDATE
  USING (true);

-- Index for report_id lookups
CREATE INDEX idx_study_pdfs_report_id ON public.study_pdfs (report_id);

-- Index for DOI lookups
CREATE INDEX idx_study_pdfs_doi ON public.study_pdfs (doi);

-- Index for status filtering
CREATE INDEX idx_study_pdfs_status ON public.study_pdfs (status);

-- Storage policies for papers bucket
CREATE POLICY "Anyone can view papers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'papers');

CREATE POLICY "Service role can upload papers"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'papers');

CREATE POLICY "Service role can update papers"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'papers');

CREATE POLICY "Service role can delete papers"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'papers');
