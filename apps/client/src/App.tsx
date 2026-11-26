import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { useAppIntegration } from './hooks/useAppIntegration';
import { getServerUrl } from './lib/config';
import { cancelConnection, resumeSession } from './services/socket';
import { useAppStore } from './store/useAppStore';

interface ErrorBoundaryState {
  errorMessage: string | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
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
            <h1 className="text-lg font-bold text-white">Algo deu errado na tela</h1>
            <p className="mt-2 text-xs text-red-300">{this.state.errorMessage}</p>
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

/** Tela de espera enquanto o app abre já logado e conecta no servidor. */
function ConnectingScreen() {
  const errorMessage = useAppStore((s) => s.errorMessage);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1e1f22] px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-zinc-700 border-t-emerald-500" />
        <p className="mt-4 text-sm text-zinc-200">Conectando em {getServerUrl()}...</p>
        {errorMessage && <p className="mt-2 text-xs text-amber-300">{errorMessage}</p>}
        <button
          type="button"
          onClick={cancelConnection}
          className="mt-5 cursor-pointer rounded-lg bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600"
        >
          Usar outra conta ou servidor
        </button>
      </div>
    </div>
  );
}

function AppContent() {
  useAppIntegration();
  const me = useAppStore((s) => s.me);
  const connectionStatus = useAppStore((s) => s.connectionStatus);

  useEffect(() => {
    resumeSession();
  }, []);

  if (me) return <WorkspaceLayout />;
  if (connectionStatus === 'connecting') return <ConnectingScreen />;
  return <AuthScreen />;
}

export function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
