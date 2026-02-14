import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./tooltip";

interface ScoreBadgeProps {
  score: number;
  showTooltip?: boolean;
  className?: string;
}

function getScoreBadgeClass(score: number): string {
  if (score >= 2) {
    return "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200";
  }
  if (score <= 0) {
    return "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200";
  }
  return "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950 dark:text-blue-200";
}

export function ScoreBadge({
  score,
  showTooltip = true,
  className,
}: ScoreBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold",
        getScoreBadgeClass(score),
        className
      )}
    >
      Score: {score > 0 ? "+" : ""}
      {score}
      {showTooltip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex focus-ring rounded-full"
              aria-label="How relevance score is computed"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Score based on keyword match + study design weighting. No semantic
            inference.
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
