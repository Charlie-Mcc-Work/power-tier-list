import { Component, type ReactNode } from 'react';
import { log } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    log.error('react', `Uncaught error: ${error.message}`, {
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center p-8">
          <div className="max-w-lg bg-[#1a1a1a] border border-red-600/50 rounded-xl p-6 space-y-4">
            <h1 className="text-lg font-medium text-red-400">Something went wrong</h1>
            <p className="text-sm text-gray-400">{this.state.error.message}</p>
            <pre className="text-[10px] text-gray-600 bg-[#141414] p-3 rounded overflow-auto max-h-40">
              {this.state.error.stack}
            </pre>
            <div className="flex gap-3">
              <button
                onClick={() => this.setState({ error: null })}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={async () => {
                  const session = log.getEntries();
                  const history = await log.getHistory();
                  const all = [...history, ...session];
                  all.sort((a, b) => a.timestamp - b.timestamp);
                  await navigator.clipboard.writeText(log.format(all));
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
              >
                Copy Log
              </button>
            </div>
            <p className="text-[10px] text-gray-600">
              You can also open the browser console and run <code className="text-gray-400">appLog.getEntries()</code> to see the full log.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
