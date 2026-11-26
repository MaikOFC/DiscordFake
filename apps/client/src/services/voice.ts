import {
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type { ActionResult, VoiceTokenPayload } from '@nexusvoice/shared';
import {
  saveAudioInputId,
  saveAudioOutputId,
  useAppStore,
  type AudioDeviceOption,
  type ScreenFps,
  type ScreenResolution,
  type VoiceParticipantInfo,
} from '../store/useAppStore';
import {
  emitJoinVoicePresence,
  emitLeaveVoicePresence,
  emitUpdateVoicePresence,
} from './socket';

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

interface AttachedAudioEntry {
  element: HTMLMediaElement;
  participantId: string;
}

type AudioElementWithSink = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

// Toda a lógica do LiveKit fica aqui em voice.ts, fora dos componentes React.
let activeRoom: Room | null = null;
const attachedAudioElements = new Map<string, AttachedAudioEntry>();
const cameraTracksByUser = new Map<string, LocalTrack | RemoteTrack>();
const screenTracksByUser = new Map<string, LocalTrack | RemoteTrack>();
let beforeUnloadRegistered = false;
let deviceListenerRegistered = false;
let mutedBeforeDeafen = false;

function formatMicrophoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const msg = error instanceof Error ? error.message.toLowerCase() : '';

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    msg.includes('permission')
  ) {
    return 'Permissão de microfone negada. Libere o microfone no navegador para falar.';
  }
  if (name === 'NotFoundError' || msg.includes('not found')) {
    return 'Nenhum microfone encontrado neste computador.';
  }
  if (name === 'NotReadableError') {
    return 'Não foi possível usar o microfone (pode estar ocupado por outro programa).';
  }
  return 'Não foi possível ativar seu microfone.';
}

function formatCameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const msg = error instanceof Error ? error.message.toLowerCase() : '';

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    msg.includes('permission')
  ) {
    return 'Permissão de câmera negada. Libere a câmera no navegador para transmitir vídeo.';
  }
  if (name === 'NotFoundError' || msg.includes('not found')) {
    return 'Nenhuma câmera encontrada neste computador.';
  }
  if (name === 'NotReadableError' || msg.includes('in use')) {
    return 'Não foi possível abrir a câmera (ela pode estar sendo usada por outra aba ou programa).';
  }
  return 'Não foi possível ativar sua câmera.';
}

function formatScreenShareError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const msg = error instanceof Error ? error.message.toLowerCase() : '';

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'AbortError' ||
    msg.includes('permission') ||
    msg.includes('cancelled') ||
    msg.includes('canceled')
  ) {
    return 'Compartilhamento de tela cancelado ou sem permissão no navegador.';
  }
  return 'Não foi possível iniciar o compartilhamento de tela.';
}

function removeAllAudioElements(): void {
  for (const { element } of attachedAudioElements.values()) {
    element.remove();
  }
  attachedAudioElements.clear();
}

function clearAllVideoTracks(): void {
  for (const track of cameraTracksByUser.values()) {
    track.detach();
  }
  cameraTracksByUser.clear();

  for (const track of screenTracksByUser.values()) {
    track.detach();
  }
  screenTracksByUser.clear();
}

async function applySinkToElement(
  element: HTMLMediaElement,
  deviceId: string,
): Promise<void> {
  if (!deviceId) return;
  const sinkable = element as AudioElementWithSink;
  if (typeof sinkable.setSinkId === 'function') {
    try {
      await sinkable.setSinkId(deviceId);
    } catch {
      // Alguns dispositivos virtuais/desconectados podem falhar; não travamos a chamada.
    }
  }
}

function applyAudioSettingsToElement(
  element: HTMLMediaElement,
  participantId: string,
): void {
  const { isDeafened, participantVolumes, selectedAudioOutputId } =
    useAppStore.getState();
  const volumePercent = participantVolumes[participantId] ?? 100;

  element.muted = isDeafened;
  element.volume = Math.max(0, Math.min(1, volumePercent / 100));
  if (selectedAudioOutputId) {
    void applySinkToElement(element, selectedAudioOutputId);
  }
}

function syncAllAttachedAudioElements(): void {
  for (const { element, participantId } of attachedAudioElements.values()) {
    applyAudioSettingsToElement(element, participantId);
  }
}

function syncParticipantsFromRoom(room: Room): void {
  const list: VoiceParticipantInfo[] = [];

  const local = room.localParticipant;
  const localCamPub = local.getTrackPublication(Track.Source.Camera);
  const localHasCamera = Boolean(
    local.isCameraEnabled && localCamPub?.track && !localCamPub.isMuted,
  );
  if (localHasCamera && localCamPub?.track) {
    cameraTracksByUser.set(local.identity, localCamPub.track);
  } else {
    cameraTracksByUser.delete(local.identity);
  }

  const localScreenPub = local.getTrackPublication(Track.Source.ScreenShare);
  const localHasScreen = Boolean(
    local.isScreenShareEnabled &&
      localScreenPub?.track &&
      !localScreenPub.isMuted,
  );
  if (localHasScreen && localScreenPub?.track) {
    screenTracksByUser.set(local.identity, localScreenPub.track);
  } else {
    screenTracksByUser.delete(local.identity);
  }

  list.push({
    userId: local.identity,
    nickname: local.name || 'Você',
    isMuted: !local.isMicrophoneEnabled,
    isCameraOn: localHasCamera,
    isScreenSharing: localHasScreen,
    isLocal: true,
  });

  for (const remote of room.remoteParticipants.values()) {
    const camPub = remote.getTrackPublication(Track.Source.Camera);
    const hasCamera = Boolean(
      remote.isCameraEnabled && camPub?.track && !camPub.isMuted,
    );
    if (hasCamera && camPub?.track) {
      cameraTracksByUser.set(remote.identity, camPub.track);
    } else {
      cameraTracksByUser.delete(remote.identity);
    }

    const screenPub = remote.getTrackPublication(Track.Source.ScreenShare);
    const hasScreen = Boolean(
      remote.isScreenShareEnabled && screenPub?.track && !screenPub.isMuted,
    );
    if (hasScreen && screenPub?.track) {
      screenTracksByUser.set(remote.identity, screenPub.track);
    } else {
      screenTracksByUser.delete(remote.identity);
    }

    list.push({
      userId: remote.identity,
      nickname: remote.name || remote.identity,
      isMuted: !remote.isMicrophoneEnabled,
      isCameraOn: hasCamera,
      isScreenSharing: hasScreen,
      isLocal: false,
    });
  }

  const store = useAppStore.getState();
  const prevLocalScreen = store.isScreenSharing;
  const prevLocalCam = store.isCameraOn;

  store.setCameraOn(localHasCamera);
  store.setScreenSharing(localHasScreen);
  store.setVoiceParticipants(list);

  // Mantém a presença sincronizada caso o usuário clique em "Parar compartilhamento" na barra do navegador.
  if (prevLocalScreen !== localHasScreen || prevLocalCam !== localHasCamera) {
    emitUpdateVoicePresence({
      isCameraOn: localHasCamera,
      isScreenSharing: localHasScreen,
    });
  }

  // Atualiza automaticamente quem está em foco na visualização de tela.
  const activeSharers = list.filter((p) => p.isScreenSharing);
  const currentFocused = store.focusedScreenUserId;
  const focusStillSharing = activeSharers.some(
    (p) => p.userId === currentFocused,
  );
  if (!focusStillSharing) {
    store.setFocusedScreenUserId(activeSharers[0]?.userId ?? null);
  }
}

function attachRemoteAudio(
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant,
): void {
  if (track.kind !== Track.Kind.Audio) {
    return;
  }

  const key = publication.trackSid;
  if (attachedAudioElements.has(key)) {
    return;
  }

  const element = track.attach();
  element.style.display = 'none';
  applyAudioSettingsToElement(element, participant.identity);
  document.body.appendChild(element);
  attachedAudioElements.set(key, {
    element,
    participantId: participant.identity,
  });
}

function detachRemoteAudio(
  track: RemoteTrack,
  publication: RemoteTrackPublication,
): void {
  if (track.kind !== Track.Kind.Audio) {
    return;
  }
  track.detach().forEach((el) => el.remove());
  const existing = attachedAudioElements.get(publication.trackSid);
  if (existing) {
    existing.element.remove();
    attachedAudioElements.delete(publication.trackSid);
  }
}

function ensureGlobalListeners(): void {
  if (!beforeUnloadRegistered) {
    beforeUnloadRegistered = true;
    window.addEventListener('beforeunload', () => {
      void cleanupRoom(null);
    });
  }

  if (!deviceListenerRegistered && navigator.mediaDevices) {
    deviceListenerRegistered = true;
    navigator.mediaDevices.addEventListener('devicechange', () => {
      void refreshAudioDevices();
    });
  }
}

export async function refreshAudioDevices(): Promise<void> {
  try {
    const [inputs, outputs] = await Promise.all([
      Room.getLocalDevices('audioinput'),
      Room.getLocalDevices('audiooutput'),
    ]);

    const mappedInputs: AudioDeviceOption[] = inputs.map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `Microfone ${index + 1}`,
    }));

    const mappedOutputs: AudioDeviceOption[] = outputs.map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `Saída de áudio ${index + 1}`,
    }));

    useAppStore.getState().setAudioDevices(mappedInputs, mappedOutputs);
  } catch {
    // Sem permissão ainda ou navegador sem enumerateDevices.
  }
}

function attachTrackMap(
  trackMap: Map<string, LocalTrack | RemoteTrack>,
  userId: string,
  videoElement: HTMLVideoElement,
): () => void {
  const track = trackMap.get(userId);
  if (!track) {
    return () => {};
  }
  track.attach(videoElement);
  return () => {
    track.detach(videoElement);
  };
}

/**
 * Conecta o vídeo de câmera de um participante a um elemento <video> do React.
 */
export function attachCameraTrack(
  userId: string,
  videoElement: HTMLVideoElement,
): () => void {
  return attachTrackMap(cameraTracksByUser, userId, videoElement);
}

/**
 * Conecta a transmissão de tela de um participante a um elemento <video> do React.
 */
export function attachScreenTrack(
  userId: string,
  videoElement: HTMLVideoElement,
): () => void {
  return attachTrackMap(screenTracksByUser, userId, videoElement);
}

async function cleanupRoom(errorMessage: string | null): Promise<void> {
  const room = activeRoom;
  activeRoom = null;
  mutedBeforeDeafen = false;
  removeAllAudioElements();
  clearAllVideoTracks();
  emitLeaveVoicePresence();

  if (room) {
    for (const pub of room.localParticipant.trackPublications.values()) {
      pub.track?.stop();
    }
    await room.disconnect();
  }

  useAppStore.getState().resetVoiceState(errorMessage);
}

export async function joinVoiceChannel(
  serverId: string,
  channelId: string,
  channelName: string,
): Promise<void> {
  ensureGlobalListeners();

  const state = useAppStore.getState();
  if (state.voiceStatus === 'connected' && state.voiceChannelId === channelId) {
    return;
  }

  await cleanupRoom(null);
  useAppStore.getState().setVoiceConnecting(serverId, channelId, channelName);

  // 1. Pede token ao servidor (ele confere se somos membros do servidor).
  let tokenPayload: VoiceTokenPayload;
  try {
    const response = await fetch(`${SERVER_URL}/api/voice/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId,
        userId: useAppStore.getState().userId,
      }),
    });

    const json = (await response.json()) as ActionResult<VoiceTokenPayload>;
    if (!response.ok || !json.ok || !json.data) {
      useAppStore
        .getState()
        .resetVoiceState(
          json.error ?? 'Não foi possível obter acesso ao canal de voz.',
        );
      return;
    }
    tokenPayload = json.data;
  } catch {
    useAppStore
      .getState()
      .resetVoiceState(
        'Não foi possível falar com o servidor para entrar na chamada.',
      );
    return;
  }

  const { selectedAudioInputId, selectedAudioOutputId } =
    useAppStore.getState();

  // 2. Conecta na sala do LiveKit já usando os dispositivos salvos (se houver).
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: selectedAudioInputId
      ? { deviceId: selectedAudioInputId }
      : undefined,
    audioOutput: selectedAudioOutputId
      ? { deviceId: selectedAudioOutputId }
      : undefined,
  });
  activeRoom = room;

  room.on(RoomEvent.ParticipantConnected, () => {
    if (activeRoom === room) syncParticipantsFromRoom(room);
  });
  room.on(RoomEvent.ParticipantDisconnected, () => {
    if (activeRoom === room) syncParticipantsFromRoom(room);
  });
  room.on(RoomEvent.TrackMuted, () => {
    if (activeRoom === room) syncParticipantsFromRoom(room);
  });
  room.on(RoomEvent.TrackUnmuted, () => {
    if (activeRoom === room) syncParticipantsFromRoom(room);
  });
  room.on(RoomEvent.LocalTrackPublished, () => {
    if (activeRoom === room) syncParticipantsFromRoom(room);
  });
  room.on(RoomEvent.LocalTrackUnpublished, () => {
    if (activeRoom === room) syncParticipantsFromRoom(room);
  });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    if (activeRoom !== room) return;
    const isDeafened = useAppStore.getState().isDeafened;
    const speakingIds = speakers
      .filter((speaker) => {
        if (speaker.identity === room.localParticipant.identity && isDeafened) {
          return false;
        }
        return speaker.isMicrophoneEnabled;
      })
      .map((speaker) => speaker.identity);
    useAppStore.getState().setSpeakingUserIds(speakingIds);
  });
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind === Track.Kind.Audio) {
      attachRemoteAudio(track, publication, participant);
    }
    if (activeRoom === room) {
      syncParticipantsFromRoom(room);
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
    if (track.kind === Track.Kind.Audio) {
      detachRemoteAudio(track, publication);
    }
    if (activeRoom === room) {
      syncParticipantsFromRoom(room);
    }
  });
  room.on(RoomEvent.Disconnected, () => {
    if (activeRoom === room) {
      activeRoom = null;
      mutedBeforeDeafen = false;
      removeAllAudioElements();
      clearAllVideoTracks();
      emitLeaveVoicePresence();
      useAppStore.getState().resetVoiceState(null);
    }
  });

  try {
    await room.connect(tokenPayload.url, tokenPayload.token);
    await room.startAudio();
  } catch {
    await cleanupRoom(
      'Não foi possível conectar ao servidor de voz (LiveKit). Confira se rodou "npm run livekit".',
    );
    return;
  }

  if (activeRoom !== room) {
    await room.disconnect();
    return;
  }

  // 3. Tenta ativar o microfone; se falhar, entra mutado com aviso amigável.
  let micMuted = false;
  let micError: string | null = null;
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
    micMuted = !room.localParticipant.isMicrophoneEnabled;
  } catch (error) {
    micMuted = true;
    micError = formatMicrophoneError(error);
  }

  useAppStore
    .getState()
    .setVoiceConnected(serverId, channelId, channelName, micMuted, false, []);
  useAppStore.getState().setVoiceError(micError);
  syncParticipantsFromRoom(room);
  emitJoinVoicePresence(channelId, micMuted, false);

  void refreshAudioDevices();
}

export async function leaveVoiceChannel(): Promise<void> {
  await cleanupRoom(null);
}

export async function toggleMicrophoneMute(): Promise<void> {
  const room = activeRoom;
  if (!room) return;

  const { isDeafened } = useAppStore.getState();
  const currentlyMuted = !room.localParticipant.isMicrophoneEnabled;
  useAppStore.getState().setVoiceError(null);

  try {
    await room.localParticipant.setMicrophoneEnabled(currentlyMuted);
    const nowMuted = !room.localParticipant.isMicrophoneEnabled;
    useAppStore.getState().setMicMuted(nowMuted);

    let nextDeafened = isDeafened;
    if (!nowMuted && isDeafened) {
      nextDeafened = false;
      mutedBeforeDeafen = false;
      useAppStore.getState().setDeafened(false);
      syncAllAttachedAudioElements();
    }

    syncParticipantsFromRoom(room);
    emitUpdateVoicePresence({ isMuted: nowMuted, isDeafened: nextDeafened });
  } catch (error) {
    useAppStore.getState().setVoiceError(formatMicrophoneError(error));
  }
}

export async function toggleDeafen(): Promise<void> {
  const room = activeRoom;
  if (!room) return;

  const { isDeafened, isMicMuted } = useAppStore.getState();
  useAppStore.getState().setVoiceError(null);

  if (!isDeafened) {
    mutedBeforeDeafen = isMicMuted;
    useAppStore.getState().setDeafened(true);
    syncAllAttachedAudioElements();

    if (!isMicMuted) {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        // Ignora erro ao mutar.
      }
    }

    const nowMuted = !room.localParticipant.isMicrophoneEnabled;
    useAppStore.getState().setMicMuted(nowMuted);
    syncParticipantsFromRoom(room);
    emitUpdateVoicePresence({ isMuted: nowMuted, isDeafened: true });
  } else {
    useAppStore.getState().setDeafened(false);
    syncAllAttachedAudioElements();

    if (!mutedBeforeDeafen) {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (error) {
        useAppStore.getState().setVoiceError(formatMicrophoneError(error));
      }
    }

    const nowMuted = !room.localParticipant.isMicrophoneEnabled;
    useAppStore.getState().setMicMuted(nowMuted);
    syncParticipantsFromRoom(room);
    emitUpdateVoicePresence({ isMuted: nowMuted, isDeafened: false });
  }
}

export async function toggleCamera(): Promise<void> {
  const room = activeRoom;
  if (!room) return;

  const currentlyEnabled = room.localParticipant.isCameraEnabled;
  useAppStore.getState().setVoiceError(null);

  try {
    await room.localParticipant.setCameraEnabled(!currentlyEnabled);
    if (currentlyEnabled) {
      const pub = room.localParticipant.getTrackPublication(
        Track.Source.Camera,
      );
      pub?.track?.stop();
    }

    const nowOn = room.localParticipant.isCameraEnabled;
    useAppStore.getState().setCameraOn(nowOn);
    syncParticipantsFromRoom(room);
    emitUpdateVoicePresence({ isCameraOn: nowOn });
  } catch (error) {
    useAppStore.getState().setVoiceError(formatCameraError(error));
    syncParticipantsFromRoom(room);
    emitUpdateVoicePresence({ isCameraOn: false });
  }
}

export function setScreenShareQuality(
  resolution: ScreenResolution,
  fps: ScreenFps,
): void {
  useAppStore.getState().setScreenQuality(resolution, fps);
}

export async function toggleScreenShare(): Promise<void> {
  const room = activeRoom;
  if (!room) return;

  const currentlySharing = room.localParticipant.isScreenShareEnabled;
  const { screenResolution, screenFps } = useAppStore.getState();
  useAppStore.getState().setVoiceError(null);

  try {
    if (currentlySharing) {
      await room.localParticipant.setScreenShareEnabled(false);
      const screenPub = room.localParticipant.getTrackPublication(
        Track.Source.ScreenShare,
      );
      screenPub?.track?.stop();
      const audioPub = room.localParticipant.getTrackPublication(
        Track.Source.ScreenShareAudio,
      );
      audioPub?.track?.stop();
    } else {
      const is1080 = screenResolution === '1080p';
      await room.localParticipant.setScreenShareEnabled(true, {
        // No Windows, o navegador só captura áudio do sistema ao escolher a tela inteira.
        audio: true,
        resolution: {
          width: is1080 ? 1920 : 1280,
          height: is1080 ? 1080 : 720,
          frameRate: screenFps,
        },
        contentHint: 'detail',
      });
    }

    const nowSharing = room.localParticipant.isScreenShareEnabled;
    useAppStore.getState().setScreenSharing(nowSharing);
    if (nowSharing) {
      useAppStore
        .getState()
        .setFocusedScreenUserId(room.localParticipant.identity);
    }
    syncParticipantsFromRoom(room);
    emitUpdateVoicePresence({ isScreenSharing: nowSharing });
  } catch (error) {
    useAppStore.getState().setVoiceError(formatScreenShareError(error));
    syncParticipantsFromRoom(room);
    emitUpdateVoicePresence({ isScreenSharing: false });
  }
}

export function setParticipantVolume(userId: string, volume: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(volume)));
  useAppStore.getState().setParticipantVolume(userId, clamped);

  for (const { element, participantId } of attachedAudioElements.values()) {
    if (participantId === userId) {
      element.volume = clamped / 100;
    }
  }
}

export async function selectAudioInputDevice(deviceId: string): Promise<void> {
  saveAudioInputId(deviceId);
  useAppStore.getState().setSelectedAudioInputId(deviceId);
  useAppStore.getState().setVoiceError(null);

  if (activeRoom && deviceId) {
    try {
      await activeRoom.switchActiveDevice('audioinput', deviceId);
    } catch {
      useAppStore
        .getState()
        .setVoiceError('Não foi possível trocar para o microfone selecionado.');
    }
  }
}

export async function selectAudioOutputDevice(deviceId: string): Promise<void> {
  saveAudioOutputId(deviceId);
  useAppStore.getState().setSelectedAudioOutputId(deviceId);
  useAppStore.getState().setVoiceError(null);

  if (activeRoom && deviceId) {
    try {
      await activeRoom.switchActiveDevice('audiooutput', deviceId);
    } catch {
      useAppStore
        .getState()
        .setVoiceError(
          'Não foi possível trocar a saída de áudio neste navegador.',
        );
    }
  }

  for (const { element } of attachedAudioElements.values()) {
    await applySinkToElement(element, deviceId);
  }
}
