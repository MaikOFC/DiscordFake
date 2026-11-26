import { useState, type FormEvent } from 'react';
import type { ChannelType } from '@nexusvoice/shared';
import { createChannel } from '../services/socket';

interface ChannelModalProps {
  serverId: string;
  initialType: ChannelType;
  onClose: () => void;
}

export function ChannelModal({ serverId, initialType, onClose }: ChannelModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ChannelType>(initialType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const result = await createChannel(serverId, name, type);

    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Não foi possível criar o canal.');
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#2b2d31] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Criar canal</h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-white"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType('text')}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-left text-xs transition ${
                type === 'text'
                  ? 'border-emerald-500 bg-emerald-500/10 text-white'
                  : 'border-zinc-700 bg-[#1e1f22] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="font-semibold"># Texto</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">Mensagens e histórico</div>
            </button>
            <button
              type="button"
              onClick={() => setType('voice')}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-left text-xs transition ${
                type === 'voice'
                  ? 'border-emerald-500 bg-emerald-500/10 text-white'
                  : 'border-zinc-700 bg-[#1e1f22] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="font-semibold">🔊 Voz</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">Áudio, câmera e tela</div>
            </button>
          </div>

          <div>
            <label
              htmlFor="channel-name"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-300"
            >
              Nome do canal
            </label>
            <input
              id="channel-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'text' ? 'Ex: avisos' : 'Ex: Jogatina'}
              minLength={1}
              maxLength={32}
              required
              autoFocus
              className="w-full rounded-lg border border-zinc-700 bg-[#1e1f22] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-500"
            />
          </div>

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
              {loading ? 'Criando...' : 'Criar canal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
