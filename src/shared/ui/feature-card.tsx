import * as React from "react";
import { cn } from "@/shared/lib/utils";
import type { LucideIcon } from "lucide-react";
import { IconBox } from "./icon-box";

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  iconClassName?: string;
  className?: string;
}

export function FeatureCard({
  icon,
  title,
  description,
  iconClassName,
  className,
}: FeatureCardProps) {
  return (
    <div className={cn("p-4 rounded-lg bg-card border border-border", className)}>
      <IconBox icon={icon} size="md" className={cn("w-fit mb-2", iconClassName)} />
      <h3 className="font-medium text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
