import * as React from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const gradientTextVariants = cva(
  "bg-clip-text text-transparent font-semibold",
  {
    variants: {
      gradient: {
        primary: "bg-gradient-to-r from-[hsl(250,70%,65%)] to-[hsl(280,50%,55%)]",
        accent: "bg-gradient-to-r from-[hsl(340,90%,75%)] to-[hsl(0,75%,65%)]",
        success: "bg-gradient-to-r from-[hsl(200,90%,60%)] to-[hsl(185,100%,50%)]",
        warm: "bg-gradient-to-r from-[hsl(340,90%,70%)] to-[hsl(50,95%,60%)]",
        cool: "bg-gradient-to-r from-[hsl(185,70%,50%)] to-[hsl(260,60%,30%)]",
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
  /**
   * The HTML element to render as.
   * Use semantic HTML: h1-h3 for headings, span for inline text, p for paragraphs.
   * Avoid nesting heading elements or using headings inappropriately.
   */
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
