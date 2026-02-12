import type { StudyResult } from '@/types/research';

interface OutcomeAggregation {
  outcome: string;
  studyCount: number;
  studies: Array<{ study: StudyResult; result: string }>;
}

interface SynthesisViewProps {
  studies: StudyResult[];
  outcomeAggregation: OutcomeAggregation[];
  query: string;
}

export function SynthesisView({ studies, outcomeAggregation, query }: SynthesisViewProps) {
  if (studies.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No studies to synthesize.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {outcomeAggregation.map(({ outcome, studyCount, studies: outcomeStudies }) => (
        <div key={outcome} className="rounded-lg border bg-card p-4">
          <h4 className="mb-2 font-semibold capitalize text-card-foreground">
            {outcome}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({studyCount} {studyCount === 1 ? 'study' : 'studies'})
            </span>
          </h4>
          <ul className="space-y-2">
            {outcomeStudies.map(({ study, result }) => (
              <li key={study.study_id} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{study.title}</span>
                <span className="ml-1 text-xs">({study.year})</span>
                {result && <span className="ml-2">— {result}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {outcomeAggregation.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">
          No structured outcomes available for synthesis view.
        </div>
      )}
    </div>
  );
}
