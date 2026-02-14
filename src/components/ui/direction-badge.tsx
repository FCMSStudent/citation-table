import * as React from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowLeftRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { EffectDirection } from "@/utils/effectDirection";

interface DirectionBadgeProps {
  direction: EffectDirection;
  variant?: "badge" | "icon";
}

const badgeConfig: Record<
  EffectDirection,
  {
    badgeIcon: React.ReactNode;
    iconOnly: React.ReactNode;
    label: string;
    badgeClass: string;
  }
> = {
  positive: {
    badgeIcon: <TrendingUp className="h-3.5 w-3.5" />,
    iconOnly: (
      <ArrowUp className="inline h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
    ),
    label: "Positive",
    badgeClass:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  },
  negative: {
    badgeIcon: <TrendingDown className="h-3.5 w-3.5" />,
    iconOnly: (
      <ArrowDown className="inline h-3.5 w-3.5 text-red-600 dark:text-red-400" />
    ),
    label: "Negative",
    badgeClass:
      "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  },
  neutral: {
    badgeIcon: <Minus className="h-3.5 w-3.5" />,
    iconOnly: (
      <Minus className="inline h-3.5 w-3.5 text-muted-foreground" />
    ),
    label: "Neutral",
    badgeClass: "bg-muted text-muted-foreground",
  },
  mixed: {
    badgeIcon: <ArrowLeftRight className="h-3.5 w-3.5" />,
    iconOnly: (
      <Minus className="inline h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
    ),
    label: "Mixed",
    badgeClass:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  },
};

export function DirectionBadge({
  direction,
  variant = "badge",
}: DirectionBadgeProps) {
  const config = badgeConfig[direction];

  if (variant === "icon") {
    return <span title={`${config.label} effect`}>{config.iconOnly}</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        config.badgeClass
      )}
    >
      {config.badgeIcon} {config.label}
    </span>
  );
}
