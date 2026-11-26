import type { Channel, ServerDetails } from '@nexusvoice/shared';
import {
  joinVoiceChannel,
  leaveVoiceChannel,
  setScreenShareQuality,
  toggleCamera,
  toggleDeafen,
  toggleMicrophoneMute,
  toggleScreenShare,
} from '../../services/voice';
import { useAppStore, type ScreenFps, type ScreenResolution } from '../../store/useAppStore';
import { Avatar } from '../Avatar';
import { VideoGrid } from '../VideoGrid';

function CallButton({
  label,
  onClick,
  tone,
}: {
  label: string;
  onClick: () => void;
  tone: 'neutral' | 'on' | 'off' | 'danger';
}) {
  const styles = {
    neutral: 'bg-zinc-700 text-white hover:bg-zinc-600',
    on: 'bg-emerald-600 text-white hover:bg-emerald-500',
    off: 'bg-red-500/20 text-red-200 hover:bg-red-500/30',
    danger: 'bg-red-600 text-white hover:bg-red-500',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${styles[tone]}`}
    >
      {label}
    </button>
  );
}

export function VoiceStage({ server, channel }: { server: ServerDetails; channel: Channel }) {
  const voiceStatus = useAppStore((s) => s.voiceStatus);
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const isMicMuted = useAppStore((s) => s.isMicMuted);
  const isDeafened = useAppStore((s) => s.isDeafened);
  const isCameraOn = useAppStore((s) => s.isCameraOn);
  const isScreenSharing = useAppStore((s) => s.isScreenSharing);
  const screenResolution = useAppStore((s) => s.screenResolution);
  const screenFps = useAppStore((s) => s.screenFps);
  const voiceError = useAppStore((s) => s.voiceError);
  const voiceParticipants = useAppStore((s) => s.voiceParticipants);
  const presence = useAppStore((s) => s.voicePresenceByServer[server.id]);

  const inThisCall = voiceStatus !== 'idle' && voiceChannelId === channel.id;
  const peopleHere = (presence ?? []).filter((p) => p.channelId === channel.id);

  if (!inThisCall || voiceStatus === 'connecting') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-zinc-700/60 bg-[#2b2d31] p-6 text-center shadow-lg">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
            Canal de voz
          </div>
          <h3 className="mt-1 text-xl font-bold text-white">🔊 {channel.name}</h3>
          {peopleHere.length > 0 ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {peopleHere.map((p) => (
                <div
                  key={p.userId}
                  className="flex items-center gap-1.5 rounded-full bg-[#1e1f22] py-1 pr-3 pl-1 text-xs"
                >
                  <Avatar url={p.avatarUrl} name={p.nickname} size={22} />
                  {p.nickname}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">Ninguém por aqui ainda.</p>
          )}
          <button
            type="button"
            disabled={voiceStatus === 'connecting'}
            onClick={() => void joinVoiceChannel(server.id, channel.id, channel.name)}
            className="mt-5 cursor-pointer rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {voiceStatus === 'connecting' && voiceChannelId === channel.id
              ? 'Conectando...'
              : 'Entrar no canal de voz'}
          </button>
          {voiceError && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {voiceError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                voiceStatus === 'reconnecting' ? 'text-amber-300' : 'text-emerald-400'
              }`}
            >
              {voiceStatus === 'reconnecting'
                ? 'Reconectando...'
                : `Chamada ativa (${voiceParticipants.length})`}
            </span>
            <h3 className="text-lg font-bold text-white">🔊 {channel.name}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <CallButton
              label={isMicMuted ? 'Desmutar' : 'Mutar'}
              tone={isMicMuted ? 'off' : 'neutral'}
              onClick={() => void toggleMicrophoneMute()}
            />
            <CallButton
              label={isDeafened ? 'Voltar a ouvir' : 'Ensurdecer'}
              tone={isDeafened ? 'off' : 'neutral'}
              onClick={() => void toggleDeafen()}
            />
            <CallButton
              label={isCameraOn ? 'Desligar câmera' : 'Ligar câmera'}
              tone={isCameraOn ? 'on' : 'neutral'}
              onClick={() => void toggleCamera()}
            />
            <CallButton
              label={isScreenSharing ? 'Parar tela' : 'Compartilhar tela'}
              tone={isScreenSharing ? 'on' : 'neutral'}
              onClick={() => void toggleScreenShare()}
            />
            <CallButton
              label="Desconectar"
              tone="danger"
              onClick={() => void leaveVoiceChannel()}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-[#2b2d31] px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-300">Qualidade da tela:</span>
            <select
              value={screenResolution}
              disabled={isScreenSharing}
              onChange={(e) => setScreenShareQuality(e.target.value as ScreenResolution, screenFps)}
              className="rounded border border-zinc-700 bg-[#1e1f22] px-2 py-1 text-xs text-zinc-100 outline-none disabled:opacity-60"
            >
              <option value="720p">720p (mais leve)</option>
              <option value="1080p">1080p (Full HD)</option>
            </select>
            <select
              value={screenFps}
              disabled={isScreenSharing}
              onChange={(e) =>
                setScreenShareQuality(screenResolution, Number(e.target.value) as ScreenFps)
              }
              className="rounded border border-zinc-700 bg-[#1e1f22] px-2 py-1 text-xs text-zinc-100 outline-none disabled:opacity-60"
            >
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>
          <span className="text-[11px] text-zinc-400">
            {isScreenSharing
              ? 'Pare e compartilhe de novo para mudar a qualidade.'
              : 'No Windows, o áudio do sistema só vai junto ao compartilhar a tela inteira.'}
          </span>
        </div>

        {voiceError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {voiceError}
          </div>
        )}

        <div className="flex flex-1 items-center">
          <VideoGrid serverId={server.id} />
        </div>
      </div>
    </div>
  );
}
