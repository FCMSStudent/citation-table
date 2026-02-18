import type {
  ClaimSentence,
  CoverageReport,
  EvidenceRow,
  ExtractionStats,
  SearchStats,
  StudyPdf,
  StudyResult,
} from '@/shared/types/research';
import { StudyTableVirtualized } from '@/features/studyTable/ui/StudyTableVirtualized';

interface ResultsTableProps {
  results: StudyResult[];
  partialResults?: StudyResult[] | null;
  query: string;
  normalizedQuery?: string;
  activeExtractionRunId?: string | null;
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
  arxivCount?: number;
  pubmedCount?: number;
  pdfsByDoi?: Record<string, StudyPdf>;
  reportId?: string;
  cachedSynthesis?: string | null;
  evidenceTable?: EvidenceRow[] | null;
  briefSentences?: ClaimSentence[] | null;
  coverageReport?: CoverageReport | null;
  searchStats?: SearchStats | null;
  extractionStats?: ExtractionStats | null;
}

export function ResultsTable(props: ResultsTableProps) {
  return <StudyTableVirtualized {...props} />;
}
