import { Info } from 'lucide-react';
import type { CoverageReport, EvidenceRow, ExtractionStats, SearchStats } from '@/shared/types/research';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/Popover';
import { useStudyTableContext } from '@/features/studyTable/ui/StudyTableContext';

interface StudyTableHeaderProps {
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
  arxivCount?: number;
  pubmedCount?: number;
  coverageReport?: CoverageReport | null;
  searchStats?: SearchStats | null;
  extractionStats?: ExtractionStats | null;
  evidenceTable?: EvidenceRow[] | null;
}

export function StudyTableHeader({
  totalPapersSearched,
  openalexCount,
  semanticScholarCount,
  arxivCount,
  pubmedCount,
  coverageReport,
  searchStats,
  extractionStats,
  evidenceTable,
}: StudyTableHeaderProps) {
  const state = useStudyTableContext();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>
        Found <strong>{state.mainStudies.length}</strong> relevant {state.mainStudies.length === 1 ? 'study' : 'studies'} from{' '}
        <strong>{totalPapersSearched}</strong> papers
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center rounded text-muted-foreground hover:text-foreground" aria-label="View methodology details" title="Methodology details">
            <Info className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[340px]">
          <div className="text-xs">
            <h4 className="mb-2 font-semibold text-foreground">Methodology details</h4>
            <table className="w-full text-left">
              <tbody className="divide-y divide-border/50">
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">OpenAlex</th><td className="py-1">{openalexCount ?? 0}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Semantic Scholar</th><td className="py-1">{semanticScholarCount ?? 0}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">arXiv</th><td className="py-1">{arxivCount ?? 0}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">PubMed</th><td className="py-1">{pubmedCount ?? 0}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Coverage</th><td className="py-1">{coverageReport ? `${coverageReport.providers_queried - coverageReport.providers_failed}/${coverageReport.providers_queried} healthy` : '—'}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Pipeline latency</th><td className="py-1">{searchStats ? `${Math.round(searchStats.latency_ms / 1000)}s` : '—'}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Retrieved total</th><td className="py-1">{searchStats?.retrieved_total ?? '—'}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Abstract-eligible</th><td className="py-1">{searchStats?.abstract_eligible_total ?? '—'}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Quality-kept</th><td className="py-1">{searchStats?.quality_kept_total ?? '—'}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Extraction inputs</th><td className="py-1">{searchStats?.extraction_input_total ?? extractionStats?.total_inputs ?? '—'}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Strict complete</th><td className="py-1">{searchStats?.strict_complete_total ?? extractionStats?.complete_total ?? '—'}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Partial complete</th><td className="py-1">{searchStats?.partial_total ?? extractionStats?.partial_total ?? '—'}</td></tr>
                <tr><th className="py-1 pr-3 font-medium text-muted-foreground">Evidence rows</th><td className="py-1">{evidenceTable?.length ?? 0}</td></tr>
              </tbody>
            </table>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
