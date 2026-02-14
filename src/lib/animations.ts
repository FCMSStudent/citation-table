// Re-export React for the hook
import * as React from 'react';

/**
 * Animation utilities for the vibrant UI
 * Provides stagger delays, entrance animations, and intersection observer hooks
 */

/**
 * Calculate stagger delay for list items
 * @param index - Index of the item in the list
 * @param baseDelay - Base delay in milliseconds (default: 50ms)
 * @param maxDelay - Maximum delay cap in milliseconds (default: 500ms)
 * @returns Delay in milliseconds
 */
export function getStaggerDelay(index: number, baseDelay = 50, maxDelay = 500): number {
  return Math.min(index * baseDelay, maxDelay);
}

/**
 * Create stagger style object for inline use
 * @param index - Index of the item in the list
 * @param baseDelay - Base delay in milliseconds (default: 50ms)
 * @returns Style object with animation delay
 */
export function staggerStyle(index: number, baseDelay = 50): React.CSSProperties {
  return {
    animationDelay: `${getStaggerDelay(index, baseDelay)}ms`,
  };
}

/**
 * Entrance animation class names
 */
export const entranceAnimations = {
  fadeInUp: 'animate-fadeInUp',
  scaleIn: 'animate-scaleIn',
  shimmer: 'animate-shimmer',
  pulseGlow: 'animate-pulse-glow',
  gradientShift: 'animate-gradient-shift',
} as const;

/**
 * Timing functions for consistent animations
 */
export const timings = {
  fast: 150,
  medium: 300,
  slow: 500,
} as const;

/**
 * Easing functions
 */
export const easings = {
  default: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  smooth: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
} as const;

/**
 * Create a CSS transition string
 * @param property - CSS property to transition
 * @param duration - Duration in milliseconds (default: medium)
 * @param easing - Easing function (default: default)
 * @returns CSS transition string
 */
export function createTransition(
  property: string,
  duration: number = timings.medium,
  easing: string = easings.default
): string {
  return `${property} ${duration}ms ${easing}`;
}

/**
 * Hook for intersection observer-based entrance animations
 * @param options - IntersectionObserver options
 * @returns Ref to attach to element and whether it's visible
 */
export function useIntersectionAnimation(options?: IntersectionObserverInit) {
  const [isVisible, setIsVisible] = React.useState(false);
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        // Optionally disconnect after first intersection
        observer.disconnect();
      }
    }, options);

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [options]);

  return { ref, isVisible };
}
