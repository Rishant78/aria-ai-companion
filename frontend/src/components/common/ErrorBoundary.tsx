import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface ErrorBoundaryProps {
  name?: string;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.name ?? 'App'}] Uncaught error:`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  public reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  public override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error, this.reset);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="companion-error-boundary" role="alert">
          <div className="companion-error-boundary__card">
            <h2 className="companion-error-boundary__title">
              {this.props.name ? `${this.props.name} Error` : 'Something went wrong'}
            </h2>
            <p className="companion-error-boundary__message">
              {import.meta.env.DEV
                ? this.state.error.message || 'An unexpected rendering error occurred.'
                : 'An unexpected rendering error occurred. Please try again.'}
            </p>
            <div className="companion-error-boundary__actions">
              <button
                type="button"
                className="companion-error-boundary__btn"
                onClick={this.reset}
              >
                Try Again
              </button>
              <button
                type="button"
                className="companion-error-boundary__btn companion-error-boundary__btn--secondary"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

