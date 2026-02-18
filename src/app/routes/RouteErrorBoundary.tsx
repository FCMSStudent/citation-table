import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary title="Route crashed">{children}</ErrorBoundary>;
}
