import { Badge } from '@/components/ui/badge';
import type { StudyResult } from '@/types/research';

interface PreprintBadgeProps {
  status: StudyResult['preprint_status'];
}

export function PreprintBadge({ status }: PreprintBadgeProps) {
  if (status === "Preprint") {
    return (
      <Badge className="bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900 dark:text-orange-100">
        Preprint
      </Badge>
    );
  }
  
  return (
    <Badge className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-100">
      Peer-reviewed
    </Badge>
  );
}
