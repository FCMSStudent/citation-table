import { Badge } from '@/components/ui/badge';
import type { StudyResult } from '@/types/research';

interface ReviewTypeBadgeProps {
  reviewType: StudyResult['review_type'];
}

export function ReviewTypeBadge({ reviewType }: ReviewTypeBadgeProps) {
  if (reviewType === "Meta-analysis") {
    return (
      <Badge className="bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900 dark:text-purple-100 font-bold">
        Meta-analysis
      </Badge>
    );
  }
  
  if (reviewType === "Systematic review") {
    return (
      <Badge className="bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-900 dark:text-violet-100">
        Systematic Review
      </Badge>
    );
  }
  
  return null; // Don't show badge for "None"
}
