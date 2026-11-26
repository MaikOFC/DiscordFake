import { useState, type FormEvent } from 'react';
import { createServer, joinServerByInvite } from '../services/socket';

interface ServerModalProps {
  initialMode?: 'create' | 'join';
  onClose: () => void;
}

export function ServerModal({
  initialMode = 'create',
  onClose,
}: ServerModalProps) {
  const [mode, setMode] = useState<'create' | 'join'>(initialMode);
  const [serverName, setServerName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const result =
      mode === 'create'
        ? await createServer(serverName)
        : await joinServerByInvite(inviteCode);

    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Não foi possível concluir a ação.');
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#2b2d31] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {mode === 'create' ? 'Criar servidor' : 'Entrar com convite'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-[#1e1f22] p-1">
          <button
            type="button"
            onClick={() => {
              setMode('create');
              setError(null);
            }}
            className={`cursor-pointer rounded-md py-1.5 text-xs font-semibold transition ${
              mode === 'create'
                ? 'bg-emerald-600 text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Criar novo
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('join');
              setError(null);
            }}
            className={`cursor-pointer rounded-md py-1.5 text-xs font-semibold transition ${
              mode === 'join'
                ? 'bg-emerald-600 text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Usar convite
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'create' ? (
            <div>
              <label
                htmlFor="server-name"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-300"
              >
                Nome do servidor
              </label>
              <input
                id="server-name"
                type="text"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="Ex: Sala dos Amigos"
                minLength={2}
                maxLength={50}
                required
                autoFocus
                className="w-full rounded-lg border border-zinc-700 bg-[#1e1f22] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-500"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Você será o dono e poderá criar e apagar canais.
              </p>
            </div>
          ) : (
            <div>
              <label
                htmlFor="invite-code"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-300"
              >
                Código do convite
              </label>
              <input
                id="invite-code"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="Ex: A3K9P2"
                required
                autoFocus
                className="w-full rounded-lg border border-zinc-700 bg-[#1e1f22] px-3 py-2 font-mono text-sm uppercase text-white placeholder-zinc-500 outline-none focus:border-emerald-500"
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {loading
                ? 'Aguarde...'
                : mode === 'create'
                  ? 'Criar servidor'
                  : 'Entrar no servidor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
