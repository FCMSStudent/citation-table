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
    return "bg-gradient-to-r from-emerald-100 to-emerald-50 text-emerald-900 border-emerald-300 dark:from-emerald-950 dark:to-emerald-900 dark:text-emerald-200 transition-all duration-300 hover:shadow-md hover:scale-105";
  }
  if (score <= 0) {
    return "bg-gradient-to-r from-amber-100 to-amber-50 text-amber-900 border-amber-300 dark:from-amber-950 dark:to-amber-900 dark:text-amber-200 transition-all duration-300 hover:shadow-md hover:scale-105";
  }
  return "bg-gradient-to-r from-blue-100 to-blue-50 text-blue-900 border-blue-300 dark:from-blue-950 dark:to-blue-900 dark:text-blue-200 transition-all duration-300 hover:shadow-md hover:scale-105";
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
