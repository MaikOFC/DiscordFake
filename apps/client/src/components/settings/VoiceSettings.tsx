import { useEffect, useRef, useState } from 'react';
import { playSound } from '../../lib/sounds';
import {
  buildVoiceGraph,
  destroyVoiceGraph,
  getVoiceAudioContext,
  readLevelDb,
} from '../../services/audioProcessor';
import {
  applyVoiceSettings,
  getCallMicLevelDb,
  isInCall,
  refreshAudioDevices,
  selectAudioInputDevice,
  selectAudioOutputDevice,
} from '../../services/voice';
import { useAppStore } from '../../store/useAppStore';
import { useSettings, type Settings } from '../../store/useSettings';
import { RadioGroup, Section, Slider, Toggle, secondaryButtonClass } from './SettingsControls';

const METER_MIN_DB = -70;

function dbToPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db - METER_MIN_DB) / -METER_MIN_DB) * 100));
}

/** Medidor do microfone. Na chamada usa o áudio da própria chamada; fora dela abre um teste. */
function MicMeter() {
  const gateEnabled = useSettings((s) => s.gateEnabled);
  const threshold = useSettings((s) => s.gateThresholdDb);
  const selectedInput = useAppStore((s) => s.selectedAudioInputId);
  const [level, setLevel] = useState(-100);
  const [testing, setTesting] = useState(false);
  const [hearMyself, setHearMyself] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voiceConnected = useAppStore((s) => s.voiceStatus === 'connected');
  const noiseSuppression = useSettings((s) => s.noiseSuppression);
  const inputGain = useSettings((s) => s.inputGain);
  const inCall = voiceConnected && isInCall();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (inCall) {
      const timer = setInterval(() => setLevel(getCallMicLevelDb() ?? -100), 60);
      return () => clearInterval(timer);
    }
    if (!testing) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let graph: Awaited<ReturnType<typeof buildVoiceGraph>> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const buffer = new Float32Array(1024);
    const settings = useSettings.getState();

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedInput ? { exact: selectedInput } : undefined,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression === 'browser',
            autoGainControl: settings.autoGainControl,
          },
        });
        if (cancelled) return;
        const ctx = getVoiceAudioContext();
        await ctx.resume();
        graph = await buildVoiceGraph(ctx, stream.getAudioTracks()[0]!);
        if (cancelled) return;
        if (audioRef.current) {
          audioRef.current.srcObject = graph.destination.stream;
        }
        const analyser = graph.analyser;
        timer = setInterval(() => setLevel(readLevelDb(analyser, buffer)), 60);
        void refreshAudioDevices();
      } catch {
        setError(
          'Não foi possível abrir o microfone. Confira a permissão e se outro programa está usando.',
        );
        setTesting(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      destroyVoiceGraph(graph);
      stream?.getTracks().forEach((t) => t.stop());
      setLevel(-100);
    };
    // Reabre o teste quando o microfone ou o processamento mudam.
  }, [inCall, testing, selectedInput, gateEnabled, threshold, noiseSuppression, inputGain]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = !hearMyself;
  }, [hearMyself]);

  const open = !gateEnabled || level >= threshold;
  return (
    <div className="rounded-lg bg-[#2b2d31] px-3 py-3">
      <div className="relative h-3 overflow-hidden rounded-full bg-zinc-700">
        <div
          className={`h-full transition-[width] duration-75 ${open ? 'bg-emerald-500' : 'bg-zinc-500'}`}
          style={{ width: `${dbToPercent(level)}%` }}
        />
        {gateEnabled && (
          <div
            className="absolute top-0 h-full w-0.5 bg-amber-300"
            style={{ left: `${dbToPercent(threshold)}%` }}
            title="Sensibilidade"
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        {inCall ? (
          <span>Mostrando o seu microfone na chamada.</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setTesting((v) => !v)}
              className={secondaryButtonClass}
            >
              {testing ? 'Parar teste' : 'Testar microfone'}
            </button>
            {testing && (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={hearMyself}
                  onChange={(e) => setHearMyself(e.target.checked)}
                  className="accent-emerald-500"
                />
                Ouvir meu microfone (use fone)
              </label>
            )}
          </>
        )}
        {gateEnabled && <span>A barra fica verde quando o som passa da linha amarela.</span>}
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      <audio ref={audioRef} autoPlay muted className="hidden" />
    </div>
  );
}

export function VoiceSettings() {
  const settings = useSettings();
  const audioInputDevices = useAppStore((s) => s.audioInputDevices);
  const audioOutputDevices = useAppStore((s) => s.audioOutputDevices);
  const selectedAudioInputId = useAppStore((s) => s.selectedAudioInputId);
  const selectedAudioOutputId = useAppStore((s) => s.selectedAudioOutputId);

  useEffect(() => {
    void refreshAudioDevices();
  }, []);

  /** Salva e, se estiver em chamada, aplica na hora. */
  function change(patch: Partial<Settings>, rebuild: boolean): void {
    settings.update(patch);
    void applyVoiceSettings({ rebuildProcessor: rebuild });
  }

  const selectClass =
    'w-full rounded-lg border border-zinc-700 bg-[#1e1f22] px-2 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500';

  return (
    <div>
      <Section title="Dispositivos">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-zinc-400">
            Microfone
            <select
              value={selectedAudioInputId}
              onChange={(e) => void selectAudioInputDevice(e.target.value)}
              className={`${selectClass} mt-1`}
            >
              <option value="">Padrão do sistema</option>
              {audioInputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            Saída de áudio
            <select
              value={selectedAudioOutputId}
              onChange={(e) => void selectAudioOutputDevice(e.target.value)}
              className={`${selectClass} mt-1`}
            >
              <option value="">Padrão do sistema</option>
              {audioOutputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <MicMeter />
        <Slider
          label="Volume do microfone"
          value={settings.inputGain}
          min={0}
          max={200}
          step={5}
          suffix="%"
          onChange={(v) => change({ inputGain: v }, false)}
        />
      </Section>

      <Section title="Modo de fala">
        <RadioGroup
          value={settings.voiceMode}
          onChange={(v) => change({ voiceMode: v }, false)}
          options={[
            {
              value: 'voice',
              label: 'Detecção de voz',
              description: 'O microfone abre sozinho quando você fala.',
            },
            {
              value: 'ptt',
              label: 'Apertar para falar (push-to-talk)',
              description:
                'Só transmite enquanto você segura o atalho. Escolha a tecla na aba Atalhos.',
            },
          ]}
        />
        {settings.voiceMode === 'ptt' && (
          <Slider
            label="Atraso ao soltar o atalho"
            value={settings.pttReleaseMs}
            min={0}
            max={1000}
            step={50}
            suffix=" ms"
            onChange={(v) => settings.update({ pttReleaseMs: v })}
          />
        )}
        <Toggle
          label="Sensibilidade manual"
          description="Corta o som abaixo de um nível. Bom para teclado e barulho de fundo."
          checked={settings.gateEnabled}
          onChange={(v) => change({ gateEnabled: v }, true)}
        />
        {settings.gateEnabled && (
          <Slider
            label="Nível da sensibilidade"
            value={settings.gateThresholdDb}
            min={-70}
            max={-10}
            suffix=" dB"
            onChange={(v) => change({ gateThresholdDb: v }, true)}
          />
        )}
      </Section>

      <Section title="Supressão de ruído">
        <RadioGroup
          value={settings.noiseSuppression}
          onChange={(v) => change({ noiseSuppression: v }, true)}
          options={[
            {
              value: 'rnnoise',
              label: 'Forte (RNNoise)',
              description:
                'Rede neural que tira ventilador, teclado e barulho de rua. Usa um pouco mais de CPU.',
            },
            {
              value: 'browser',
              label: 'Padrão',
              description: 'A supressão que já vem no navegador.',
            },
            { value: 'off', label: 'Desligada' },
          ]}
        />
        <Toggle
          label="Cancelamento de eco"
          description="Evita que o som dos outros volte pelo seu microfone quando você usa caixa de som."
          checked={settings.echoCancellation}
          onChange={(v) => change({ echoCancellation: v }, true)}
        />
        <Toggle
          label="Ganho automático"
          description="Ajusta o volume da sua voz sozinho."
          checked={settings.autoGainControl}
          onChange={(v) => change({ autoGainControl: v }, true)}
        />
      </Section>

      <Section
        title="Qualidade do áudio"
        hint="Vale a partir da próxima vez que você entrar num canal de voz."
      >
        <RadioGroup
          value={settings.audioQuality}
          onChange={(v) => settings.update({ audioQuality: v })}
          options={[
            { value: 'voice', label: 'Voz', description: 'Leve e estável, ideal para conversa.' },
            {
              value: 'music',
              label: 'Música',
              description: 'Mais qualidade e sem cortes automáticos. Gasta mais internet.',
            },
          ]}
        />
      </Section>

      <Section title="Sons">
        <Toggle
          label="Sons do app"
          description="Entrar e sair da chamada, mutar, ensurdecer e menções."
          checked={settings.soundsEnabled}
          onChange={(v) => settings.update({ soundsEnabled: v })}
        />
        {settings.soundsEnabled && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Slider
                label="Volume dos sons"
                value={settings.soundVolume}
                min={0}
                max={100}
                step={5}
                suffix="%"
                onChange={(v) => settings.update({ soundVolume: v })}
              />
            </div>
            <button
              type="button"
              onClick={() => playSound('join')}
              className={`${secondaryButtonClass} mb-2.5`}
            >
              Testar
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}
