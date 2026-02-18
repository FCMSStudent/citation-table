import { Link } from 'react-router-dom';
import { Clock, CheckCircle2, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { Badge } from '@/shared/ui/Badge';

interface ReportCardProps {
  id: string;
  question: string;
  status: 'processing' | 'completed' | 'failed';
  createdAt: string;
  resultCount?: number;
}

const STATUS_CONFIG = {
  processing: {
    label: 'Processing',
    icon: Loader2,
    variant: 'secondary' as const,
    iconClass: 'animate-spin text-primary',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    variant: 'default' as const,
    iconClass: 'text-green-600 dark:text-green-400',
  },
  failed: {
    label: 'Failed',
    icon: AlertCircle,
    variant: 'destructive' as const,
    iconClass: 'text-destructive',
  },
};

export function ReportCard({ id, question, status, createdAt, resultCount }: ReportCardProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.processing;
  const StatusIcon = config.icon;

  const timeAgo = getTimeAgo(createdAt);

  return (
    <Link
      to={`/reports/${id}`}
      className="group flex items-start gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <div className="mt-0.5 shrink-0">
        <StatusIcon className={`h-5 w-5 ${config.iconClass}`} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
          {question}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </span>
          {status === 'completed' && resultCount !== undefined && (
            <Badge variant="secondary" className="text-xs">
              {resultCount} {resultCount === 1 ? 'study' : 'studies'}
            </Badge>
          )}
          <Badge variant={config.variant} className="text-xs">
            {config.label}
          </Badge>
        </div>
      </div>

      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
