import type { StudyResult } from '@/types/research';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { StudyBadge } from './StudyBadge';
import { ReviewTypeBadge } from './ReviewTypeBadge';
import { SourceBadge } from './SourceBadge';
import { PreprintBadge } from './PreprintBadge';

interface TableViewProps {
  studies: StudyResult[];
  query: string;
  showScoreBreakdown?: boolean;
}

export function TableView({ studies, query, showScoreBreakdown }: TableViewProps) {
  if (studies.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No studies to display.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="w-16">Year</TableHead>
            <TableHead className="w-24">Design</TableHead>
            <TableHead className="w-20">N</TableHead>
            <TableHead>Key Results</TableHead>
            <TableHead className="w-24">Source</TableHead>
            {showScoreBreakdown && <TableHead className="w-16">Score</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {studies.map((study) => (
            <TableRow key={study.study_id}>
              <TableCell className="max-w-xs">
                <div className="space-y-1">
                  <p className="text-sm font-medium leading-tight">{study.title}</p>
                  <div className="flex flex-wrap gap-1">
                    <PreprintBadge status={study.preprint_status} />
                    <ReviewTypeBadge reviewType={study.review_type} />
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-sm">{study.year}</TableCell>
              <TableCell>
                <StudyBadge design={study.study_design} />
              </TableCell>
              <TableCell className="text-sm">
                {study.sample_size != null ? study.sample_size.toLocaleString() : '—'}
              </TableCell>
              <TableCell className="max-w-sm text-sm text-muted-foreground">
                {study.outcomes
                  .filter((o) => o.key_result)
                  .map((o) => o.key_result)
                  .join('; ') || '—'}
              </TableCell>
              <TableCell>
                <SourceBadge source={study.source} />
              </TableCell>
              {showScoreBreakdown && (
                <TableCell className="text-sm font-mono">
                  {(study as any).relevanceScore?.toFixed(1) ?? '—'}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
