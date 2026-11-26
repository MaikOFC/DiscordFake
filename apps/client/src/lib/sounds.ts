/**
 * Sons curtos da interface (entrar, sair, mutar, menção), gerados na hora com
 * Web Audio. Assim não precisa de arquivos de áudio no projeto.
 */
import { getSettings } from '../store/useSettings';

export type SoundName =
  | 'join'
  | 'leave'
  | 'userJoin'
  | 'userLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'mention';

/** Cada som é uma sequência de notas: [frequência em Hz, duração em segundos]. */
const PATTERNS: Record<SoundName, Array<[number, number]>> = {
  join: [
    [523, 0.07],
    [784, 0.11],
  ],
  leave: [
    [784, 0.07],
    [523, 0.11],
  ],
  userJoin: [
    [659, 0.06],
    [880, 0.09],
  ],
  userLeave: [
    [880, 0.06],
    [659, 0.09],
  ],
  mute: [[330, 0.08]],
  unmute: [[660, 0.08]],
  deafen: [
    [440, 0.06],
    [294, 0.1],
  ],
  undeafen: [
    [294, 0.06],
    [440, 0.1],
  ],
  mention: [
    [988, 0.06],
    [1319, 0.12],
  ],
};

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (!context) {
    try {
      context = new AudioContext();
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') {
    void context.resume();
  }
  return context;
}

export function playSound(name: SoundName): void {
  const { soundsEnabled, soundVolume } = getSettings();
  if (!soundsEnabled || soundVolume <= 0) return;
  const ctx = getContext();
  if (!ctx) return;

  const volume = (soundVolume / 100) * 0.18;
  let start = ctx.currentTime + 0.01;
  for (const [frequency, duration] of PATTERNS[name]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    start += duration * 0.9;
  }
}
