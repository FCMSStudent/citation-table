import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/* ── DataTable: outer container ── */
export function DataTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

/* ── DataTableHeader: styled thead ── */
export function DataTableHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <thead className={cn("bg-muted/50", className)}>{children}</thead>;
}

/* ── DataTableRow: tr with hover + selection ── */
export function DataTableRow({
  children,
  isSelected,
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { isSelected?: boolean }) {
  return (
    <tr
      className={cn(
        "border-b transition-colors hover:bg-muted/30",
        isSelected && "bg-accent/20",
        className
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

/* ── SortButton: reusable column sort trigger ── */
interface SortButtonProps<T extends string> {
  field: T;
  label: string;
  activeField: T;
  direction: "asc" | "desc";
  onSort: (field: T) => void;
}

export function SortButton<T extends string>({
  field,
  label,
  activeField,
  direction,
  onSort,
}: SortButtonProps<T>) {
  const isActive = activeField === field;
  return (
    <button
      onClick={() => onSort(field)}
      className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground rounded px-1 whitespace-nowrap"
    >
      {label}
      {isActive ? (
        direction === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
      )}
    </button>
  );
}

/* ── SelectionToolbar: "{n} selected" bar ── */
interface SelectionToolbarProps {
  count: number;
  onCompare?: () => void;
  onExport?: () => void;
  onClear: () => void;
}

export function SelectionToolbar({
  count,
  onCompare,
  onExport,
  onClear,
}: SelectionToolbarProps) {
  if (count === 0) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border bg-accent/30 p-3">
      <span className="text-sm font-medium">
        {count} {count === 1 ? "study" : "studies"} selected
      </span>
      <div className="flex gap-2">
        {onCompare && (
          <Button variant="outline" size="sm" onClick={onCompare}>
            Compare
          </Button>
        )}
        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            Export Selected
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
