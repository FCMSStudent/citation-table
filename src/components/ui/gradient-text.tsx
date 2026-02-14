import * as React from "react";
import { cn } from "@/lib/utils";

interface GradientTextProps extends React.HTMLAttributes<HTMLElement> {
  as?: "h1" | "h2" | "h3" | "span";
  children: React.ReactNode;
}

export function GradientText({
  as: Component = "span",
  children,
  className,
  ...props
}: GradientTextProps) {
  return (
    <Component
      className={cn(
        "bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent",
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
