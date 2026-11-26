import { useState, type FormEvent } from 'react';
import { LIMITS } from '@nexusvoice/shared';
import { checkServer } from '../lib/api';
import { getServerUrl, normalizeServerUrl } from '../lib/config';
import { isDesktop } from '../lib/desktop';
import { signIn } from '../services/socket';
import { useAppStore } from '../store/useAppStore';

const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-[#1e1f22] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-500';
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-300';

export function AuthScreen() {
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const storeError = useAppStore((s) => s.errorMessage);
  const setStoreError = useAppStore((s) => s.setError);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [serverInput, setServerInput] = useState(getServerUrl());
  const [editingServer, setEditingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownError = error ?? storeError;
  const isConnecting = busy || connectionStatus === 'connecting';

  async function handleTestServer(): Promise<void> {
    const url = normalizeServerUrl(serverInput);
    if (!url) {
      setServerStatus({ ok: false, text: 'Endereço inválido.' });
      return;
    }
    setServerInput(url);
    setServerStatus({ ok: true, text: 'Testando...' });
    const result = await checkServer(url);
    setServerStatus(
      result.ok
        ? { ok: true, text: 'Servidor encontrado!' }
        : { ok: false, text: result.error ?? 'Falhou.' },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStoreError(null);

    const serverUrl = normalizeServerUrl(serverInput);
    if (!serverUrl) {
      setError('O endereço do servidor é inválido.');
      setEditingServer(true);
      return;
    }
    if (mode === 'register' && password !== passwordAgain) {
      setError('As duas senhas não são iguais.');
      return;
    }

    setBusy(true);
    const health = await checkServer(serverUrl);
    if (!health.ok) {
      setBusy(false);
      setError(health.error ?? 'Servidor não encontrado.');
      setEditingServer(true);
      return;
    }
    const result = await signIn(serverUrl, mode, username, password, displayName || username);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Não foi possível entrar.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1e1f22] px-4 py-8">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#2b2d31] p-6 shadow-xl">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-white">NexusVoice</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {mode === 'login' ? 'Entre na sua conta.' : 'Crie sua conta neste servidor.'}
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-[#1e1f22] p-1">
          {(['login', 'register'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMode(item);
                setError(null);
              }}
              className={`cursor-pointer rounded-md py-1.5 text-xs font-semibold transition ${
                mode === item ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {item === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="username" className={labelClass}>
              Nome de usuário
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ex: maik_ofc"
              minLength={mode === 'register' ? LIMITS.usernameMin : 1}
              maxLength={LIMITS.usernameMax}
              autoComplete="username"
              required
              autoFocus
              className={inputClass}
            />
            {mode === 'register' && (
              <p className="mt-1 text-xs text-zinc-500">
                Letras sem acento, números, ponto e sublinhado. É o que os outros usam para te
                marcar com @.
              </p>
            )}
          </div>

          {mode === 'register' && (
            <div>
              <label htmlFor="display-name" className={labelClass}>
                Nome de exibição
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Como você aparece para os outros"
                maxLength={LIMITS.displayNameMax}
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label htmlFor="password" className={labelClass}>
              Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === 'register' ? LIMITS.passwordMin : 1}
              maxLength={LIMITS.passwordMax}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              className={inputClass}
            />
          </div>

          {mode === 'register' && (
            <div>
              <label htmlFor="password-again" className={labelClass}>
                Repita a senha
              </label>
              <input
                id="password-again"
                type="password"
                value={passwordAgain}
                onChange={(e) => setPasswordAgain(e.target.value)}
                minLength={LIMITS.passwordMin}
                maxLength={LIMITS.passwordMax}
                autoComplete="new-password"
                required
                className={inputClass}
              />
              <p className="mt-1 text-xs text-zinc-500">
                Pelo menos {LIMITS.passwordMin} caracteres.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-zinc-700/70 bg-[#1e1f22] p-3">
            {!editingServer ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-zinc-400">
                  Servidor: <span className="font-mono text-zinc-200">{serverInput}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setEditingServer(true)}
                  className="shrink-0 cursor-pointer rounded bg-zinc-700 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-600"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="server-url" className={labelClass}>
                  Endereço do servidor
                </label>
                <div className="flex gap-2">
                  <input
                    id="server-url"
                    type="text"
                    value={serverInput}
                    onChange={(e) => {
                      setServerInput(e.target.value);
                      setServerStatus(null);
                    }}
                    placeholder="ex: 26.49.143.245"
                    className={`${inputClass} font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => void handleTestServer()}
                    className="shrink-0 cursor-pointer rounded-lg bg-zinc-700 px-3 text-xs font-medium text-zinc-100 hover:bg-zinc-600"
                  >
                    Testar
                  </button>
                </div>
                {serverStatus && (
                  <p className={`text-xs ${serverStatus.ok ? 'text-emerald-400' : 'text-red-300'}`}>
                    {serverStatus.text}
                  </p>
                )}
                <p className="text-xs text-zinc-500">
                  Use o IP do Radmin de quem hospeda (a porta 3001 entra sozinha). No PC do
                  servidor, use localhost.
                </p>
              </div>
            )}
          </div>

          {shownError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {shownError}
            </div>
          )}

          <button
            type="submit"
            disabled={isConnecting}
            className="w-full cursor-pointer rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConnecting ? 'Conectando...' : mode === 'login' ? 'Entrar' : 'Criar conta e entrar'}
          </button>
        </form>

        {!isDesktop && (
          <p className="mt-4 text-center text-[11px] text-zinc-500">
            Pelo navegador, microfone e câmera só funcionam em localhost ou HTTPS. Para usar pela
            rede, prefira o app do NexusVoice.
          </p>
        )}
      </div>
    </div>
  );
}
