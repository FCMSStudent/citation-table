import * as React from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const gradientTextVariants = cva(
  "bg-clip-text text-transparent font-semibold",
  {
    variants: {
      gradient: {
        primary: "bg-gradient-to-r from-[#667eea] to-[#764ba2]",
        accent: "bg-gradient-to-r from-[#f093fb] to-[#f5576c]",
        success: "bg-gradient-to-r from-[#4facfe] to-[#00f2fe]",
        warm: "bg-gradient-to-r from-[#fa709a] to-[#fee140]",
        cool: "bg-gradient-to-r from-[#30cfd0] to-[#330867]",
      },
      animated: {
        true: "bg-[length:200%_auto] animate-gradient-shift",
        false: "",
      },
    },
    defaultVariants: {
      gradient: "primary",
      animated: false,
    },
  }
);

interface GradientTextProps 
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof gradientTextVariants> {
  as?: "h1" | "h2" | "h3" | "span" | "p";
  children: React.ReactNode;
}

export function GradientText({
  as: Component = "span",
  children,
  className,
  gradient,
  animated,
  ...props
}: GradientTextProps) {
  return (
    <Component
      className={cn(gradientTextVariants({ gradient, animated }), className)}
      {...props}
    >
      {children}
    </Component>
  );
}
