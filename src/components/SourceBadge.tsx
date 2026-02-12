import { Badge } from '@/components/ui/badge';
import type { StudyResult } from '@/types/research';

interface SourceBadgeProps {
  source: StudyResult['source'];
  citationCount?: number;
}

export function SourceBadge({ source, citationCount }: SourceBadgeProps) {
  const citationText = citationCount !== undefined ? ` (${citationCount} citations)` : '';
  
  if (source === "semantic_scholar") {
    return (
      <Badge className="bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900 dark:text-indigo-100">
        Semantic Scholar{citationText}
      </Badge>
    );
  }
  
  return (
    <Badge className="bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-900 dark:text-cyan-100">
      OpenAlex{citationText}
    </Badge>
  );
}
