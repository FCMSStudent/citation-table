
-- Create research_reports table for background search tasks
CREATE TABLE public.research_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question TEXT NOT NULL,
  normalized_query TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  results JSONB,
  total_papers_searched INTEGER DEFAULT 0,
  openalex_count INTEGER DEFAULT 0,
  semantic_scholar_count INTEGER DEFAULT 0,
  arxiv_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.research_reports ENABLE ROW LEVEL SECURITY;

-- Public read access (no auth required - public research tool)
CREATE POLICY "Anyone can view reports"
  ON public.research_reports FOR SELECT
  USING (true);

-- Public insert (edge function inserts)
CREATE POLICY "Anyone can create reports"
  ON public.research_reports FOR INSERT
  WITH CHECK (true);

-- Public update (edge function updates status)
CREATE POLICY "Anyone can update reports"
  ON public.research_reports FOR UPDATE
  USING (true);

-- Index for listing reports by date
CREATE INDEX idx_research_reports_created_at ON public.research_reports (created_at DESC);

-- Index for status filtering
CREATE INDEX idx_research_reports_status ON public.research_reports (status);
