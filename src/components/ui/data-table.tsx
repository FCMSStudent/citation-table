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

/* ── DataTableHeader: styled thead with gradient option ── */
export function DataTableHeader({
  children,
  className,
  gradient = false,
}: {
  children: React.ReactNode;
  className?: string;
  gradient?: boolean;
}) {
  return (
    <thead 
      className={cn(
        gradient 
          ? "bg-gradient-to-r from-primary/10 to-accent/10" 
          : "bg-muted/50",
        className
      )}
    >
      {children}
    </thead>
  );
}

/* ── DataTableRow: tr with hover + selection + animations ── */
export function DataTableRow({
  children,
  isSelected,
  className,
  animationDelay = 0,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { 
  isSelected?: boolean;
  /**
   * Animation delay in milliseconds for staggered entrance animations.
   * Use getStaggerDelay() from src/lib/animations.ts to calculate this value.
   * @example animationDelay={getStaggerDelay(index, 50)}
   */
  animationDelay?: number;
}) {
  return (
    <tr
      className={cn(
        "border-b transition-all duration-200 hover:bg-muted/30 hover:scale-[1.01] animate-fadeInUp",
        isSelected && "bg-accent/20",
        className
      )}
      style={{ animationDelay: `${animationDelay}ms` }}
      {...props}
    >
      {children}
    </tr>
  );
}

/* ── SortButton: reusable column sort trigger with rotation animations ── */
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
      className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground rounded px-1 whitespace-nowrap transition-all duration-150 hover:scale-105"
    >
      {label}
      <span className={cn(
        "transition-transform duration-300",
        isActive && direction === "desc" && "rotate-180"
      )}>
        {isActive ? (
          direction === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
        )}
      </span>
    </button>
  );
}

/* ── SelectionToolbar: "{n} selected" bar with slide-in animation ── */
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
    <div className="flex items-center justify-between rounded-lg border bg-accent/30 p-3 animate-fadeInUp backdrop-blur-sm">
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
