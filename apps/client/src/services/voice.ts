import {
  AudioPresets,
  DisconnectReason,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type AudioCaptureOptions,
  type LocalTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type { VoiceTokenPayload } from '@nexusvoice/shared';
import { api } from '../lib/api';
import { playSound } from '../lib/sounds';
import {
  saveAudioInputId,
  saveAudioOutputId,
  useAppStore,
  type AudioDeviceOption,
  type ScreenFps,
  type ScreenResolution,
  type VoiceParticipantInfo,
} from '../store/useAppStore';
import { getSettings } from '../store/useSettings';
import { VoiceProcessor, getVoiceAudioContext } from './audioProcessor';
import { emitJoinVoicePresence, emitLeaveVoicePresence, emitUpdateVoicePresence } from './socket';

interface AttachedAudioEntry {
  element: HTMLMediaElement;
  participantId: string;
}

type AudioElementWithSink = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

interface VoiceTarget {
  serverId: string;
  channelId: string;
  channelName: string;
}

// Toda a lógica do LiveKit fica aqui em voice.ts, fora dos componentes React.
let activeRoom: Room | null = null;
let activeProcessor: VoiceProcessor | null = null;
const attachedAudioElements = new Map<string, AttachedAudioEntry>();
const cameraTracksByUser = new Map<string, LocalTrack | RemoteTrack>();
const screenTracksByUser = new Map<string, LocalTrack | RemoteTrack>();
let beforeUnloadRegistered = false;
let deviceListenerRegistered = false;
let mutedBeforeDeafen = false;

/** Canal em que a pessoa quer estar. Usado para voltar sozinho depois de uma queda. */
let wantedVoice: VoiceTarget | null = null;
let rejoinTimer: ReturnType<typeof setTimeout> | null = null;
let rejoinAttempts = 0;
const REJOIN_DELAYS_MS = [1500, 4000, 8000, 15000];

let pttHeld = false;
let pttReleaseTimer: ReturnType<typeof setTimeout> | null = null;

function formatMicrophoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const msg = error instanceof Error ? error.message.toLowerCase() : '';

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    msg.includes('permission')
  ) {
    return 'Permissão de microfone negada. Libere o microfone para falar.';
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
    return 'Permissão de câmera negada. Libere a câmera para transmitir vídeo.';
  }
  if (name === 'NotFoundError' || msg.includes('not found')) {
    return 'Nenhuma câmera encontrada neste computador.';
  }
  if (name === 'NotReadableError' || msg.includes('in use')) {
    return 'Não foi possível abrir a câmera (ela pode estar sendo usada por outro programa).';
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
    return 'Compartilhamento de tela cancelado ou sem permissão.';
  }
  return 'Não foi possível iniciar o compartilhamento de tela.';
}

/** Opções do microfone conforme as configurações (supressão do navegador, eco, ganho automático). */
function buildCaptureOptions(): AudioCaptureOptions {
  const settings = getSettings();
  const { selectedAudioInputId } = useAppStore.getState();
  const music = settings.audioQuality === 'music';
  return {
    deviceId: selectedAudioInputId || undefined,
    echoCancellation: settings.echoCancellation,
    // Com RNNoise ligado, a supressão do navegador fica desligada para não brigar com ela.
    noiseSuppression: settings.noiseSuppression === 'browser' && !music,
    autoGainControl: settings.autoGainControl && !music,
    channelCount: 1,
  };
}

function removeAllAudioElements(): void {
  for (const { element } of attachedAudioElements.values()) {
    element.remove();
  }
  attachedAudioElements.clear();
}

function clearAllVideoTracks(): void {
  for (const track of cameraTracksByUser.values()) track.detach();
  cameraTracksByUser.clear();
  for (const track of screenTracksByUser.values()) track.detach();
  screenTracksByUser.clear();
}

async function applySinkToElement(element: HTMLMediaElement, deviceId: string): Promise<void> {
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

function applyAudioSettingsToElement(element: HTMLMediaElement, participantId: string): void {
  const { isDeafened, participantVolumes, selectedAudioOutputId } = useAppStore.getState();
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
  const store = useAppStore.getState();

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
    local.isScreenShareEnabled && localScreenPub?.track && !localScreenPub.isMuted,
  );
  if (localHasScreen && localScreenPub?.track) {
    screenTracksByUser.set(local.identity, localScreenPub.track);
  } else {
    screenTracksByUser.delete(local.identity);
  }

  list.push({
    userId: local.identity,
    nickname: local.name || 'Você',
    // No push-to-talk o microfone fica fechado fora do atalho, mas isso não é "mutado".
    isMuted: store.isMicMuted,
    isCameraOn: localHasCamera,
    isScreenSharing: localHasScreen,
    isLocal: true,
  });

  for (const remote of room.remoteParticipants.values()) {
    const camPub = remote.getTrackPublication(Track.Source.Camera);
    const hasCamera = Boolean(remote.isCameraEnabled && camPub?.track && !camPub.isMuted);
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

  const prevLocalScreen = store.isScreenSharing;
  const prevLocalCam = store.isCameraOn;

  store.setCameraOn(localHasCamera);
  store.setScreenSharing(localHasScreen);
  store.setVoiceParticipants(list);

  // Mantém a presença sincronizada caso o usuário clique em "Parar compartilhamento" na barra do navegador.
  if (prevLocalScreen !== localHasScreen || prevLocalCam !== localHasCamera) {
    emitUpdateVoicePresence({ isCameraOn: localHasCamera, isScreenSharing: localHasScreen });
  }

  // Atualiza automaticamente quem está em foco na visualização de tela.
  const activeSharers = list.filter((p) => p.isScreenSharing);
  const focusStillSharing = activeSharers.some((p) => p.userId === store.focusedScreenUserId);
  if (!focusStillSharing) {
    store.setFocusedScreenUserId(activeSharers[0]?.userId ?? null);
  }
}

function attachRemoteAudio(
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant,
): void {
  if (track.kind !== Track.Kind.Audio) return;
  const key = publication.trackSid;
  if (attachedAudioElements.has(key)) return;

  const element = track.attach();
  element.style.display = 'none';
  applyAudioSettingsToElement(element, participant.identity);
  document.body.appendChild(element);
  attachedAudioElements.set(key, { element, participantId: participant.identity });
}

function detachRemoteAudio(track: RemoteTrack, publication: RemoteTrackPublication): void {
  if (track.kind !== Track.Kind.Audio) return;
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
      wantedVoice = null;
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
  if (!track) return () => {};
  track.attach(videoElement);
  return () => {
    track.detach(videoElement);
  };
}

/** Conecta o vídeo de câmera de um participante a um elemento <video> do React. */
export function attachCameraTrack(userId: string, videoElement: HTMLVideoElement): () => void {
  return attachTrackMap(cameraTracksByUser, userId, videoElement);
}

/** Conecta a transmissão de tela de um participante a um elemento <video> do React. */
export function attachScreenTrack(userId: string, videoElement: HTMLVideoElement): () => void {
  return attachTrackMap(screenTracksByUser, userId, videoElement);
}

async function cleanupRoom(errorMessage: string | null): Promise<void> {
  const room = activeRoom;
  activeRoom = null;
  activeProcessor = null;
  mutedBeforeDeafen = false;
  pttHeld = false;
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

function getMicTrack(room: Room): LocalAudioTrack | null {
  const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
  return track instanceof LocalAudioTrack ? track : null;
}

/** Liga o processamento (RNNoise, volume, sensibilidade) na faixa do microfone. */
async function attachProcessor(room: Room): Promise<void> {
  const track = getMicTrack(room);
  if (!track) return;
  try {
    await track.setAudioContext(getVoiceAudioContext());
    const processor = new VoiceProcessor();
    await track.setProcessor(processor);
    activeProcessor = processor;
  } catch {
    activeProcessor = null; // Sem processador o microfone funciona do jeito normal do navegador.
  }
}

/** Decide se o microfone deve estar transmitindo agora (mudo, surdo e push-to-talk). */
function shouldTransmit(): boolean {
  const { isMicMuted, isDeafened } = useAppStore.getState();
  if (isMicMuted || isDeafened) return false;
  return getSettings().voiceMode === 'voice' || pttHeld;
}

async function syncMicTransmission(room: Room): Promise<void> {
  const want = shouldTransmit();
  if (room.localParticipant.isMicrophoneEnabled === want) return;
  try {
    await room.localParticipant.setMicrophoneEnabled(want, buildCaptureOptions());
    if (want && !activeProcessor) await attachProcessor(room);
  } catch (error) {
    useAppStore.getState().setVoiceError(formatMicrophoneError(error));
  }
}

function scheduleRejoin(): void {
  if (!wantedVoice || rejoinTimer) return;
  const delay = REJOIN_DELAYS_MS[Math.min(rejoinAttempts, REJOIN_DELAYS_MS.length - 1)]!;
  rejoinAttempts += 1;
  useAppStore.getState().setVoiceReconnecting(true);
  rejoinTimer = setTimeout(() => {
    rejoinTimer = null;
    const target = wantedVoice;
    if (target) void connectToVoice(target, true);
  }, delay);
}

/** Chamado quando o socket volta. Reanuncia a presença ou tenta voltar para a chamada. */
export function rejoinVoiceAfterReconnect(): void {
  const { voiceStatus, voiceChannelId, isMicMuted, isDeafened } = useAppStore.getState();
  if (voiceStatus === 'connected' && voiceChannelId && activeRoom) {
    emitJoinVoicePresence(voiceChannelId, isMicMuted, isDeafened);
    syncParticipantsFromRoom(activeRoom);
  } else if (wantedVoice && !activeRoom) {
    scheduleRejoin();
  }
}

async function connectToVoice(target: VoiceTarget, isRejoin: boolean): Promise<void> {
  const { serverId, channelId, channelName } = target;
  if (!isRejoin) {
    useAppStore.getState().setVoiceConnecting(serverId, channelId, channelName);
  }

  // 1. Pede token ao servidor (ele confere se somos membros do servidor).
  const tokenResult = await api.voiceToken(channelId);
  if (wantedVoice?.channelId !== channelId) return;
  if (!tokenResult.ok || !tokenResult.data) {
    const offline = tokenResult.error?.startsWith('Não foi possível falar com o servidor');
    if (isRejoin && offline) {
      scheduleRejoin();
      return;
    }
    wantedVoice = null;
    useAppStore
      .getState()
      .resetVoiceState(tokenResult.error ?? 'Não foi possível obter acesso ao canal de voz.');
    return;
  }
  const tokenPayload: VoiceTokenPayload = tokenResult.data;
  const settings = getSettings();
  const { selectedAudioOutputId } = useAppStore.getState();

  // 2. Conecta na sala do LiveKit já usando os dispositivos salvos (se houver).
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: buildCaptureOptions(),
    audioOutput: selectedAudioOutputId ? { deviceId: selectedAudioOutputId } : undefined,
    publishDefaults: {
      audioPreset:
        settings.audioQuality === 'music' ? AudioPresets.musicHighQuality : AudioPresets.speech,
      dtx: settings.audioQuality !== 'music',
      red: true,
    },
  });
  activeRoom = room;

  const sync = (): void => {
    if (activeRoom === room) syncParticipantsFromRoom(room);
  };
  room.on(RoomEvent.ParticipantConnected, () => {
    if (activeRoom !== room) return;
    playSound('userJoin');
    sync();
  });
  room.on(RoomEvent.ParticipantDisconnected, () => {
    if (activeRoom !== room) return;
    playSound('userLeave');
    sync();
  });
  room.on(RoomEvent.TrackMuted, sync);
  room.on(RoomEvent.TrackUnmuted, sync);
  room.on(RoomEvent.LocalTrackPublished, sync);
  room.on(RoomEvent.LocalTrackUnpublished, sync);
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    if (activeRoom !== room) return;
    const isDeafened = useAppStore.getState().isDeafened;
    const speakingIds = speakers
      .filter((speaker) => {
        if (speaker.identity === room.localParticipant.identity && isDeafened) return false;
        return speaker.isMicrophoneEnabled;
      })
      .map((speaker) => speaker.identity);
    useAppStore.getState().setSpeakingUserIds(speakingIds);
  });
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind === Track.Kind.Audio) attachRemoteAudio(track, publication, participant);
    sync();
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
    if (track.kind === Track.Kind.Audio) detachRemoteAudio(track, publication);
    sync();
  });
  room.on(RoomEvent.Reconnecting, () => {
    if (activeRoom === room) useAppStore.getState().setVoiceReconnecting(true);
  });
  room.on(RoomEvent.Reconnected, () => {
    if (activeRoom === room) useAppStore.getState().setVoiceReconnecting(false);
  });
  room.on(RoomEvent.Disconnected, (reason) => {
    if (activeRoom !== room) return;
    activeRoom = null;
    activeProcessor = null;
    removeAllAudioElements();
    clearAllVideoTracks();
    emitLeaveVoicePresence();

    const finalReasons = [
      DisconnectReason.CLIENT_INITIATED,
      DisconnectReason.DUPLICATE_IDENTITY,
      DisconnectReason.PARTICIPANT_REMOVED,
      DisconnectReason.ROOM_DELETED,
    ];
    if (wantedVoice && (reason === undefined || !finalReasons.includes(reason))) {
      // Caiu sem a pessoa pedir: tenta voltar para o mesmo canal.
      scheduleRejoin();
      return;
    }
    wantedVoice = null;
    const message =
      reason === DisconnectReason.DUPLICATE_IDENTITY
        ? 'Você entrou nesta chamada por outra janela ou aparelho.'
        : null;
    useAppStore.getState().resetVoiceState(message);
  });

  try {
    await room.connect(tokenPayload.url, tokenPayload.token);
    await room.startAudio();
  } catch {
    if (activeRoom === room) activeRoom = null;
    await room.disconnect().catch(() => undefined);
    if (isRejoin) {
      scheduleRejoin();
      return;
    }
    wantedVoice = null;
    useAppStore
      .getState()
      .resetVoiceState(
        'Não foi possível conectar ao servidor de voz (LiveKit). Confira se ele está rodando.',
      );
    return;
  }

  if (activeRoom !== room) {
    await room.disconnect();
    return;
  }

  rejoinAttempts = 0;
  const previous = useAppStore.getState();
  const keepMuted = isRejoin ? previous.isMicMuted : false;
  const keepDeafened = isRejoin ? previous.isDeafened : false;
  useAppStore
    .getState()
    .setVoiceConnected(serverId, channelId, channelName, keepMuted, keepDeafened);

  // 3. Abre o microfone uma vez (para publicar a faixa e pedir permissão) e liga o processamento.
  let micError: string | null = null;
  try {
    await room.localParticipant.setMicrophoneEnabled(true, buildCaptureOptions());
    await attachProcessor(room);
  } catch (error) {
    micError = formatMicrophoneError(error);
    useAppStore.getState().setMicMuted(true);
  }
  // No push-to-talk (ou mutado), fecha de novo até a pessoa apertar o atalho.
  await syncMicTransmission(room);

  useAppStore.getState().setVoiceError(micError);
  syncAllAttachedAudioElements();
  syncParticipantsFromRoom(room);
  const state = useAppStore.getState();
  emitJoinVoicePresence(channelId, state.isMicMuted, state.isDeafened);
  if (!isRejoin) playSound('join');

  void refreshAudioDevices();
}

export async function joinVoiceChannel(
  serverId: string,
  channelId: string,
  channelName: string,
): Promise<void> {
  ensureGlobalListeners();

  const state = useAppStore.getState();
  if (state.voiceStatus === 'connected' && state.voiceChannelId === channelId) return;

  if (rejoinTimer) {
    clearTimeout(rejoinTimer);
    rejoinTimer = null;
  }
  rejoinAttempts = 0;
  wantedVoice = null;
  await cleanupRoom(null);
  wantedVoice = { serverId, channelId, channelName };
  await connectToVoice(wantedVoice, false);
}

export async function leaveVoiceChannel(): Promise<void> {
  const wasInCall = useAppStore.getState().voiceStatus !== 'idle';
  wantedVoice = null;
  if (rejoinTimer) {
    clearTimeout(rejoinTimer);
    rejoinTimer = null;
  }
  await cleanupRoom(null);
  if (wasInCall) playSound('leave');
}

export async function toggleMicrophoneMute(): Promise<void> {
  const room = activeRoom;
  if (!room) return;

  const { isDeafened, isMicMuted } = useAppStore.getState();
  useAppStore.getState().setVoiceError(null);

  const nowMuted = !isMicMuted;
  useAppStore.getState().setMicMuted(nowMuted);
  let nextDeafened = isDeafened;
  if (!nowMuted && isDeafened) {
    nextDeafened = false;
    mutedBeforeDeafen = false;
    useAppStore.getState().setDeafened(false);
    syncAllAttachedAudioElements();
  }

  await syncMicTransmission(room);
  playSound(nowMuted ? 'mute' : 'unmute');
  syncParticipantsFromRoom(room);
  emitUpdateVoicePresence({ isMuted: nowMuted, isDeafened: nextDeafened });
}

export async function toggleDeafen(): Promise<void> {
  const room = activeRoom;
  if (!room) return;

  const { isDeafened, isMicMuted } = useAppStore.getState();
  useAppStore.getState().setVoiceError(null);

  if (!isDeafened) {
    mutedBeforeDeafen = isMicMuted;
    useAppStore.getState().setDeafened(true);
    useAppStore.getState().setMicMuted(true);
  } else {
    useAppStore.getState().setDeafened(false);
    useAppStore.getState().setMicMuted(mutedBeforeDeafen);
  }
  syncAllAttachedAudioElements();
  await syncMicTransmission(room);

  const state = useAppStore.getState();
  playSound(state.isDeafened ? 'deafen' : 'undeafen');
  syncParticipantsFromRoom(room);
  emitUpdateVoicePresence({ isMuted: state.isMicMuted, isDeafened: state.isDeafened });
}

/** Atalho de push-to-talk apertado ou solto (global no app, ou com a janela em foco no navegador). */
export function setPushToTalk(pressed: boolean): void {
  if (getSettings().voiceMode !== 'ptt') return;
  const room = activeRoom;
  if (pttReleaseTimer) {
    clearTimeout(pttReleaseTimer);
    pttReleaseTimer = null;
  }
  if (pressed) {
    if (pttHeld) return;
    pttHeld = true;
    useAppStore.getState().setPttPressed(true);
    if (room) void syncMicTransmission(room);
    return;
  }
  // Espera um pouco antes de fechar, para não cortar o fim da palavra.
  pttReleaseTimer = setTimeout(() => {
    pttReleaseTimer = null;
    pttHeld = false;
    useAppStore.getState().setPttPressed(false);
    if (activeRoom) void syncMicTransmission(activeRoom);
  }, getSettings().pttReleaseMs);
}

/** Reaplica as configurações de voz durante uma chamada (modo, supressão, sensibilidade). */
export async function applyVoiceSettings(
  options: { rebuildProcessor?: boolean } = {},
): Promise<void> {
  const room = activeRoom;
  if (!room) return;
  const track = getMicTrack(room);
  if (track && options.rebuildProcessor) {
    try {
      await track.restartTrack(buildCaptureOptions());
    } catch {
      // Se não conseguir reabrir com as opções novas, segue com a faixa atual.
    }
    await attachProcessor(room);
  } else if (activeProcessor) {
    activeProcessor.setInputGain(getSettings().inputGain);
  }
  await syncMicTransmission(room);
  syncParticipantsFromRoom(room);
}

/** Nível do microfone na chamada (em dB), para o medidor das configurações. */
export function getCallMicLevelDb(): number | null {
  return activeProcessor ? activeProcessor.getLevelDb() : null;
}

export function isInCall(): boolean {
  return activeRoom !== null;
}

export async function toggleCamera(): Promise<void> {
  const room = activeRoom;
  if (!room) return;

  const currentlyEnabled = room.localParticipant.isCameraEnabled;
  useAppStore.getState().setVoiceError(null);

  try {
    await room.localParticipant.setCameraEnabled(!currentlyEnabled);
    if (currentlyEnabled) {
      room.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.stop();
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

/**
 * Taxa máxima de envio (bits por segundo) para cada qualidade de tela.
 * Mais FPS e mais resolução precisam de mais banda para não borrar.
 */
function getScreenShareBitrate(is1080: boolean, fps: ScreenFps): number {
  if (is1080) {
    return fps === 60 ? 8_000_000 : 5_000_000;
  }
  return fps === 60 ? 3_500_000 : 2_000_000;
}

export function setScreenShareQuality(resolution: ScreenResolution, fps: ScreenFps): void {
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
      room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.stop();
      room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track?.stop();
    } else {
      const is1080 = screenResolution === '1080p';
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          // No Windows, o áudio do sistema só vai junto ao escolher a tela inteira.
          audio: true,
          resolution: {
            width: is1080 ? 1920 : 1280,
            height: is1080 ? 1080 : 720,
            frameRate: screenFps,
          },
          // 'motion' prioriza fluidez (jogos, vídeos); 'detail' prioriza nitidez (texto, código).
          contentHint: screenFps === 60 ? 'motion' : 'detail',
        },
        {
          // Sem isto o LiveKit usa o padrão dele para tela (máx. 15 FPS e 2,5 Mbps),
          // e a opção de 30/60 FPS escolhida no seletor seria ignorada no envio.
          screenShareEncoding: {
            maxBitrate: getScreenShareBitrate(is1080, screenFps),
            maxFramerate: screenFps,
          },
        },
      );
    }

    const nowSharing = room.localParticipant.isScreenShareEnabled;
    useAppStore.getState().setScreenSharing(nowSharing);
    if (nowSharing) {
      useAppStore.getState().setFocusedScreenUserId(room.localParticipant.identity);
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
      useAppStore.getState().setVoiceError('Não foi possível trocar para o microfone selecionado.');
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
      useAppStore.getState().setVoiceError('Não foi possível trocar a saída de áudio.');
    }
  }

  for (const { element } of attachedAudioElements.values()) {
    await applySinkToElement(element, deviceId);
  }
}
