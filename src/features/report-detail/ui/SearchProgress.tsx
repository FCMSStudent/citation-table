import { useState, useEffect } from 'react';
import { Loader2, Search, Brain, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { Progress } from '@/shared/ui/progress';

interface SearchProgressProps {
  status: 'processing' | 'completed' | 'failed';
  createdAt: string;
  errorMessage?: string | null;
}

const STAGES = [
  { label: 'Searching academic databases…', icon: Search, durationMs: 10000 },
  { label: 'Analyzing and extracting evidence…', icon: Brain, durationMs: 20000 },
  { label: 'Generating synthesis…', icon: FileText, durationMs: 20000 },
];

const TOTAL_ESTIMATED_MS = STAGES.reduce((s, st) => s + st.durationMs, 0); // 50s

export function SearchProgress({ status, createdAt, errorMessage }: SearchProgressProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (status !== 'processing') return;

    const start = new Date(createdAt).getTime();
    const tick = () => setElapsedMs(Date.now() - start);
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [status, createdAt]);

  if (status === 'failed') {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" />
        <h2 className="text-lg font-semibold text-foreground">Search Failed</h2>
        <p className="mt-2 text-sm text-muted-foreground">{errorMessage || 'An unexpected error occurred.'}</p>
      </div>
    );
  }

  if (status === 'completed') {
    return null; // parent will render results
  }

  // Determine current stage
  let accumulated = 0;
  let currentStageIndex = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (elapsedMs < accumulated + STAGES[i].durationMs) {
      currentStageIndex = i;
      break;
    }
    accumulated += STAGES[i].durationMs;
    if (i === STAGES.length - 1) currentStageIndex = i;
  }

  const progressPercent = Math.min((elapsedMs / TOTAL_ESTIMATED_MS) * 95, 95); // cap at 95% until done
  const remainingSeconds = Math.max(0, Math.ceil((TOTAL_ESTIMATED_MS - elapsedMs) / 1000));
  const CurrentIcon = STAGES[currentStageIndex].icon;

  return (
    <div className="mx-auto max-w-xl space-y-6 rounded-lg border bg-card p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative">
          <div className="rounded-full bg-primary/10 p-4">
            <CurrentIcon className="h-8 w-8 text-primary" />
          </div>
          <Loader2 className="absolute -right-1 -top-1 h-5 w-5 animate-spin text-primary" />
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">Processing your research</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {STAGES[currentStageIndex].label}
          </p>
        </div>
      </div>

      <Progress value={progressPercent} className="h-2" />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {remainingSeconds > 0
            ? `~${remainingSeconds}s remaining`
            : 'Almost done…'}
        </span>
        <span>{Math.round(progressPercent)}%</span>
      </div>

      {/* Stage indicators */}
      <div className="space-y-2">
        {STAGES.map((stage, i) => {
          const StageIcon = stage.icon;
          const isDone = i < currentStageIndex || (i === currentStageIndex && elapsedMs >= accumulated + stage.durationMs);
          const isCurrent = i === currentStageIndex && !isDone;

          return (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isCurrent
                  ? 'bg-primary/5 text-foreground font-medium'
                  : isDone
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/50'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : isCurrent ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <StageIcon className="h-4 w-4" />
              )}
              <span>{stage.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
