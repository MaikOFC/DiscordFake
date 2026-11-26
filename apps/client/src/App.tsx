import { Component, type ErrorInfo, type ReactNode } from 'react';
import { NicknameScreen } from './components/NicknameScreen';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { useAppStore } from './store/useAppStore';

interface ErrorBoundaryState {
  errorMessage: string | null;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { errorMessage: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { errorMessage: error.message || 'Erro inesperado na interface.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erro capturado na interface:', error, info);
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#1e1f22] p-6 text-zinc-100">
          <div className="max-w-md rounded-xl border border-red-500/40 bg-[#2b2d31] p-6 text-center shadow-xl">
            <h1 className="text-lg font-bold text-white">
              Algo deu errado na tela
            </h1>
            <p className="mt-2 text-xs text-red-300">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Recarregar NexusVoice
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const connectionStatus = useAppStore((state) => state.connectionStatus);

  return (
    <ErrorBoundary>
      {connectionStatus === 'connected' ? (
        <WorkspaceLayout />
      ) : (
        <NicknameScreen />
      )}
    </ErrorBoundary>
  );
}
