import { cn } from '@/shared/lib/utils';

export function TableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto rounded-lg border border-[hsl(var(--table-border))]', className)}>{children}</div>;
}

export function TableCaption({ children, className }: { children: React.ReactNode; className?: string }) {
  return <caption className={cn('px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--type-xs)] text-muted-foreground', className)}>{children}</caption>;
}

export function TableHeaderCell({ children, className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className={cn('border-b border-[hsl(var(--table-border))] bg-[hsl(var(--table-header))] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--type-sm)] font-medium', className)}
    >
      {children}
    </th>
  );
}

export function TableDataCell({ children, className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...props}
      className={cn('border-b border-[hsl(var(--table-border))] px-[var(--space-3)] py-[var(--space-2)] text-[var(--type-sm)]', className)}
    >
      {children}
    </td>
  );
}
