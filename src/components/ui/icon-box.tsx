import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface IconBoxProps {
  icon: LucideIcon;
  size?: "sm" | "md" | "lg";
  className?: string;
  gradient?: boolean;
  pulse?: boolean;
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

export function IconBox({ 
  icon: Icon, 
  size = "md", 
  className,
  gradient = false,
  pulse = false,
}: IconBoxProps) {
  return (
    <div
      className={cn(
        "rounded-lg transition-all duration-300",
        gradient 
          ? "bg-gradient-primary text-white shadow-md hover:shadow-lg" 
          : "bg-primary/10 hover:bg-primary/20",
        pulse && "hover:animate-pulse-glow",
        sizeClasses[size],
        className
      )}
    >
      <Icon className={cn(
        gradient ? "text-white" : "text-primary", 
        iconSizeClasses[size]
      )} />
    </div>
  );
}
