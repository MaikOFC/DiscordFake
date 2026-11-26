import { useState, type FormEvent } from 'react';
import { connectWithNickname } from '../services/socket';
import { useAppStore } from '../store/useAppStore';

export function NicknameScreen() {
  const savedNickname = useAppStore((state) => state.nickname);
  const userId = useAppStore((state) => state.userId);
  const connectionStatus = useAppStore((state) => state.connectionStatus);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const clearError = useAppStore((state) => state.clearError);

  const [inputNickname, setInputNickname] = useState(savedNickname);
  const isConnecting = connectionStatus === 'connecting';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    connectWithNickname(inputNickname);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1e1f22] px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#2b2d31] p-6 shadow-xl">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            NexusVoice
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Escolha como você quer aparecer para os outros participantes.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="nickname"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-300"
            >
              Nickname
            </label>
            <input
              id="nickname"
              type="text"
              value={inputNickname}
              onChange={(event) => {
                setInputNickname(event.target.value);
                if (errorMessage) {
                  clearError();
                }
              }}
              placeholder="Ex: Maik"
              minLength={2}
              maxLength={32}
              required
              autoFocus
              className="w-full rounded-lg border border-zinc-700 bg-[#1e1f22] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-500"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Entre 2 e 32 caracteres (salvo neste navegador).
            </p>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={isConnecting}
            className="w-full cursor-pointer rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConnecting ? 'Conectando...' : 'Entrar no NexusVoice'}
          </button>
        </form>

        <div className="mt-5 border-t border-zinc-700/70 pt-3 text-xs text-zinc-500">
          <span>ID único desta aba: </span>
          <code className="rounded bg-[#1e1f22] px-1.5 py-0.5 text-zinc-300">
            {userId}
          </code>
        </div>
      </div>
    </div>
  );
}
