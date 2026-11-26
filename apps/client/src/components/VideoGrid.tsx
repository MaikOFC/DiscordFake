import { useEffect, useRef } from 'react';
import type { VoicePresenceUser } from '@nexusvoice/shared';
import {
  attachCameraTrack,
  attachScreenTrack,
  setParticipantVolume,
} from '../services/voice';
import {
  useAppStore,
  type VoiceParticipantInfo,
} from '../store/useAppStore';

const EMPTY_PRESENCE: VoicePresenceUser[] = [];

function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

interface ScreenStageProps {
  sharer: VoiceParticipantInfo;
  allSharers: VoiceParticipantInfo[];
  onSelectSharer: (userId: string) => void;
}

function ScreenStage({
  sharer,
  allSharers,
  onSelectSharer,
}: ScreenStageProps) {
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = screenVideoRef.current;
    if (!el) return;
    return attachScreenTrack(sharer.userId, el);
  }, [sharer.userId, sharer.isScreenSharing]);

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/40 bg-[#1e1f22] shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-[#232428] px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="font-semibold text-white">
            Tela de {sharer.nickname}
            {sharer.isLocal ? ' (você)' : ''}
          </span>
        </div>

        {allSharers.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {allSharers.map((item) => (
              <button
                key={item.userId}
                type="button"
                onClick={() => onSelectSharer(item.userId)}
                className={`cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium transition ${
                  item.userId === sharer.userId
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                {item.nickname}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex max-h-[56vh] items-center justify-center bg-black">
        <video
          ref={screenVideoRef}
          autoPlay
          playsInline
          muted
          className="max-h-[56vh] w-full object-contain"
        />
      </div>
    </div>
  );
}

interface ParticipantTileProps {
  participant: VoiceParticipantInfo;
  isSpeaking: boolean;
  isDeafened: boolean;
  volume: number;
  compact?: boolean;
}

function ParticipantTile({
  participant,
  isSpeaking,
  isDeafened,
  volume,
  compact = false,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!participant.isCameraOn || !el) {
      return;
    }
    return attachCameraTrack(participant.userId, el);
  }, [participant.userId, participant.isCameraOn]);

  return (
    <div
      className={`relative flex aspect-video flex-col overflow-hidden rounded-xl border bg-[#1e1f22] transition ${
        isSpeaking
          ? 'border-emerald-400 ring-2 ring-emerald-400/35'
          : 'border-zinc-800'
      }`}
    >
      {participant.isCameraOn ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${
            participant.isLocal ? '-scale-x-100' : ''
          }`}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div
            className={`flex items-center justify-center rounded-full font-bold transition ${
              compact ? 'h-11 w-11 text-sm' : 'h-16 w-16 text-lg'
            } ${
              isSpeaking
                ? 'bg-emerald-600 text-white ring-4 ring-emerald-400/40'
                : 'bg-[#2b2d31] text-zinc-200'
            }`}
          >
            {getUserInitials(participant.nickname)}
          </div>
        </div>
      )}

      {/* Barra inferior do cartão com nome, status e volume individual */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 bg-[#232428]/95 px-2.5 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              isSpeaking ? 'bg-emerald-400' : 'bg-zinc-600'
            }`}
          />
          <span className="truncate font-semibold text-zinc-100">
            {participant.nickname}
            {participant.isLocal ? ' (você)' : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {!participant.isLocal && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-zinc-400">Vol</span>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) =>
                  setParticipantVolume(
                    participant.userId,
                    Number(e.target.value),
                  )
                }
                className="h-1 w-14 cursor-pointer accent-emerald-500"
              />
              <span className="w-7 text-right font-mono text-[10px] text-zinc-300">
                {volume}%
              </span>
            </div>
          )}

          {participant.isScreenSharing && (
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              Tela
            </span>
          )}
          {isDeafened && (
            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
              Surdo
            </span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              participant.isMuted
                ? 'bg-red-500/20 text-red-300'
                : 'bg-emerald-500/20 text-emerald-300'
            }`}
          >
            {participant.isMuted ? 'Mutado' : 'Mic'}
          </span>
        </div>
      </div>
    </div>
  );
}

interface VideoGridProps {
  serverId: string;
}

export function VideoGrid({ serverId }: VideoGridProps) {
  const voiceParticipants = useAppStore((state) => state.voiceParticipants);
  const speakingUserIds = useAppStore((state) => state.speakingUserIds);
  const participantVolumes = useAppStore((state) => state.participantVolumes);
  const isDeafened = useAppStore((state) => state.isDeafened);
  const focusedScreenUserId = useAppStore(
    (state) => state.focusedScreenUserId,
  );
  const setFocusedScreenUserId = useAppStore(
    (state) => state.setFocusedScreenUserId,
  );
  const serverPresence = useAppStore(
    (state) => state.voicePresenceByServer[serverId] ?? EMPTY_PRESENCE,
  );

  const activeSharers = voiceParticipants.filter((p) => p.isScreenSharing);
  const focusedSharer =
    activeSharers.find((p) => p.userId === focusedScreenUserId) ??
    activeSharers[0] ??
    null;

  const gridColsClass = focusedSharer
    ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
    : voiceParticipants.length <= 1
      ? 'max-w-xl mx-auto grid-cols-1'
      : voiceParticipants.length <= 4
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="flex w-full flex-col gap-3">
      {focusedSharer && (
        <ScreenStage
          sharer={focusedSharer}
          allSharers={activeSharers}
          onSelectSharer={setFocusedScreenUserId}
        />
      )}

      <div className={`grid w-full gap-3 ${gridColsClass}`}>
        {voiceParticipants.map((participant) => {
          const isSpeaking = speakingUserIds.includes(participant.userId);
          const volume = participantVolumes[participant.userId] ?? 100;
          const presenceInfo = serverPresence.find(
            (u) => u.userId === participant.userId,
          );
          const personDeafened = participant.isLocal
            ? isDeafened
            : Boolean(presenceInfo?.isDeafened);

          return (
            <ParticipantTile
              key={participant.userId}
              participant={participant}
              isSpeaking={isSpeaking}
              isDeafened={personDeafened}
              volume={volume}
              compact={Boolean(focusedSharer)}
            />
          );
        })}
      </div>
    </div>
  );
}
