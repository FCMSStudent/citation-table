import * as React from "react";
import { cn } from "@/shared/lib/utils";

interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageShell({ children, className, ...props }: PageShellProps) {
  return (
    <div className={cn("min-h-screen bg-background", className)} {...props}>
      {children}
    </div>
  );
}
