import type { StudyResult } from '@/types/research';
import { cn } from '@/lib/utils';

interface StudyBadgeProps {
  design: StudyResult['study_design'];
}

const designConfig: Record<StudyResult['study_design'], { label: string; className: string }> = {
  RCT: { label: 'RCT', className: 'study-badge-rct' },
  cohort: { label: 'Cohort', className: 'study-badge-cohort' },
  review: { label: 'Review', className: 'study-badge-review' },
  'cross-sectional': { label: 'Cross-sectional', className: 'study-badge-cross-sectional' },
  unknown: { label: 'Unknown', className: 'study-badge-unknown' },
};

export function StudyBadge({ design }: StudyBadgeProps) {
  const config = designConfig[design] || designConfig.unknown;
  
  return (
    <span className={cn('study-badge', config.className)}>
      {config.label}
    </span>
  );
}
