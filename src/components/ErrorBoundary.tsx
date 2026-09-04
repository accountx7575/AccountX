import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-secondary-50 dark:bg-secondary-950 p-6">
          <div className="card max-w-md w-full p-8 text-center">
            <div className="rounded-full bg-error-50 dark:bg-error-900/20 p-4 w-fit mx-auto mb-4">
              <span className="block h-8 w-8 rounded-full bg-error-500" />
            </div>
            <h1 className="text-lg font-semibold text-secondary-900 dark:text-secondary-100 mb-2">Something went wrong</h1>
            <p className="text-sm text-secondary-500 dark:text-secondary-400 mb-6">
              An unexpected error occurred while rendering the app.
              {this.state.error?.message && <> Details: <span className="font-mono text-xs">{this.state.error.message}</span></>}
            </p>
            <Button onClick={() => window.location.reload()}>Reload App</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
