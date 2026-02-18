import { cn } from '@/shared/lib/utils';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const toneClass: Record<AlertTone, string> = {
  info: 'border-[hsl(var(--status-info)/0.35)] bg-[hsl(var(--status-info)/0.08)]',
  success: 'border-[hsl(var(--status-success)/0.35)] bg-[hsl(var(--status-success)/0.08)]',
  warning: 'border-[hsl(var(--status-warning)/0.35)] bg-[hsl(var(--status-warning)/0.08)]',
  danger: 'border-[hsl(var(--status-danger)/0.35)] bg-[hsl(var(--status-danger)/0.08)]',
};

export function Alert({ tone = 'info', title, children, className }: { tone?: AlertTone; title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section role="status" className={cn('rounded-lg border p-[var(--space-4)]', toneClass[tone], className)}>
      {title ? <h3 className="text-[var(--type-sm)] font-semibold text-foreground">{title}</h3> : null}
      <div className={cn('text-[var(--type-sm)] text-muted-foreground', title && 'mt-[var(--space-2)]')}>{children}</div>
    </section>
  );
}
