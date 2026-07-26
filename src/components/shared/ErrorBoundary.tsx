import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Friendly error card wrapping the whole app. Class component: only React
 * error boundary mechanism, must catch render errors below it in the tree. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SharpCut Studio crashed:', error, info.componentStack);
  }

  private handleStartOver = () => {
    useAppStore.getState().resetProject();
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
          <h1 className="text-xl font-extrabold text-ink">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">
            SharpCut Studio hit an unexpected error. Your video was never uploaded
            anywhere &mdash; it stayed on this device. Starting over will clear the
            current project.
          </p>
          <button
            type="button"
            onClick={this.handleStartOver}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Start over
          </button>
        </div>
      </div>
    );
  }
}
