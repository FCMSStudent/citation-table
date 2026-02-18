import { getOutcomeText, isLowValueStudy } from '@/utils/relevanceScore';
import type { ExtractionStats, SearchStats, StudyResult } from '@/shared/types/research';
import type { ScoredStudy, SortOption, StudyDesignFilter } from '@/features/studyTable/model/useStudyTableState';

const searchBlobCache = new WeakMap<StudyResult, string>();

function buildSearchBlob(study: StudyResult): string {
  const outcomesText = (study.outcomes || [])
    .map((o) => `${o.outcome_measured || ''} ${o.key_result || ''} ${o.citation_snippet || ''}`)
    .join(' ');

  return [
    study.title,
    study.study_design,
    study.sample_size ?? '',
    study.population ?? '',
    study.abstract_excerpt ?? '',
    study.citation.formatted ?? '',
    outcomesText,
  ]
    .join(' ')
    .toLowerCase();
}

function cachedSearchBlob(study: StudyResult): string {
  const cached = searchBlobCache.get(study);
  if (cached !== undefined) return cached;
  const blob = buildSearchBlob(study);
  searchBlobCache.set(study, blob);
  return blob;
}

export interface DerivedRunPhase {
  id: 'queued' | 'searching' | 'extracting' | 'synthesizing' | 'completed' | 'failed';
  label: string;
}

export function matchesStudyDesignFilter(study: StudyResult, design: StudyDesignFilter): boolean {
  if (design === 'all') return true;
  if (design === 'meta') return study.review_type === 'Meta-analysis';
  if (design === 'review') return study.study_design === 'review' || study.review_type === 'Systematic review';
  if (design === 'rct') return study.study_design === 'RCT' || study.study_design?.toLowerCase().includes('rct');
  if (design === 'cohort') return study.study_design === 'cohort';
  if (design === 'cross-sectional') return study.study_design === 'cross-sectional';
  return study.study_design === 'unknown';
}

export function buildPaginationWindow(current: number, total: number, windowSize = 5): number[] {
  if (total <= 0) return [];
  const clampedCurrent = Math.min(Math.max(current, 1), total);
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, clampedCurrent - half);
  const end = Math.min(total, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages: number[] = [];
  for (let page = start; page <= end; page += 1) pages.push(page);
  return pages;
}

export function deriveRunPhase(args: {
  status: 'processing' | 'completed' | 'failed';
  searchStats?: SearchStats | null;
  extractionStats?: ExtractionStats | null;
  activeExtractionRunId?: string | null;
}): DerivedRunPhase {
  if (args.status === 'failed') return { id: 'failed', label: 'Failed' };
  if (args.status === 'completed') return { id: 'completed', label: 'Completed' };
  if (!args.activeExtractionRunId && !args.searchStats) return { id: 'queued', label: 'Queued' };
  if ((args.searchStats?.retrieved_total ?? 0) === 0) return { id: 'searching', label: 'Searching sources' };
  if ((args.extractionStats?.extracted_total ?? 0) < (args.extractionStats?.total_inputs ?? 1)) {
    return { id: 'extracting', label: 'Extracting evidence' };
  }
  return { id: 'synthesizing', label: 'Synthesizing report' };
}

export function selectStudies(args: {
  studies: ScoredStudy[];
  sortBy: SortOption;
  studyDesign: StudyDesignFilter;
  explicitOnly: boolean;
  debouncedFind: string;
}): { mainStudies: ScoredStudy[]; excludedStudies: ScoredStudy[] } {
  const sorted = [...args.studies].sort((a, b) => {
    if (a.completenessTier !== b.completenessTier) return a.completenessTier === 'strict' ? -1 : 1;
    const base = args.sortBy === 'year' ? b.year - a.year : b.relevanceScore - a.relevanceScore;
    if (base !== 0) return base;
    if (a.stableIndex !== b.stableIndex) return a.stableIndex - b.stableIndex;
    return a.study_id.localeCompare(b.study_id);
  });

  const main: ScoredStudy[] = [];
  const excluded: ScoredStudy[] = [];
  for (const study of sorted) {
    if (!matchesStudyDesignFilter(study, args.studyDesign)) continue;
    const outcomesText = getOutcomeText(study);
    const isExplicitMatch = (study.outcomes?.length || 0) > 0 && !outcomesText.includes('no outcomes reported');
    if (args.explicitOnly && !isExplicitMatch) continue;
    if (args.debouncedFind && !cachedSearchBlob(study).includes(args.debouncedFind)) continue;
    if (isLowValueStudy(study, study.relevanceScore)) excluded.push(study);
    else main.push(study);
  }
  return { mainStudies: main, excludedStudies: excluded };
}
