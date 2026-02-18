import { cn } from '@/shared/lib/utils';

type StatusTone = 'success' | 'warning' | 'info' | 'danger' | 'neutral';

const toneClass: Record<StatusTone, string> = {
  success: 'bg-[hsl(var(--status-success)/0.14)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.35)]',
  warning: 'bg-[hsl(var(--status-warning)/0.14)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.35)]',
  info: 'bg-[hsl(var(--status-info)/0.14)] text-[hsl(var(--status-info))] border-[hsl(var(--status-info)/0.35)]',
  danger: 'bg-[hsl(var(--status-danger)/0.14)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.35)]',
  neutral: 'bg-muted text-muted-foreground border-border',
};

export function StatusChip({ tone = 'neutral', children, className }: { tone?: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[var(--type-xs)] font-medium', toneClass[tone], className)}>
      {children}
    </span>
  );
}
