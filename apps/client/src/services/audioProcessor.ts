/**
 * Processamento do microfone antes de ir para a chamada:
 *
 *   microfone -> RNNoise (opcional) -> volume -> medidor -> corte por sensibilidade -> chamada
 *
 * O medidor fica antes do corte para a tela de configurações mostrar o nível real
 * da voz junto com a linha da sensibilidade.
 */
import {
  NoiseGateWorkletNode,
  RnnoiseWorkletNode,
  loadRnnoise,
} from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import noiseGateWorkletUrl from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { getSettings } from '../store/useSettings';

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;
const loadedContexts = new WeakSet<BaseAudioContext>();

function getRnnoiseBinary(): Promise<ArrayBuffer> {
  rnnoiseBinary ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
  return rnnoiseBinary;
}

async function ensureWorklets(ctx: AudioContext): Promise<void> {
  if (loadedContexts.has(ctx)) return;
  await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
  await ctx.audioWorklet.addModule(noiseGateWorkletUrl);
  loadedContexts.add(ctx);
}

/** O RNNoise só funciona a 48 kHz, então o app usa um contexto próprio nessa taxa. */
let sharedContext: AudioContext | null = null;
export function getVoiceAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  }
  return sharedContext;
}

/** Nível em dBFS (de -100 a 0) a partir de um AnalyserNode. */
export function readLevelDb(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  const rms = Math.sqrt(sum / buffer.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

interface Graph {
  source: MediaStreamAudioSourceNode;
  rnnoise: RnnoiseWorkletNode | null;
  gain: GainNode;
  analyser: AnalyserNode;
  gate: NoiseGateWorkletNode | null;
  destination: MediaStreamAudioDestinationNode;
}

/** Monta a cadeia de áudio. Usado na chamada e no teste de microfone das configurações. */
export async function buildVoiceGraph(ctx: AudioContext, track: MediaStreamTrack): Promise<Graph> {
  const settings = getSettings();
  await ensureWorklets(ctx);

  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  let last: AudioNode = source;

  let rnnoise: RnnoiseWorkletNode | null = null;
  if (settings.noiseSuppression === 'rnnoise') {
    try {
      rnnoise = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: await getRnnoiseBinary() });
      last.connect(rnnoise);
      last = rnnoise;
    } catch {
      rnnoise = null; // Sem RNNoise o áudio segue com a supressão do navegador.
    }
  }

  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, Math.min(2, settings.inputGain / 100));
  last.connect(gain);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  gain.connect(analyser);
  last = analyser;

  let gate: NoiseGateWorkletNode | null = null;
  if (settings.gateEnabled) {
    gate = new NoiseGateWorkletNode(ctx, {
      openThreshold: settings.gateThresholdDb,
      closeThreshold: settings.gateThresholdDb - 6,
      holdMs: 250,
      maxChannels: 1,
    });
    last.connect(gate);
    last = gate;
  }

  const destination = ctx.createMediaStreamDestination();
  last.connect(destination);

  return { source, rnnoise, gain, analyser, gate, destination };
}

export function destroyVoiceGraph(graph: Graph | null): void {
  if (!graph) return;
  for (const node of [graph.source, graph.rnnoise, graph.gain, graph.analyser, graph.gate]) {
    try {
      node?.disconnect();
    } catch {
      // Já desconectado.
    }
  }
  graph.rnnoise?.destroy();
  graph.destination.stream.getTracks().forEach((t) => t.stop());
}

/**
 * Processador que o LiveKit aplica na faixa do microfone. O LiveKit chama `restart`
 * sozinho quando a pessoa troca de microfone.
 */
export class VoiceProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'nexusvoice-audio';
  processedTrack?: MediaStreamTrack;
  private graph: Graph | null = null;
  private lastOptions: AudioProcessorOptions | null = null;
  private levelBuffer = new Float32Array(1024);

  async init(opts: AudioProcessorOptions): Promise<void> {
    this.lastOptions = opts;
    this.graph = await buildVoiceGraph(opts.audioContext, opts.track);
    this.processedTrack = this.graph.destination.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    destroyVoiceGraph(this.graph);
    this.graph = null;
    this.processedTrack = undefined;
  }

  /** Aplica na hora mudanças de volume; o resto pede para remontar a cadeia. */
  setInputGain(percent: number): void {
    if (this.graph) this.graph.gain.gain.value = Math.max(0, Math.min(2, percent / 100));
  }

  getLevelDb(): number {
    return this.graph ? readLevelDb(this.graph.analyser, this.levelBuffer) : -100;
  }

  get options(): AudioProcessorOptions | null {
    return this.lastOptions;
  }
}
