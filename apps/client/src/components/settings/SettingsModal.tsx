import { useEffect, useState } from 'react';
import { isCapturingKey, isDesktop } from '../../lib/desktop';
import { useAppStore } from '../../store/useAppStore';
import { AccountSettings } from './AccountSettings';
import { AppSettings, GeneralSettings, KeySettings } from './OtherSettings';
import { VoiceSettings } from './VoiceSettings';

type Tab = 'account' | 'voice' | 'keys' | 'general' | 'app';

const TABS: Array<{ id: Tab; label: string; desktopOnly?: boolean }> = [
  { id: 'account', label: 'Minha conta' },
  { id: 'voice', label: 'Voz e áudio' },
  { id: 'keys', label: 'Atalhos' },
  { id: 'general', label: 'Notificações e aparência' },
  { id: 'app', label: 'Programa', desktopOnly: true },
];

export function SettingsModal() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<Tab>('account');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !isCapturingKey()) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-[#313338]">
      <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-zinc-800 bg-[#2b2d31] p-3 pt-10">
        <div className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
          Configurações
        </div>
        {TABS.filter((t) => !t.desktopOnly || isDesktop).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`cursor-pointer rounded-md px-2 py-1.5 text-left text-sm ${
              tab === t.id ? 'bg-zinc-700/80 text-white' : 'text-zinc-300 hover:bg-zinc-700/40'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 pt-10 pb-16">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">
              {TABS.find((t) => t.id === tab)?.label}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-full border border-zinc-600 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              title="Fechar (Esc)"
            >
              ✕ Esc
            </button>
          </div>
          {tab === 'account' && <AccountSettings />}
          {tab === 'voice' && <VoiceSettings />}
          {tab === 'keys' && <KeySettings />}
          {tab === 'general' && <GeneralSettings />}
          {tab === 'app' && <AppSettings />}
        </div>
      </div>
    </div>
  );
}
