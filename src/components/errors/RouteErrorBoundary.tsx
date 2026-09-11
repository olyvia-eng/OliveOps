import { Component, type ReactNode } from 'react';
import { Leaf, RefreshCw, RotateCcw } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button } from '../ui';
import { getSessionStorage, handleClientError, isChunkLoadError } from '../../errors/routeErrorRecovery.js';

interface BoundaryProps {
  children: ReactNode;
  route: string;
}

interface BoundaryState {
  error: unknown | null;
}

class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    handleClientError({
      error,
      route: this.props.route,
      source: 'react-boundary',
      storage: getSessionStorage(),
      reload: () => window.location.reload(),
    });
  }

  private tryAgain = () => {
    if (isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-cream px-5 py-12 dark:bg-brand-900">
        <div className="w-full max-w-md text-center" role="alert">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-700 text-white shadow-sm">
            <Leaf aria-hidden="true" size={24} />
          </div>
          <p className="mt-4 text-sm font-semibold text-brand-700 dark:text-brand-200">OliveOps</p>
          <h1 className="mt-2 text-2xl font-semibold text-brand-900 dark:text-brand-50">Something went wrong</h1>
          <p className="mt-2 text-sm leading-6 text-brand-500 dark:text-brand-200">We couldn't load this page.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={this.tryAgain}>
              <RotateCcw aria-hidden="true" />
              Try Again
            </Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden="true" />
              Reload OliveOps
            </Button>
          </div>
        </div>
      </main>
    );
  }
}

export default function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <AppErrorBoundary key={location.pathname} route={location.pathname}>
      {children}
    </AppErrorBoundary>
  );
}