import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui/Button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Boundary caught error:', error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, errorMessage: '' });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{this.props.title || 'Something went wrong'}</p>
            <p className="mt-1 text-sm text-muted-foreground">{this.state.errorMessage}</p>
            <Button type="button" size="sm" variant="outline" className="mt-3 gap-2" onClick={this.reset}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
