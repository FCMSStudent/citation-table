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
      "bg-gradient-to-r from-emerald-100 to-emerald-50 text-emerald-800 dark:from-emerald-900/50 dark:to-emerald-800/50 dark:text-emerald-300 transition-all duration-300 hover:shadow-md hover:scale-105",
  },
  negative: {
    badgeIcon: <TrendingDown className="h-3.5 w-3.5" />,
    iconOnly: (
      <ArrowDown className="inline h-3.5 w-3.5 text-red-600 dark:text-red-400" />
    ),
    label: "Negative",
    badgeClass:
      "bg-gradient-to-r from-red-100 to-red-50 text-red-800 dark:from-red-900/50 dark:to-red-800/50 dark:text-red-300 transition-all duration-300 hover:shadow-md hover:scale-105",
  },
  neutral: {
    badgeIcon: <Minus className="h-3.5 w-3.5" />,
    iconOnly: (
      <Minus className="inline h-3.5 w-3.5 text-muted-foreground" />
    ),
    label: "Neutral",
    badgeClass: "bg-gradient-to-r from-muted to-muted/80 text-muted-foreground transition-all duration-300 hover:shadow-md hover:scale-105",
  },
  mixed: {
    badgeIcon: <ArrowLeftRight className="h-3.5 w-3.5" />,
    iconOnly: (
      <Minus className="inline h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
    ),
    label: "Mixed",
    badgeClass:
      "bg-gradient-to-r from-amber-100 to-amber-50 text-amber-800 dark:from-amber-900/50 dark:to-amber-800/50 dark:text-amber-300 transition-all duration-300 hover:shadow-md hover:scale-105",
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
