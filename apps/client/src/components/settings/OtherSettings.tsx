import { useEffect, useState } from 'react';
import {
  cancelKeyCapture,
  captureGlobalKey,
  getAppVersion,
  getAutostart,
  getCurrentGame,
  isDesktop,
  setAutostart,
  showNotification,
} from '../../lib/desktop';
import { checkForUpdates } from '../../services/updates';
import { useAppStore } from '../../store/useAppStore';
import { useSettings, type CustomGame, type HotkeyBinding } from '../../store/useSettings';
import { RadioGroup, Section, Toggle, buttonClass, inputClass, secondaryButtonClass } from './SettingsControls';

function KeyBinder({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: HotkeyBinding | null;
  onChange: (value: HotkeyBinding | null) => void;
}) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => () => cancelKeyCapture(), []);

  async function capture(): Promise<void> {
    setCapturing(true);
    const binding = await captureGlobalKey();
    setCapturing(false);
    if (binding) onChange(binding);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[#2b2d31] px-3 py-2.5">
      <div>
        <div className="text-sm text-zinc-100">{label}</div>
        <div className="text-xs text-zinc-400">{description}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void capture()}
          className={`min-w-28 cursor-pointer rounded-md border px-3 py-1.5 font-mono text-xs ${
            capturing
              ? 'animate-pulse border-emerald-500 text-emerald-300'
              : 'border-zinc-600 bg-[#1e1f22] text-zinc-100 hover:border-zinc-400'
          }`}
        >
          {capturing ? 'Aperte a tecla...' : (value?.name ?? 'Nenhum')}
        </button>
        {value && !capturing && (
          <button type="button" onClick={() => onChange(null)} className={secondaryButtonClass} title="Tirar atalho">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export function KeySettings() {
  const settings = useSettings();
  return (
    <div>
      <Section
        title="Atalhos"
        hint={
          isDesktop
            ? 'No app, os atalhos funcionam mesmo com um jogo em foco. Vale tecla do teclado ou os botões laterais do mouse. Esc cancela a escolha.'
            : 'No navegador, os atalhos só funcionam com a aba do NexusVoice em foco. No app de desktop eles funcionam em qualquer programa.'
        }
      >
        <KeyBinder
          label="Apertar para falar"
          description={
            settings.voiceMode === 'ptt'
              ? 'Segure para transmitir.'
              : 'Só vale com o modo push-to-talk ligado (aba Voz e áudio).'
          }
          value={settings.pttKey}
          onChange={(v) => settings.update({ pttKey: v })}
        />
        <KeyBinder
          label="Mutar ou desmutar"
          description="Liga e desliga o microfone."
          value={settings.muteKey}
          onChange={(v) => settings.update({ muteKey: v })}
        />
        <KeyBinder
          label="Ensurdecer"
          description="Para de ouvir e de falar."
          value={settings.deafenKey}
          onChange={(v) => settings.update({ deafenKey: v })}
        />
      </Section>
    </div>
  );
}

export function GeneralSettings() {
  const settings = useSettings();
  return (
    <div>
      <Section title="Notificações" hint="Aparecem quando o NexusVoice não está em foco.">
        <RadioGroup
          value={settings.notifications}
          onChange={(v) => settings.update({ notifications: v })}
          options={[
            { value: 'mentions', label: 'Só quando me marcarem com @' },
            { value: 'all', label: 'Todas as mensagens' },
            { value: 'off', label: 'Nenhuma' },
          ]}
        />
        <button
          type="button"
          onClick={() => void showNotification('NexusVoice', 'As notificações estão funcionando!')}
          className={secondaryButtonClass}
        >
          Mandar notificação de teste
        </button>
      </Section>

      <Section title="Aparência">
        <RadioGroup
          value={settings.animateAvatars}
          onChange={(v) => settings.update({ animateAvatars: v })}
          options={[
            {
              value: 'hover',
              label: 'Animar avatares ao passar o mouse',
              description: 'Economiza processamento quando tem muita gente com GIF.',
            },
            { value: 'always', label: 'Sempre animar avatares' },
          ]}
        />
      </Section>
    </div>
  );
}

function CustomGamesEditor() {
  const games = useSettings((s) => s.customGames);
  const update = useSettings((s) => s.update);
  const [exe, setExe] = useState('');
  const [name, setName] = useState('');

  function add(): void {
    const cleanExe = exe.trim().toLowerCase();
    const cleanName = name.trim();
    if (!cleanExe || !cleanName) return;
    const next: CustomGame[] = [
      ...games.filter((g) => g.exe !== cleanExe),
      { exe: cleanExe.endsWith('.exe') ? cleanExe : `${cleanExe}.exe`, name: cleanName },
    ];
    update({ customGames: next.slice(0, 50) });
    setExe('');
    setName('');
  }

  return (
    <div className="rounded-lg bg-[#2b2d31] p-3">
      <div className="mb-2 text-sm text-zinc-100">Jogos que eu adicionei</div>
      {games.length === 0 && <p className="mb-2 text-xs text-zinc-500">Nenhum ainda.</p>}
      <ul className="mb-2 space-y-1">
        {games.map((game) => (
          <li key={game.exe} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-zinc-200">
              {game.name} <span className="font-mono text-zinc-500">({game.exe})</span>
            </span>
            <button
              type="button"
              onClick={() => update({ customGames: games.filter((g) => g.exe !== game.exe) })}
              className="cursor-pointer text-zinc-400 hover:text-red-300"
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <input
          value={exe}
          onChange={(e) => setExe(e.target.value)}
          placeholder="Executável (ex: jogo.exe)"
          className={`${inputClass} flex-1 font-mono`}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome que aparece"
          className={`${inputClass} flex-1`}
        />
        <button type="button" onClick={add} className={buttonClass}>
          Adicionar
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        O nome do executável aparece no Gerenciador de Tarefas, aba Detalhes.
      </p>
    </div>
  );
}

export function AppSettings() {
  const settings = useSettings();
  const gameActivity = useAppStore((s) => s.gameActivity);
  const updateInfo = useAppStore((s) => s.updateInfo);
  const [autostart, setAutostartState] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);

  useEffect(() => {
    void getAutostart().then(setAutostartState);
    void getAppVersion().then(setVersion);
    void getCurrentGame().then(setDetected);
  }, []);

  if (!isDesktop) {
    return (
      <p className="text-sm text-zinc-400">
        Estas opções só existem no app de desktop do NexusVoice (ícone na bandeja, iniciar com o Windows, detecção de
        jogos e atualizações).
      </p>
    );
  }

  async function handleCheck(): Promise<void> {
    setChecking(true);
    const info = await checkForUpdates(true);
    setChecking(false);
    setCheckResult(info ? `Versão ${info.version} disponível!` : 'Você já está na versão mais nova.');
  }

  return (
    <div>
      <Section title="Janela">
        <Toggle
          label="Fechar para a bandeja"
          description="O X esconde o app perto do relógio e a chamada continua. Para sair de vez, use o ícone da bandeja."
          checked={settings.closeToTray}
          onChange={(v) => settings.update({ closeToTray: v })}
        />
        <Toggle
          label="Iniciar com o Windows"
          description="Abre escondido na bandeja quando o computador liga."
          checked={autostart}
          onChange={(v) => {
            setAutostartState(v);
            void setAutostart(v);
          }}
        />
      </Section>

      <Section title="Jogos" hint="Mostra para os outros o jogo que você está jogando. Só o nome do jogo sai do seu PC.">
        <Toggle
          label="Mostrar o jogo que estou jogando"
          checked={settings.gameDetection}
          onChange={(v) => settings.update({ gameDetection: v })}
        />
        {settings.gameDetection && (
          <p className="text-xs text-zinc-400">
            Agora: {gameActivity ?? detected ?? 'nenhum jogo detectado'}
          </p>
        )}
        <CustomGamesEditor />
      </Section>

      <Section title="Atualizações">
        <Toggle
          label="Procurar versões novas ao abrir"
          checked={settings.checkUpdates}
          onChange={(v) => settings.update({ checkUpdates: v })}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span>Versão instalada: {version ?? '?'}</span>
          <button type="button" disabled={checking} onClick={() => void handleCheck()} className={secondaryButtonClass}>
            {checking ? 'Procurando...' : 'Procurar agora'}
          </button>
          {checkResult && <span>{checkResult}</span>}
          {updateInfo && !checkResult && <span>Versão {updateInfo.version} disponível.</span>}
        </div>
      </Section>
    </div>
  );
}
