import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { BookOpen } from "lucide-react";
import { IconBox } from "./IconBox";

interface PageHeaderProps {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
  gradient?: boolean;
}

export function PageHeader({
  title = "Research Assistant",
  subtitle = "Citation-grounded evidence extraction",
  children,
  className,
  gradient = false,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "border-b border-border backdrop-blur-md sticky top-0 z-10 transition-all duration-300",
        gradient 
          ? "bg-gradient-to-r from-background/95 via-primary/5 to-background/95 shadow-lg" 
          : "bg-background/95",
        className
      )}
    >
      <div className="container max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 animate-fadeInUp">
            <IconBox icon={BookOpen} />
            <div>
              <h1 className="text-lg font-semibold text-foreground">{title}</h1>
              {subtitle && (
                <p className="text-xs text-muted-foreground">{subtitle}</p>
              )}
            </div>
          </div>
          {children && (
            <div className="flex items-center gap-3 animate-fadeInUp">{children}</div>
          )}
        </div>
      </div>
    </header>
  );
}
