import * as React from "react";
import { cn } from "@/lib/utils";
import { BookOpen } from "lucide-react";
import { IconBox } from "./icon-box";

interface PageHeaderProps {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title = "Research Assistant",
  subtitle = "Citation-grounded evidence extraction",
  children,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "border-b border-border backdrop-blur-sm sticky top-0 z-10 bg-background/95",
        className
      )}
    >
      <div className="container max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox icon={BookOpen} />
            <div>
              <h1 className="text-lg font-semibold text-foreground">{title}</h1>
              {subtitle && (
                <p className="text-xs text-muted-foreground">{subtitle}</p>
              )}
            </div>
          </div>
          {children && (
            <div className="flex items-center gap-3">{children}</div>
          )}
        </div>
      </div>
    </header>
  );
}
