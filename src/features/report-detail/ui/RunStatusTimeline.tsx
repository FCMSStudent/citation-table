import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw, Search, Brain, FileText } from 'lucide-react';
import type { ExtractionStats, SearchStats } from '@/shared/types/research';
import { Button } from '@/shared/ui/Button';
import { deriveRunPhase } from '@/features/studyTable/model/studyTableSelectors';

interface RunStatusTimelineProps {
  status: 'processing' | 'completed' | 'failed';
  errorMessage?: string | null;
  searchStats?: SearchStats | null;
  extractionStats?: ExtractionStats | null;
  activeExtractionRunId?: string | null;
  isFetching?: boolean;
  dataUpdatedAt?: number;
  onRetry?: () => void;
}

const STAGES = [
  { id: 'queued', label: 'Queued', icon: Clock3 },
  { id: 'searching', label: 'Searching sources', icon: Search },
  { id: 'extracting', label: 'Extracting evidence', icon: Brain },
  { id: 'synthesizing', label: 'Synthesizing report', icon: FileText },
  { id: 'completed', label: 'Completed', icon: CheckCircle2 },
] as const;

export function RunStatusTimeline({
  status,
  errorMessage,
  searchStats,
  extractionStats,
  activeExtractionRunId,
  isFetching = false,
  dataUpdatedAt,
  onRetry,
}: RunStatusTimelineProps) {
  const phase = deriveRunPhase({ status, searchStats, extractionStats, activeExtractionRunId });

  if (phase.id === 'failed') {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" />
        <h2 className="text-lg font-semibold text-foreground">Search failed</h2>
        <p className="mt-2 text-sm text-muted-foreground">{errorMessage || 'An unexpected error occurred.'}</p>
        {onRetry && (
          <Button onClick={onRetry} className="mt-4 gap-2" size="sm">
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        )}
      </div>
    );
  }

  const currentIndex = STAGES.findIndex((stage) => stage.id === phase.id);
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <div className="mx-auto max-w-xl space-y-5 rounded-lg border bg-card p-6" aria-live="polite" aria-atomic="true">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Run status: {phase.label}</h2>
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}
          <span>{isFetching ? 'Polling backend…' : 'Idle'}</span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Last updated {lastUpdated || '—'}
        {activeExtractionRunId ? ` • Active extraction run ${activeExtractionRunId}` : ''}
      </div>

      <div className="space-y-2">
        {STAGES.map((stage, i) => {
          const Icon = stage.icon;
          const isDone = currentIndex > i || phase.id === 'completed';
          const isCurrent = currentIndex === i && phase.id !== 'completed';

          return (
            <div key={stage.id} className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${isCurrent ? 'bg-primary/5 font-medium text-foreground' : 'text-muted-foreground'}`}>
              {isDone ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : isCurrent ? <Loader2 className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" /> : <Icon className="h-4 w-4" />}
              <span>{stage.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
