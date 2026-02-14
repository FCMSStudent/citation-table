import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface IconBoxProps {
  icon: LucideIcon;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "p-1.5",
  md: "p-2",
  lg: "p-3",
} as const;

const iconSizeClasses = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
} as const;

export function IconBox({ icon: Icon, size = "md", className }: IconBoxProps) {
  return (
    <div
      className={cn(
        "rounded-lg bg-primary/10",
        sizeClasses[size],
        className
      )}
    >
      <Icon className={cn("text-primary", iconSizeClasses[size])} />
    </div>
  );
}
