import { analyzeWaveformInWorker } from '../analysis/waveform-client';
import { createHeadphoneMonitor } from './headphone-monitor';
import { clampFinite } from '../dsp/curves';
import { inspectAudioBlob, safeTrackName } from './admission';
import type { AudioFileDescriptor } from './admission';
import { AudioEngineError } from './errors';
import { createAudioGraph, type AudioGraph, type DeckFxSetting } from './audio-graph';
import type { TransportCommand, TransportProcessorMessage, SharedTransportCommand } from './protocol';
import { workerDiagnostics } from './worker-ledger';
import { MixRecorder } from '../recording/mix-recorder';
import type {
  AudioContextState,
  AudioEngine,
  BeatDivision,
  BeatGridSnapshot,
  BpmAnalysisSnapshot,
  CrossfaderCurve,
  FxSnapshot,
  HotCueIndex,
  HotCueSnapshot,
  SyncSnapshot,
  AudioEngineErrorCode,
  AudioEngineOptions,
  AudioSnapshot,
  CommandAck,
  DeckId,
  DeckSnapshot,
  DeckStatus,
  EngineCapabilities,
  EqBand,
  LoopRegion,
  PositionSnapshot,
  ResourceDiagnostics,
  TrackInfo,
} from './types';

const DECK_IDS: readonly DeckId[] = ['A', 'B'];
const DEFAULT_MAX_ENCODED = 128 * 1024 * 1024;
const DEFAULT_MAX_PCM = 192 * 1024 * 1024;
const DEFAULT_MAX_DURATION = 8 * 60;
const MAX_PENDING_COMMANDS = 256;
const COMMAND_TIMEOUT_MS = 5000;
const MAX_TRANSIENT_PCM_BYTES = 768 * 1024 * 1024;

type Anchor = { frame: number; contextFrame: number; playing: boolean; rate: number };
interface DeckState {
  readonly id: DeckId;
  revision: number;
  status: DeckStatus;
  track: TrackInfo | null;
  anchor: Anchor;
  gainDb: number;
  eqDb: Record<EqBand, number>;
  filterValue: number;
  volume: number;
  loop: LoopRegion | null;
  loopBeats: BeatDivision | null;
  tempoPercent: number;
  pitchSemitones: number;
  pitchMode: 'tape' | 'linked' | 'independent';
  nudgePercent: number;
  beatGrid: BeatGridSnapshot | null;
  bpmAnalysis: BpmAnalysisSnapshot;
  scratchActive: boolean;
  hotCues: Array<HotCueSnapshot | null>;
  cueSeconds: number;
  quantize: boolean;
  fx: FxSnapshot;
  sync: SyncSnapshot;
  error: AudioSnapshot['decks'][DeckId]['error'];
  loadGeneration: number;
  installedPcmBytes: number;
  installedLoadGeneration: number;
}
interface PendingCommand {
  readonly deckId: DeckId;
  readonly trackRevision: number;
  readonly resolve: (ack: CommandAck) => void;
  readonly reject: (reason: AudioEngineError) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}
type CommandKind = 'install' | 'clear' | 'play' | 'pause' | 'cue' | 'seek' | 'loop' | 'tempo' | 'scratch-begin' | 'scratch-end' | 'nudge' | 'nudge-hold' | 'sync';
type CommandDetails = {
  readonly trackRevision?: number; readonly channels?: Float32Array[]; readonly mediaFrame?: number;
  readonly loop?: { startFrame: number; endFrame: number } | null; readonly loopBeats?: BeatDivision | null;
  readonly tempoPercent?: number; readonly deltaPercent?: number; readonly masterId?: DeckId | null; readonly applyFrame?: number;readonly alignPhase?:boolean;
};
type ScratchIntent = { readonly positionFrame: number; readonly velocity: number; readonly trackRevision: number };
type QuantizedBoundary = { readonly applyFrame: number | undefined; readonly mediaFrame: number };

function makeDeck(id: DeckId): DeckState {
  return {
    id, revision: 0, status: 'empty', track: null,
    anchor: { frame: 0, contextFrame: 0, playing: false, rate: 0 },
    gainDb: -3,
    eqDb: { low: 0, mid: 0, high: 0 },
    filterValue: 0,
    volume: 1,
    loop: null,
    loopBeats: null,
    tempoPercent: 0,
    pitchSemitones: 0, pitchMode: 'tape', nudgePercent: 0,
    beatGrid: null,
    bpmAnalysis: Object.freeze({ status: 'idle', confidence: 0, candidates: Object.freeze([]) }),
    scratchActive: false,
    hotCues: Array(8).fill(null),
    cueSeconds: 0,
    quantize: false,
    fx: Object.freeze({
      delay: Object.freeze({ enabled: false, wet: 0.22, feedback: 0.35, division: 1 }),
      reverb: Object.freeze({ enabled: false, wet: 0.18 }),
      drive: Object.freeze({ enabled: false, amount: .3 }),
      flanger: Object.freeze({ enabled: false, amount: .35, rate: .4 }),
      tremolo: Object.freeze({ enabled: false, amount: .4, rate: 3 }),
    }),
    sync: Object.freeze({ status: 'off', masterId: null, reason: null, phaseErrorSeconds: null }),
    error: null,
    loadGeneration: 0,
    installedPcmBytes: 0,
    installedLoadGeneration: 0,
  };
}

function asEngineError(cause: unknown, code: AudioEngineErrorCode, stage: 'admission' | 'decode' | 'install' | 'transport' | 'context' | 'engine'): AudioEngineError {
  if (cause instanceof AudioEngineError) return cause;
  if (cause instanceof DOMException && cause.name === 'AbortError') return new AudioEngineError('aborted', 'The audio load was cancelled.', true, stage);
  return new AudioEngineError(code, cause instanceof Error ? cause.message : String(cause), true, stage);
}

function snapshotError(error: AudioEngineError | null): AudioSnapshot['decks'][DeckId]['error'] {
  return error ? Object.freeze({
    name: 'AudioEngineError' as const,
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    stage: error.stage,
  }) : null;
}

interface DecodedPcm {
  readonly channels: Float32Array[];
  readonly pcmBytes: number;
  readonly durationSeconds: number;
}

async function decodePreparedFile(
  context: AudioContext,
  file: File | Blob,
  descriptor: AudioFileDescriptor,
  signal: AbortSignal,
  maxDurationSeconds: number,
  maxPcmBytes: number,
  beforeCopy: (decodedBytes: number, ownedBytes: number) => void,
): Promise<DecodedPcm> {
  const encoded = descriptor.encodedBytes ?? await file.arrayBuffer();
  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  let decoded: AudioBuffer;
  try { decoded = await context.decodeAudioData(encoded); }
  catch (cause) { throw asEngineError(cause, 'decode-failed', 'decode'); }
  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  if (decoded.numberOfChannels < 1 || decoded.numberOfChannels > 2) {
    throw new AudioEngineError('too-many-channels', 'Decoded audio must contain one or two channels.', true, 'decode');
  }
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > maxDurationSeconds) {
    throw new AudioEngineError('duration-too-long', 'Decoded audio exceeds the eight-minute limit.', true, 'decode');
  }
  const pcmBytes = decoded.length * decoded.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(decoded.length) || pcmBytes <= 0 || pcmBytes > maxPcmBytes) {
    throw new AudioEngineError('file-too-large', 'Decoded PCM exceeds the per-deck memory limit.', true, 'decode');
  }
  beforeCopy(pcmBytes, pcmBytes);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => new Float32Array(decoded.getChannelData(channel)));
  return { channels, pcmBytes, durationSeconds: decoded.length / decoded.sampleRate };
}

export class BrowserAudioEngine implements AudioEngine {
  private headphoneMonitor: ReturnType<typeof createHeadphoneMonitor> | null = null;
  private readonly recorder = new MixRecorder();
  private readonly options: Required<AudioEngineOptions>;
  private readonly decks: Record<DeckId, DeckState> = { A: makeDeck('A'), B: makeDeck('B') };
  private readonly listeners = new Map<() => void, DeckId | undefined>();
  private readonly pending = new Map<number, PendingCommand>();
  private readonly scratchIntents = new Map<DeckId, ScratchIntent>();
  private readonly scratchTimers = new Map<DeckId, ReturnType<typeof setTimeout>>();
  private readonly cuePreviewGenerations = new Map<DeckId, number>();
  private readonly cuePreviewActive = new Set<DeckId>();
  private readonly activeLoadControllers = new Map<DeckId, Set<AbortController>>();
  private readonly fileAnalysisControllers = new Set<AbortController>();
  private readonly deckOperationTails = new Map<DeckId, Promise<void>>();
  private loadPipelineTail: Promise<void> = Promise.resolve();
  private readonly contextCloses = new WeakMap<AudioContext, Promise<void>>();
  private context: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private readonly pitchTrackRevision:Record<DeckId,number>={A:0,B:0};
  private initialization: Promise<EngineCapabilities> | null = null;
  private snapshot: AudioSnapshot;
  private commandId = 0;
  private contextsCreated = 0;
  private transportNodesCreated = 0;
  private limiterNodesCreated = 0;
  private installedPcmBytes = 0;
  private peakTransientPcmBytes = 0;
  private pendingDecodeCount = 0;
  private fault: AudioEngineError | null = null;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private cancelInitialization: ((reason: unknown) => void) | null = null;
  private initializationId = 0;

  constructor(options: AudioEngineOptions = {}) {
    const maxEncodedBytes = options.maxEncodedBytes ?? DEFAULT_MAX_ENCODED;
    const maxDecodedPcmBytes = options.maxDecodedPcmBytes ?? DEFAULT_MAX_PCM;
    const maxDurationSeconds = options.maxDurationSeconds ?? DEFAULT_MAX_DURATION;
    if (!Number.isSafeInteger(maxEncodedBytes) || maxEncodedBytes <= 0 || maxEncodedBytes > DEFAULT_MAX_ENCODED) {
      throw new RangeError('maxEncodedBytes must be a positive safe integer within the 128 MiB limit.');
    }
    if (!Number.isSafeInteger(maxDecodedPcmBytes) || maxDecodedPcmBytes <= 0 || maxDecodedPcmBytes > DEFAULT_MAX_PCM) {
      throw new RangeError('maxDecodedPcmBytes must be a positive safe integer within the 192 MiB per-deck limit.');
    }
    if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0 || maxDurationSeconds > DEFAULT_MAX_DURATION) {
      throw new RangeError('maxDurationSeconds must be finite, positive, and no greater than eight minutes.');
    }
    this.options = { maxEncodedBytes, maxDecodedPcmBytes, maxDurationSeconds, defaultPitchMode:options.defaultPitchMode??'tape' };
    if(!['tape','linked','independent'].includes(this.options.defaultPitchMode))throw new RangeError('Unsupported default pitch mode.');
    for(const deck of Object.values(this.decks))deck.pitchMode=this.options.defaultPitchMode;
    this.snapshot = this.buildSnapshot();
  }

  async startRecording(): Promise<void> {
    // Resume is initiated synchronously in the user's gesture before awaiting.
    await this.initializeFromGesture();
    this.assertRunning();
    await this.recorder.start(this.context!, this.graph!.output);
  }
  stopRecording() { return this.recorder.stop(); }
  getRecordingSnapshot() { return this.recorder.getSnapshot(); }
  subscribeRecording(listener: () => void) { return this.recorder.subscribe(listener); }
  exportRecording(): Blob { return this.recorder.export(); }
  clearRecording(): void { this.assertNotDisposed(); this.recorder.clear(); }
  restoreRecording(wav: Blob) { this.assertNotDisposed(); return this.recorder.restore(wav); }
  getHeadphoneStream(): MediaStream {
    this.assertNotDisposed(); this.assertRunning();
    this.headphoneMonitor ??= createHeadphoneMonitor(this.context!, { A: this.graph!.decks.A.output, B: this.graph!.decks.B.output });
    return this.headphoneMonitor.stream;
  }
  setHeadphoneCue(id: DeckId, enabled: boolean): void { this.getHeadphoneStream(); this.headphoneMonitor!.select(id, enabled); }
  stopHeadphoneMonitoring(): void { this.headphoneMonitor?.dispose(); this.headphoneMonitor = null; }

  initializeFromGesture(): Promise<EngineCapabilities> {
    this.assertNotDisposed();
    if (this.fault) return Promise.reject(this.fault);
    if (this.context && this.graph) {
      if (this.context.state === 'running') return Promise.resolve(this.capabilitiesFor(this.context));
      if (this.context.state === 'closed') return Promise.reject(this.error('context-unavailable', 'The audio context is closed.', 'context'));
      const existingContext = this.context;
      let resume: Promise<void>;
      try { resume = existingContext.resume(); }
      catch (cause) { return Promise.reject(asEngineError(cause, 'context-interrupted', 'context')); }
      return resume.then(() => {
        if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'context');
        if (this.context !== existingContext || existingContext.state !== 'running') {
          throw this.error('context-interrupted', 'The audio context did not resume.', 'context');
        }
        this.resumePendingTimeouts();
        this.publish();
        return this.capabilitiesFor(existingContext);
      }).catch(cause => { throw asEngineError(cause, 'context-interrupted', 'context'); });
    }
    if (this.initialization) return this.initialization;

    const context = this.createContext();
    this.context = context;
    this.contextsCreated += 1;
    context.addEventListener('statechange', this.onContextStateChange);
    this.publish();

    const initializationId = ++this.initializationId;
    let initializationCancelled = false;
    let cancel!: (reason: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { cancel = reject; });
    this.cancelInitialization = reason => {
      initializationCancelled = true;
      cancel(reason);
    };

    let resume: Promise<void>;
    try { resume = context.state === 'running' ? Promise.resolve() : context.resume(); }
    catch (cause) { resume = Promise.reject(cause); }
    let candidateGraph: AudioGraph | null = null;
    const graphCreation = createAudioGraph(context).then(graph => {
      candidateGraph = graph;
      if (initializationCancelled || this.disposed || this.context !== context || this.initializationId !== initializationId) {
        graph.dispose();
        throw this.error(this.disposed ? 'disposed' : 'context-unavailable', 'Audio graph initialization was cancelled.', 'context');
      }
      return graph;
    });

    const readiness = Promise.allSettled([resume, graphCreation]).then(results => {
      const resumeResult = results[0];
      const graphResult = results[1];
      if (resumeResult.status === 'rejected') {
        if (graphResult.status === 'fulfilled') graphResult.value.dispose();
        throw asEngineError(resumeResult.reason, 'context-interrupted', 'context');
      }
      if (graphResult.status === 'rejected') {
        throw asEngineError(graphResult.reason, 'worklet-unavailable', 'context');
      }
      const graph = graphResult.value;
      if (initializationCancelled || this.disposed || this.context !== context || this.initializationId !== initializationId) {
        graph.dispose();
        throw this.error(this.disposed ? 'disposed' : 'context-unavailable', 'Audio graph initialization was cancelled.', 'context');
      }
      if (context.state !== 'running') {
        graph.dispose();
        throw this.error('context-interrupted', 'The audio context did not enter the running state.', 'context');
      }

      this.graph = graph;
      this.transportNodesCreated += 1;
      this.limiterNodesCreated += 1;
      this.bindProcessorEvents(graph);
      for (const id of DECK_IDS) {
        const deck = this.decks[id];
        const strip = graph.decks[id];
        strip.setGainDb(deck.gainDb);
        strip.setEqDb('low', deck.eqDb.low);
        strip.setEqDb('mid', deck.eqDb.mid);
        strip.setEqDb('high', deck.eqDb.high);
        strip.setFilter(deck.filterValue);
        strip.setVolume(deck.volume);
        strip.setFx({ type: 'delay', ...deck.fx.delay });
        strip.setFx({ type: 'reverb', ...deck.fx.reverb });
        strip.setFx({ type: 'drive', ...deck.fx.drive });
        strip.setFx({ type: 'flanger', ...deck.fx.flanger });
        strip.setFx({ type: 'tremolo', ...deck.fx.tremolo });
        strip.setEffectiveBpm(deck.beatGrid ? deck.beatGrid.bpm * (1 + deck.tempoPercent / 100) : 120);
      }
      graph.mixer.setCrossfader(this.snapshot.mixer.crossfader);
      graph.mixer.setMasterVolume(this.snapshot.mixer.masterVolume);
      this.publish();
      return this.capabilitiesFor(context);
    });

    const initializing = Promise.race([readiness, cancelled]).catch(async cause => {
      initializationCancelled = true;
      candidateGraph?.dispose();
      if (this.graph && this.context === context) {
        this.graph.dispose();
        this.graph = null;
      }
      context.removeEventListener('statechange', this.onContextStateChange);
      await this.closeContextOnce(context);
      if (this.context === context) this.context = null;
      if (!this.disposed) this.publish();
      throw asEngineError(cause, 'worklet-unavailable', 'context');
    }).finally(() => {
      if (this.initialization === initializing) this.initialization = null;
      if (this.initializationId === initializationId) this.cancelInitialization = null;
    });
    this.initialization = initializing;
    return initializing;
  }
  async analyzeFile(file:File|Blob,externalSignal?:AbortSignal) {
    this.assertRunning();
    if(externalSignal?.aborted)throw this.error('aborted','File analysis was cancelled.','decode');
    if(this.fileAnalysisControllers.size)throw this.error('queue-full','A library analysis is already active.','decode');
    const controller=new AbortController(),signal=controller.signal,abort=()=>controller.abort();
    this.fileAnalysisControllers.add(controller);
    externalSignal?.addEventListener('abort',abort,{once:true});
    const check=()=>{this.assertRunning();if(signal.aborted)throw this.error('aborted','File analysis was cancelled.','decode');};
    try {
      return await this.runLoadPipeline(async()=>{
        check();const context=this.context!;
        const admitted=await inspectAudioBlob(file,{maxEncodedBytes:this.options.maxEncodedBytes,maxDecodedPcmBytes:this.options.maxDecodedPcmBytes,maxDurationSeconds:this.options.maxDurationSeconds,targetSampleRate:context.sampleRate},signal);
        check();
        const decoded=await decodePreparedFile(context,file,admitted,signal,this.options.maxDurationSeconds,this.options.maxDecodedPcmBytes,(decodedBytes,ownedBytes)=>this.recordTransient(this.installedPcmBytes+decodedBytes+ownedBytes));
        check();this.recordTransient(this.installedPcmBytes+decoded.pcmBytes);
        const analyzed=await analyzeWaveformInWorker(decoded.channels,context.sampleRate,signal);
        check();
        return Object.freeze({durationSeconds:decoded.durationSeconds,bpmAnalysis:analyzed.bpmAnalysis,keyAnalysis:analyzed.keyAnalysis});
      });
    } finally {externalSignal?.removeEventListener('abort',abort);this.fileAnalysisControllers.delete(controller);this.publish();}
  }

  async loadDeck(id: DeckId, file: File | Blob, options: { readonly signal?: AbortSignal; readonly name?: string } = {}): Promise<TrackInfo> {
    this.assertNotDisposed();
    if (options.signal?.aborted) throw this.error('aborted', 'The audio load was cancelled.', 'admission');
    if (this.pendingDecodeCount >= 2) throw this.error('queue-full', 'Two audio load jobs are already active.', 'decode');

    const deck = this.decks[id];
    this.cancelCuePreview(id);
    this.breakSyncForLoad(id);
    this.cancelScratchGesture(id);

    const generation = ++deck.loadGeneration;
    this.abortDeckLoads(id);
    const controller = new AbortController();
    const controllers = this.activeLoadControllers.get(id) ?? new Set<AbortController>();
    controllers.add(controller);
    this.activeLoadControllers.set(id, controllers);
    const externalAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const signal = controller.signal;

    deck.status = 'loading';
    if (!deck.track) deck.bpmAnalysis = Object.freeze({ status: 'analyzing', confidence: 0, candidates: Object.freeze([]) });
    deck.error = null;
    this.pendingDecodeCount += 1;
    this.publish();

    let stage: 'admission' | 'decode' | 'install' = 'admission';
    let bpmAnalysis: BpmAnalysisSnapshot | null = null;
    try {
      const track = await this.runLoadPipeline(async () => {
        if (!this.context || !this.graph) await this.initializeFromGesture();
        this.assertLoadCurrent(deck, generation, signal);
        this.assertRunning();
        const context = this.context!;
        this.assertLoadCurrent(deck, generation, signal);
        const admitted = await inspectAudioBlob(file, {
          maxEncodedBytes: this.options.maxEncodedBytes,
          maxDecodedPcmBytes: this.options.maxDecodedPcmBytes,
          maxDurationSeconds: this.options.maxDurationSeconds,
          targetSampleRate: context.sampleRate,
        }, signal);
        this.assertLoadCurrent(deck, generation, signal);

        stage = 'decode';
        const decoded = await decodePreparedFile(
          context,
          file,
          admitted,
          signal,
          this.options.maxDurationSeconds,
          this.options.maxDecodedPcmBytes,
          (decodedBytes, ownedBytes) => this.recordTransient(this.installedPcmBytes + decodedBytes + ownedBytes),
        );
        this.assertLoadCurrent(deck, generation, signal);
        this.recordTransient(this.installedPcmBytes + decoded.pcmBytes);

        let analyzed;
        try {
          analyzed = await analyzeWaveformInWorker(decoded.channels, context.sampleRate, signal);
        } catch (cause) {
          if (signal.aborted) throw this.error('aborted', 'The audio load was cancelled.', 'decode');
          throw asEngineError(cause, 'worker-unavailable', 'decode');
        }
        this.assertLoadCurrent(deck, generation, signal);
        this.assertRunning();

        bpmAnalysis = analyzed.bpmAnalysis;
        const channels = [...analyzed.channels];
        const metadata = Object.freeze({
          name: safeTrackName(file, options.name),
          format: admitted.format,
          durationSeconds: decoded.durationSeconds,
          sampleRate: context.sampleRate,
          channels: channels.length as 1 | 2,
          frameCount: channels[0].length,
          waveform: analyzed.waveform,
          keyAnalysis: analyzed.keyAnalysis,
        });
        stage = 'install';
        return this.installTrack(id, metadata, channels, decoded.pcmBytes, generation, signal);
      });

      if (signal.aborted || generation !== deck.loadGeneration) {
        const error = signal.aborted
          ? this.error('aborted', 'The audio load was cancelled.', 'install')
          : this.error('stale-load', 'A newer load or unload replaced this audio request.', 'install');
        await this.clearInstalledGeneration(id, generation);
        throw error;
      }
      if (generation === deck.loadGeneration && deck.track?.revision === track.revision) {
        const result: BpmAnalysisSnapshot = (bpmAnalysis as BpmAnalysisSnapshot | null) ?? Object.freeze({ status: 'unavailable', confidence: 0, candidates: Object.freeze([]) });
        deck.bpmAnalysis = result;
        const candidate = result.status === 'complete' ? result.candidates[0] : undefined;
        if (deck.beatGrid?.source !== 'manual' && deck.beatGrid?.source !== 'tap') {
          deck.beatGrid = candidate
            ? Object.freeze({ bpm: candidate.bpm, firstBeatSeconds: candidate.firstBeatSeconds, confidence: candidate.confidence, source: 'auto' })
            : null;
          this.sendBeatGridToProcessor(id);
          this.graph?.decks[id].setEffectiveBpm(deck.beatGrid ? deck.beatGrid.bpm * (1 + deck.tempoPercent / 100) : 120);
        }
        this.publish();
      }
      return track;
    } catch (cause) {
      const error = this.disposed
        ? this.error('disposed', 'The audio engine has been disposed.', 'engine')
        : generation !== deck.loadGeneration
          ? this.error('stale-load', 'A newer load or unload replaced this audio request.', 'install')
          : signal.aborted
            ? this.error('aborted', 'The audio load was cancelled.', stage === 'admission' ? 'admission' : 'decode')
            : asEngineError(cause, 'internal', stage);
      if (generation === deck.loadGeneration && !this.disposed) {
        deck.error = snapshotError(error);
        deck.status = deck.track ? (deck.anchor.playing ? 'playing' : 'ready') : 'error';
        this.publish();
      }
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', externalAbort);
      controllers.delete(controller);
      if (controllers.size === 0) this.activeLoadControllers.delete(id);
      this.pendingDecodeCount = Math.max(0, this.pendingDecodeCount - 1);
      this.publish();
    }
  }

  async unloadDeck(id: DeckId): Promise<CommandAck> {
    this.assertRunning();
    const deck = this.decks[id];
    this.cancelCuePreview(id);
    this.breakSyncForLoad(id);
    this.cancelScratchGesture(id);
    const generation = ++deck.loadGeneration;
    this.abortDeckLoads(id);
    deck.status = 'loading';
    deck.error = null;
    this.publish();

    return this.enqueueDeckOperation(id, async () => {
      this.assertRunning();
      const revision = deck.revision;
      const ack = await this.clearDeckForRevision(id, revision);
      this.assertNotDisposed();
      await this.graph!.decks[id].resetFx();
      this.assertNotDisposed();
      deck.beatGrid = null;
      deck.bpmAnalysis = Object.freeze({ status: 'idle', confidence: 0, candidates: Object.freeze([]) });
      this.sendBeatGridToProcessor(id);
      deck.tempoPercent = 0;
      deck.loopBeats = null;
      deck.hotCues = Array(8).fill(null);
      deck.cueSeconds = 0;
      deck.quantize = false;
      deck.sync = Object.freeze({ status: 'off', masterId: null, reason: null, phaseErrorSeconds: null });
      deck.fx = this.defaultFx();
      this.graph!.decks[id].setFx({ type: 'delay', ...deck.fx.delay });
      this.graph!.decks[id].setFx({ type: 'reverb', ...deck.fx.reverb });
      this.graph!.decks[id].setEffectiveBpm(120);
      this.installedPcmBytes = Math.max(0, this.installedPcmBytes - deck.installedPcmBytes);
      deck.installedPcmBytes = 0;
      deck.installedLoadGeneration = 0;
      deck.track = null;
      deck.loop = null;
      deck.anchor = { frame: 0, contextFrame: ack.appliedFrame, playing: false, rate: 0 };
      deck.error = null;
      deck.status = deck.loadGeneration === generation ? 'empty' : 'loading';
      this.publish();
      return ack;
    });
  }
  playDeck(id: DeckId): Promise<CommandAck> {
    this.assertDeckLoaded(id);
    this.cancelCuePreview(id);
    this.cancelScratchGesture(id);
    return this.sendCommand(id, 'play');
  }

  pauseDeck(id: DeckId): Promise<CommandAck> {
    this.assertDeckLoaded(id);
    this.cancelCuePreview(id);
    this.cancelScratchGesture(id);
    this.breakFollowersForMasterStop(id);
    return this.sendCommand(id, 'pause');
  }

  async playDecks(): Promise<readonly CommandAck[]> {
    const revisions=DECK_IDS.map(id=>this.decks[id].track?.revision);
    if(revisions.some(revision=>revision===undefined))throw this.error('invalid-value','Load both records before starting them together.','transport');
    await this.initializeFromGesture();
    for(const [index,id] of DECK_IDS.entries())if(this.decks[id].track?.revision!==revisions[index])throw this.error('stale-load','A record changed before shared playback.','transport');
    if(this.pending.size>MAX_PENDING_COMMANDS-8)throw this.error('queue-full','Not enough command slots for shared playback.','transport');
    for(const id of DECK_IDS){this.cancelCuePreview(id);this.cancelScratchGesture(id);}
    return this.sendSharedTransport('play');
  }

  pauseDecks(): Promise<readonly CommandAck[]> {
    for(const id of DECK_IDS)this.assertDeckLoaded(id);
    if(this.pending.size>MAX_PENDING_COMMANDS-8)throw this.error('queue-full','Not enough command slots for shared playback.','transport');
    for(const id of DECK_IDS){this.cancelCuePreview(id);this.cancelScratchGesture(id);this.breakFollowersForMasterStop(id);}
    return this.sendSharedTransport('pause');
  }

  setPitchSemitones(id:DeckId,semitones:number):void {
    const deck=this.requireTrack(id);
    deck.pitchSemitones=this.strictFinite(semitones,-12,12,'Tone');
    deck.pitchMode='independent';this.publish();
  }

  setPitchMode(id:DeckId,mode:'tape'|'linked'|'independent'):void {
    const deck=this.requireTrack(id);
    if(!['tape','linked','independent'].includes(mode))throw this.error('invalid-value','Unsupported pitch mode.','engine');
    deck.pitchMode=mode;this.publish();
  }

  async cueDeck(id: DeckId): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    this.cancelCuePreview(id);
    this.cancelScratchGesture(id);
    this.breakSyncForSeek(id);
    const revision = deck.revision;
    const cueFrame = deck.cueSeconds * deck.track!.sampleRate;
    const pauseAck = await this.sendCommand(id, 'pause');
    if (deck.revision !== revision || this.disposed) return pauseAck;
    await this.clearLoopBeforeCue(id, revision);
    if (deck.revision !== revision || this.disposed) return pauseAck;
    const ack = await this.sendCommand(id, 'seek', { mediaFrame: cueFrame });
    this.assertNotDisposed();
    deck.loop = null;
    deck.loopBeats = null;
    this.publish();
    return ack;
  }

  async seekDeck(id: DeckId, positionSeconds: number): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    const seconds = this.bounded(positionSeconds, 0, deck.track!.durationSeconds, 'Seek position');
    this.cancelCuePreview(id);
    this.cancelScratchGesture(id);
    this.breakSyncForSeek(id);
    return this.sendCommand(id, 'seek', { mediaFrame: Math.round(seconds * deck.track!.sampleRate) });
  }

  setGainDb(id: DeckId, gainDb: number): void {
    const value = this.bounded(gainDb, -24, 12, 'Deck gain');
    this.decks[id].gainDb = value;
    this.graph?.decks[id].setGainDb(value);
    this.publish();
  }

  setEqDb(id: DeckId, band: EqBand, gainDb: number): void {
    const value = this.bounded(gainDb, -24, 6, 'EQ gain');
    this.decks[id].eqDb[band] = value;
    this.graph?.decks[id].setEqDb(band, value);
    this.publish();
  }

  setFilter(id: DeckId, value: number): void {
    const bounded = this.bounded(value, -1, 1, 'Filter value');
    this.decks[id].filterValue = bounded;
    this.graph?.decks[id].setFilter(bounded);
    this.publish();
  }

  setVolume(id: DeckId, linear: number): void {
    const value = this.bounded(linear, 0, 1, 'Deck channel volume');
    this.decks[id].volume = value;
    this.graph?.decks[id].setVolume(value);
    this.publish();
  }

  async setLoop(id: DeckId, loop: LoopRegion | null): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    const revision = deck.revision;
    let boundedLoop: LoopRegion | null = null;
    if (loop) {
      const startSeconds = this.bounded(loop.startSeconds, 0, deck.track!.durationSeconds, 'Loop start');
      const endSeconds = this.bounded(loop.endSeconds, 0, deck.track!.durationSeconds, 'Loop end');
      if (endSeconds <= startSeconds) throw this.error('invalid-value', 'Loop end must be greater than loop start.', 'transport');
      boundedLoop = Object.freeze({ startSeconds, endSeconds });
    }
    const frameLoop = boundedLoop ? {
      startFrame: Math.round(boundedLoop.startSeconds * deck.track!.sampleRate),
      endFrame: Math.round(boundedLoop.endSeconds * deck.track!.sampleRate),
    } : null;
    if (frameLoop && frameLoop.endFrame - frameLoop.startFrame < Math.max(2, Math.max(1, Math.round(deck.track!.sampleRate * 0.005)) * 2)) {
      throw this.error('invalid-value', 'A loop must be at least 10 ms after frame rounding.', 'transport');
    }
    if (frameLoop) { this.cancelCuePreview(id); this.breakSyncForSeek(id); }
    this.cancelScratchGesture(id);
    const ack = await this.sendCommand(id, 'loop', { loop: frameLoop });
    this.assertNotDisposed();
    if (deck.revision !== revision) throw this.error('stale-load', 'The track changed before the loop command completed.', 'transport');
    deck.loop = boundedLoop;
    deck.loopBeats = null;
    this.publish();
    return ack;
  }

  async setTempo(id: DeckId, percent: number): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    const revision = deck.revision;
    const value = this.strictFinite(percent, -16, 16, 'Tempo');
    this.breakSyncForManualRate(id);
    this.breakFollowersOutsideTempoRange(id, 1 + value / 100);
    const ack = await this.sendCommand(id, 'tempo', { tempoPercent: value });
    this.assertNotDisposed();
    if (deck.revision !== revision) throw this.error('stale-load', 'The track changed before the tempo command completed.', 'transport');
    deck.tempoPercent = value;
    this.updateEffectiveBpm(id);
    this.refreshSyncSnapshots();
    this.publish();
    return ack;
  }

  beginScratch(id: DeckId): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    if (deck.scratchActive) return this.sendCommand(id, 'scratch-begin');
    const revision = deck.revision;
    this.breakSyncForScratch(id);
    deck.scratchActive = true;
    this.publish();
    let operation: Promise<CommandAck>;
    try { operation = this.sendCommand(id, 'scratch-begin'); }
    catch (cause) { deck.scratchActive = false; this.publish(); throw cause; }
    return operation.catch(cause => {
      if (deck.revision === revision) { this.clearScratchIntent(id); deck.scratchActive = false; this.publish(); }
      throw cause;
    });
  }

  updateScratch(id: DeckId, positionSeconds: number, velocity: number): void {
    const deck = this.decks[id];
    if (this.disposed || !deck.track || !deck.scratchActive || !this.graph || this.context?.state !== 'running') return;
    if (!Number.isFinite(positionSeconds) || !Number.isFinite(velocity)) throw this.error('invalid-value', 'Scratch position and velocity must be finite.', 'transport');
    const positionFrame = Math.max(0, Math.min(deck.track.frameCount - 1, positionSeconds * deck.track.sampleRate));
    const boundedVelocity = Math.max(-2, Math.min(2, velocity));
    this.scratchIntents.set(id, { positionFrame, velocity: boundedVelocity, trackRevision: deck.revision });
    if (this.scratchTimers.has(id)) return;
    const timer = setTimeout(() => { this.scratchTimers.delete(id); this.flushScratch(id); }, 16);
    this.scratchTimers.set(id, timer);
  }

  async endScratch(id: DeckId): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    this.flushScratch(id);
    this.clearScratchIntent(id);
    if (!deck.scratchActive) return this.noopAck(deck);
    deck.scratchActive = false;
    this.publish();
    try {
      return await this.sendCommand(id, 'scratch-end');
    } catch (cause) {
      this.publish();
      throw cause;
    }
  }

  async nudgeDeck(id: DeckId, deltaPercent: number): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    const delta = this.strictFinite(deltaPercent, -4, 4, 'Nudge');
    if (deck.sync.status === 'active') {
      deck.sync = Object.freeze({ status: 'unavailable', masterId: deck.sync.masterId, reason: 'manual-rate', phaseErrorSeconds: deck.sync.phaseErrorSeconds });
      await this.sendCommand(id, 'sync', { masterId: null });
    }
    const ack = await this.sendCommand(id, 'nudge', { deltaPercent: delta });
    this.publish();
    return ack;
  }

  async beginNudge(id:DeckId,deltaPercent:number):Promise<CommandAck> {
    const deck=this.requireTrack(id);
    if(deck.status!=='playing'||deck.scratchActive)throw this.error('invalid-value','Play the record before bending its tempo.','transport');
    const delta=this.strictFinite(deltaPercent,-4,4,'Nudge');
    this.breakSyncForManualRate(id);
    deck.nudgePercent=delta;this.publish();
    return this.sendCommand(id,'nudge-hold',{deltaPercent:delta});
  }

  async endNudge(id:DeckId):Promise<CommandAck> {
    const deck=this.requireTrack(id);
    deck.nudgePercent=0;this.publish();
    return this.sendCommand(id,'nudge-hold',{deltaPercent:0});
  }

  setBeatGrid(id: DeckId, grid: { readonly bpm: number; readonly firstBeatSeconds: number }, provenance?: Pick<NonNullable<DeckSnapshot['beatGrid']>, 'source' | 'confidence'>): void {
    const deck = this.requireTrack(id);
    const bpm = this.strictFinite(grid.bpm, 30, 300, 'Beat-grid BPM');
    const firstBeatSeconds = this.strictFinite(grid.firstBeatSeconds, 0, deck.track!.durationSeconds, 'First beat');
    if (firstBeatSeconds >= deck.track!.durationSeconds) throw this.error('invalid-value', 'First beat must occur before the end of the track.', 'transport');
    const confidence = provenance ? this.strictFinite(provenance.confidence, 0, 1, 'Beat-grid confidence') : 1;
    const source = provenance?.source ?? 'manual';
    if (!['auto', 'manual', 'tap'].includes(source)) throw this.error('invalid-value', 'Invalid beat-grid source.', 'transport');
    const next = Object.freeze({ bpm, firstBeatSeconds, confidence, source });
    deck.beatGrid = next;
    this.sendBeatGridToProcessor(id);
    this.updateEffectiveBpm(id);
    this.refreshSyncSnapshots();
    this.publish();
  }

  clearBeatGridOverride(id: DeckId): void {
    const deck = this.requireTrack(id);
    const candidate = deck.bpmAnalysis.status === 'complete' ? deck.bpmAnalysis.candidates[0] : undefined;
    deck.beatGrid = candidate
      ? Object.freeze({ bpm: candidate.bpm, firstBeatSeconds: candidate.firstBeatSeconds, confidence: candidate.confidence, source: 'auto' })
      : null;
    this.sendBeatGridToProcessor(id);
    this.updateEffectiveBpm(id);
    this.refreshSyncSnapshots();
    this.publish();
  }

  async syncDeck(id: DeckId, masterId: DeckId | null,options:{readonly mode?:'beat'|'tempo'}={}): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    const mode=options.mode??'beat';
    if(mode!=='beat'&&mode!=='tempo')throw this.error('invalid-value','Unsupported sync mode.','transport');
    const revision = deck.revision;
    if (masterId === null) {
      const ack = await this.sendCommand(id, 'sync', { masterId: null });
      this.assertNotDisposed();
      if (deck.revision !== revision) throw this.error('stale-load', 'The track changed before sync completed.', 'transport');
      deck.sync = Object.freeze({ status: 'off', masterId: null, reason: null, phaseErrorSeconds: null });
      this.publish();
      return ack;
    }
    if (masterId === id) throw this.error('invalid-value', 'A deck cannot sync to itself.', 'transport');
    const master = this.requireTrack(masterId);
    const masterRevision = master.revision;
    const reason = this.syncUnavailableReason(deck, master,mode);
    if (reason) {
      deck.sync = Object.freeze({ status: 'unavailable', masterId, reason, phaseErrorSeconds: null });
      this.publish();
      throw this.error('invalid-value', 'Sync is unavailable until both decks have reliable grids and a running master.', 'transport');
    }
    if (master.sync.masterId === id) {
      deck.sync = Object.freeze({ status: 'unavailable', masterId, reason: 'unreliable-grid', phaseErrorSeconds: null });
      this.publish();
      throw this.error('invalid-value', 'Cyclic deck sync is not supported.', 'transport');
    }
    const targetRate = master.beatGrid!.bpm * (1 + master.tempoPercent / 100) / deck.beatGrid!.bpm;
    const targetPercent = (targetRate - 1) * 100;
    if (targetPercent < -16 || targetPercent > 16) {
      deck.sync = Object.freeze({ status: 'unavailable', masterId, reason: 'outside-tempo-range', phaseErrorSeconds: null });
      this.publish();
      throw this.error('invalid-value', 'The decks need a tempo change outside the supported ±16% range.', 'transport');
    }
    try {
      deck.sync=Object.freeze({status:'off',masterId:null,reason:null,phaseErrorSeconds:null});
      const ack = await this.sendCommand(id, 'sync', { masterId,alignPhase:mode==='beat' });
      this.assertNotDisposed();
      if (deck.revision !== revision || master.revision !== masterRevision) throw this.error('stale-load', 'A track changed before sync completed.', 'transport');
      deck.tempoPercent = targetPercent;
      this.updateEffectiveBpm(id);
      const phaseErrorSeconds = mode==='beat'?this.measurePhaseError(deck, master):null;
      deck.sync = Object.freeze({ status: 'active', masterId, reason: null, phaseErrorSeconds,mode });
      this.publish();
      return ack;
    } catch (cause) {
      if (!this.disposed) {
        deck.sync = Object.freeze({ status: 'unavailable', masterId, reason: 'outside-tempo-range', phaseErrorSeconds: null });
        this.publish();
      }
      throw cause;
    }
  }

  setQuantize(id: DeckId, enabled: boolean): void {
    this.assertNotDisposed();
    if (typeof enabled !== 'boolean') throw this.error('invalid-value', 'Quantize state must be boolean.', 'engine');
    this.decks[id].quantize = enabled;
    this.publish();
  }

  setHotCue(id: DeckId, index: HotCueIndex, positionSeconds: number): void {
    const deck = this.requireTrack(id);
    this.assertHotCueIndex(index);
    const position = this.strictFinite(positionSeconds, 0, deck.track!.durationSeconds, 'Hot-cue position');
    deck.hotCues[index] = Object.freeze({ positionSeconds: position });
    this.publish();
  }

  clearHotCue(id: DeckId, index: HotCueIndex): void {
    this.assertNotDisposed();
    this.assertHotCueIndex(index);
    this.decks[id].hotCues[index] = null;
    this.publish();
  }

  async triggerHotCue(id: DeckId, index: HotCueIndex): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    this.assertHotCueIndex(index);
    const cue = deck.hotCues[index];
    if (!cue) throw this.error('invalid-value', 'Set this hot cue before triggering it.', 'transport');
    this.cancelCuePreview(id);
    this.cancelScratchGesture(id);
    this.breakSyncForSeek(id);
    const applyFrame = deck.quantize ? this.nextQuantizedBoundary(deck).applyFrame : undefined;
    return this.seekClearingLoop(id, cue.positionSeconds * deck.track!.sampleRate, applyFrame);
  }

  setCuePoint(id: DeckId): void {
    const deck = this.requireTrack(id);
    deck.cueSeconds = this.readPosition(id).positionSeconds;
    this.publish();
  }

  async startCuePreview(id: DeckId): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    this.cancelScratchGesture(id);
    this.breakSyncForSeek(id);
    const generation = this.beginCuePreviewGeneration(id);
    const revision = deck.revision;
    const cueFrame = deck.cueSeconds * deck.track!.sampleRate;
    try {
      await this.clearLoopBeforeCue(id, revision);
      if (!this.isCuePreviewCurrent(id, generation, revision)) return this.noopAck(deck);
      const seekAck = await this.sendCommand(id, 'seek', { mediaFrame: cueFrame });
      if (!this.isCuePreviewCurrent(id, generation, revision)) return seekAck;
      return await this.sendCommand(id, 'play');
    } catch (cause) {
      if (this.cuePreviewGenerations.get(id) === generation) this.cuePreviewActive.delete(id);
      throw cause;
    }
  }

  async endCuePreview(id: DeckId): Promise<CommandAck> {
    this.assertNotDisposed();
    const deck = this.decks[id];
    const generation = this.endCuePreviewGeneration(id);
    if (generation === null || !deck.track) return this.noopAck(deck);
    const revision = deck.revision;
    const cueFrame = deck.cueSeconds * deck.track.sampleRate;
    const pauseAck = await this.sendCommand(id, 'pause');
    if (!this.isCuePreviewGenerationCurrent(id, generation, revision)) return pauseAck;
    await this.clearLoopBeforeCue(id, revision);
    if (!this.isCuePreviewGenerationCurrent(id, generation, revision)) return pauseAck;
    return this.sendCommand(id, 'seek', { mediaFrame: cueFrame });
  }

  async beatJump(id: DeckId, beats: number): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    const count = this.strictFinite(beats, -32, 32, 'Beat jump');
    if (count === 0 || !Number.isInteger(count)) throw this.error('invalid-value', 'Beat jump must be a nonzero integer between -32 and 32.', 'transport');
    const grid = this.requireTempoGrid(deck);
    const timing = deck.quantize&&this.hasReliableGrid(deck) ? this.nextQuantizedBoundary(deck) : { applyFrame: undefined, mediaFrame: this.readPosition(id).frame };
    const target = Math.max(0, Math.min(deck.track!.frameCount - 1, timing.mediaFrame + count * 60 * deck.track!.sampleRate / grid.bpm));
    this.cancelCuePreview(id);
    this.cancelScratchGesture(id);
    this.breakSyncForSeek(id);
    return this.seekClearingLoop(id, target, timing.applyFrame);
  }

  async setBeatLoop(id: DeckId, beats: BeatDivision, savedRegion?: LoopRegion): Promise<CommandAck> {
    const deck = this.requireTrack(id);
    const revision = deck.revision;
    const grid = this.requireTempoGrid(deck);
    if (![0.25, 0.5, 1, 2, 4, 8, 16, 32].includes(beats)) throw this.error('invalid-value', 'Beat loop size is not supported.', 'transport');
    const periodFrames = 60 * deck.track!.sampleRate / grid.bpm;
    if (savedRegion !== undefined && (!savedRegion || typeof savedRegion !== 'object')) throw this.error('invalid-value', 'The saved loop region is invalid.', 'transport');
    const timing = savedRegion !== undefined ? null : deck.quantize&&this.hasReliableGrid(deck) ? this.nextQuantizedBoundary(deck) : { applyFrame: undefined, mediaFrame: this.readPosition(id).frame };
    const lengthFrames = periodFrames * beats;
    const exactRegion = savedRegion === undefined ? null : {
      startSeconds: this.strictFinite(savedRegion.startSeconds, 0, deck.track!.durationSeconds, 'Loop start'),
      endSeconds: this.strictFinite(savedRegion.endSeconds, 0, deck.track!.durationSeconds, 'Loop end'),
    };
    if (exactRegion && exactRegion.endSeconds <= exactRegion.startSeconds) throw this.error('invalid-value', 'Loop end must be greater than loop start.', 'transport');
    const startFrame = exactRegion ? Math.round(exactRegion.startSeconds * deck.track!.sampleRate) : timing!.mediaFrame;
    const endFrame = exactRegion ? Math.round(exactRegion.endSeconds * deck.track!.sampleRate) : startFrame + lengthFrames;
    if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || startFrame < 0 || endFrame > deck.track!.frameCount) {
      throw this.error('invalid-value', 'The requested beat loop does not fit at the selected position.', 'transport');
    }
    if (exactRegion && endFrame - startFrame < Math.max(2, Math.max(1, Math.round(deck.track!.sampleRate * 0.005)) * 2)) {
      throw this.error('invalid-value', 'A loop must be at least 10 ms after frame rounding.', 'transport');
    }
    this.cancelCuePreview(id);
    this.cancelScratchGesture(id);
    this.breakSyncForSeek(id);
    const ack = await this.sendCommand(id, 'loop', { loop: { startFrame, endFrame }, loopBeats: beats, applyFrame: timing?.applyFrame });
    this.assertNotDisposed();
    if (deck.revision !== revision) throw this.error('stale-load', 'The track changed before the beat loop command completed.', 'transport');
    deck.loop = Object.freeze(exactRegion ?? { startSeconds: startFrame / deck.track!.sampleRate, endSeconds: endFrame / deck.track!.sampleRate });
    deck.loopBeats = beats;
    this.publish();
    return ack;
  }

  setFx(id: DeckId, setting: DeckFxSetting): void {
    this.assertNotDisposed();
    const deck = this.decks[id];
    if (!setting || typeof setting !== 'object') throw this.error('invalid-value', 'FX settings must be an object.', 'engine');
    if (setting.type === 'delay') {
      if (typeof setting.enabled !== 'boolean') throw this.error('invalid-value', 'Delay enabled state must be boolean.', 'engine');
      this.strictFinite(setting.wet, 0, 0.5, 'Delay wet');
      this.strictFinite(setting.feedback, 0, 0.6, 'Delay feedback');
      if (![0.25, 0.5, 1].includes(setting.division)) throw this.error('invalid-value', 'Delay division must be 1/4, 1/2, or 1 beat.', 'engine');
      const { enabled, wet, feedback, division } = setting;
      deck.fx = Object.freeze({ ...deck.fx, delay: Object.freeze({ enabled, wet, feedback, division }) });
    } else if (setting.type === 'reverb') {
      if (typeof setting.enabled !== 'boolean') throw this.error('invalid-value', 'Reverb enabled state must be boolean.', 'engine');
      this.strictFinite(setting.wet, 0, 0.4, 'Reverb wet');
      const { enabled, wet } = setting;
      deck.fx = Object.freeze({ ...deck.fx, reverb: Object.freeze({ enabled, wet }) });
    } else {
      if (!['drive', 'flanger', 'tremolo'].includes(setting.type) || typeof setting.enabled !== 'boolean') throw this.error('invalid-value', 'Unsupported effect settings.', 'engine');
      this.strictFinite(setting.amount, 0, 1, 'Effect intensity');
      if (setting.type !== 'drive') this.strictFinite(setting.rate, .1, 8, 'Effect speed');
      const value = setting.type === 'drive' ? { enabled: setting.enabled, amount: setting.amount }
        : { enabled: setting.enabled, amount: setting.amount, rate: setting.rate };
      deck.fx = Object.freeze({ ...deck.fx, [setting.type]: Object.freeze(value) });
    }
    this.graph?.decks[id].setFx(setting);
    this.publish();
  }

  setCrossfader(value: number): void {
    const bounded = this.bounded(value, 0, 1, 'Crossfader');
    this.snapshot = Object.freeze({ ...this.snapshot, mixer: Object.freeze({ ...this.snapshot.mixer, crossfader: bounded }) });
    this.graph?.mixer.setCrossfader(bounded);
    this.notify();
  }

  setCrossfaderCurve(curve: CrossfaderCurve): void {
    this.assertNotDisposed();
    if (curve !== 'mix' && curve !== 'cut') throw this.error('invalid-value', 'Crossfader curve must be mix or cut.', 'engine');
    this.snapshot = Object.freeze({ ...this.snapshot, mixer: Object.freeze({ ...this.snapshot.mixer, crossfaderCurve: curve }) });
    this.graph?.mixer.setCrossfaderCurve(curve);
    this.notify();
  }

  setMasterVolume(value: number): void {
    const bounded = this.bounded(value, 0, 1, 'Master volume');
    this.snapshot = Object.freeze({ ...this.snapshot, mixer: Object.freeze({ ...this.snapshot.mixer, masterVolume: bounded }) });
    this.graph?.mixer.setMasterVolume(bounded);
    this.notify();
  }

  getSnapshot(): AudioSnapshot { return this.snapshot; }

  readPosition(id: DeckId): PositionSnapshot {
    const deck = this.decks[id];
    const context = this.context;
    const sampleRate = deck.track?.sampleRate ?? context?.sampleRate ?? 48_000;
    let frame = deck.anchor.frame;
    if (deck.anchor.playing && context?.state === 'running' && deck.track) {
      const nowFrame = Math.max(deck.anchor.contextFrame, Math.round(context.currentTime * sampleRate));
      frame += (nowFrame - deck.anchor.contextFrame) * deck.anchor.rate;
      if (deck.loop) {
        const start = deck.loop.startSeconds * sampleRate;
        const end = deck.loop.endSeconds * sampleRate;
        const length = end - start;
        if (length > 0 && (frame >= end || frame < start)) frame = start + ((frame - start) % length + length) % length;
      } else {
        frame = Math.max(0, Math.min(deck.track.frameCount, frame));
      }
    }
    const playing = deck.anchor.playing && (deck.loop !== null || !deck.track || frame < deck.track.frameCount);
    return Object.freeze({
      trackRevision: deck.revision,
      frame,
      contextFrame: deck.anchor.contextFrame,
      positionSeconds: frame / sampleRate,
      playing,
      rate: playing ? deck.anchor.rate : 0,
    });
  }

  getWaveform(id: DeckId) { return this.decks[id].track?.waveform ?? null; }

  subscribe(listener: () => void, id?: DeckId): () => void {
    this.assertNotDisposed();
    this.listeners.set(listener, id);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  async suspend(): Promise<void> {
    this.assertNotDisposed();
    const unavailable = () => !this.context || this.context.state === 'closed';
    if (unavailable()) return;
    if (['preparing', 'recording', 'stopping'].includes(this.recorder.getSnapshot().status)) {
      await this.recorder.stop('interrupted');
      this.assertNotDisposed();
      if (unavailable()) return;
    }
    // Read the live context again after the asynchronous recorder flush.
    const context = this.context;
    if (!context) return;
    try { await context.suspend(); } catch (cause) { throw asEngineError(cause, 'context-interrupted', 'context'); }
    this.assertNotDisposed();
    this.cancelScheduledForInterruption();
    this.publish();
  }

  async resume(): Promise<void> {
    this.assertNotDisposed();
    const context = this.context;
    if (!context || !this.graph) throw this.error('context-unavailable', 'Initialize audio from a user gesture before resuming.', 'context');
    try { await context.resume(); }
    catch (cause) {
      if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
      throw asEngineError(cause, 'context-interrupted', 'context');
    }
    if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
    if (this.context !== context || context.state !== 'running') {
      throw this.error('context-interrupted', 'The audio context did not resume.', 'context');
    }
    this.resumePendingTimeouts();
    this.publish();
  }

  getDiagnostics(): ResourceDiagnostics {
    const workers = workerDiagnostics();
    const active = !this.disposed && this.context !== null && this.context.state !== 'closed';
    const graph = active ? this.graph : null;
    return Object.freeze({
      contextsCreated: this.contextsCreated,
      activeContexts: active ? 1 : 0,
      transportNodesCreated: this.transportNodesCreated,
      activeTransportNodes: graph ? 1 : 0,
      limiterNodesCreated: this.limiterNodesCreated,
      activeLimiterNodes: graph ? 1 : 0,
      connectedNodeCount: (graph?.diagnostics.connectedNodeCount ?? 0) + this.recorder.activeNodes,
      activePortCount: (graph?.diagnostics.activePortCount ?? 0) + this.recorder.activeNodes,
      pitchLatencyFrames:graph&&DECK_IDS.some(id=>this.decks[id].pitchMode!=='tape')?Math.ceil(this.context!.sampleRate*.064):0,
      pitchUnderruns:graph?DECK_IDS.reduce((sum,id)=>sum+graph.pitch[id].underruns,0):0,
      installedPcmBytes: this.installedPcmBytes,
      peakTransientPcmBytes: this.peakTransientPcmBytes,
      pendingDecodeCount: this.pendingDecodeCount+this.fileAnalysisControllers.size,
      workersCreated: workers.workersCreated,
      activeWorkers: workers.activeWorkers,
      subscriptionCount: this.listeners.size,
      disposed: this.disposed,
    });
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.recorder.dispose();
    this.stopHeadphoneMonitoring();
    for(const controller of this.fileAnalysisControllers)controller.abort();
    const disposedError = this.error('disposed', 'The audio engine has been disposed.', 'engine');
    for (const id of DECK_IDS) {
      this.decks[id].loadGeneration += 1;
      this.abortDeckLoads(id);
      this.clearScratchIntent(id);
      this.cancelCuePreview(id);
    }
    this.cancelInitialization?.(disposedError);
    this.rejectPending(disposedError);

    if (this.graph) {
      this.graph.transport.port.postMessage({ type: 'cancel-scheduled', reason: 'disposed' } satisfies TransportCommand);
      this.graph.transport.removeEventListener('processorerror', this.onProcessorError);
      this.graph.limiter.removeEventListener('processorerror', this.onProcessorError);
      for(const id of DECK_IDS)this.graph.pitch[id].node.removeEventListener('processorerror',this.onProcessorError);
      this.graph.transport.port.onmessage = null;
      this.graph.dispose();
    }
    this.graph = null;
    const context = this.context;
    this.context = null;
    if (context) context.removeEventListener('statechange', this.onContextStateChange);

    for (const deck of Object.values(this.decks)) {
      deck.track = null;
      deck.status = 'empty';
      deck.anchor = { frame: 0, contextFrame: 0, playing: false, rate: 0 };
      deck.loop = null;
      deck.loopBeats = null;
      deck.tempoPercent = 0;
      deck.fx = this.defaultFx();
      deck.beatGrid = null;
      deck.scratchActive = false;
      deck.hotCues = Array(8).fill(null);
      deck.cueSeconds = 0;
      deck.quantize = false;
      deck.sync = Object.freeze({ status: 'off', masterId: null, reason: null, phaseErrorSeconds: null });
      deck.installedPcmBytes = 0;
      deck.installedLoadGeneration = 0;
      deck.error = null;
    }
    this.installedPcmBytes = 0;
    this.listeners.clear();
    this.publish();

    const closeContext = context ? this.closeContextOnce(context) : Promise.resolve();
    const initialization = this.initialization?.catch(() => undefined) ?? Promise.resolve();
    const loads = this.loadPipelineTail;
    this.disposePromise = Promise.all([closeContext, initialization, loads]).then(() => {
      this.pendingDecodeCount = 0;
      this.activeLoadControllers.clear();
      this.deckOperationTails.clear();
    });
    return this.disposePromise;
  }


  private strictFinite(value: number, minimum: number, maximum: number, label: string): number {
    this.assertNotDisposed();
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw this.error('invalid-value', label + ' is outside its supported range.', 'transport');
    }
    return value;
  }

  private assertHotCueIndex(index: HotCueIndex): void {
    if (!Number.isInteger(index) || index < 0 || index > 7) throw this.error('invalid-value', 'Hot-cue index must be an integer from 0 through 7.', 'transport');
  }

  private requireReliableGrid(deck: DeckState): BeatGridSnapshot {
    const grid = deck.beatGrid;
    if (!grid || (grid.source === 'auto' && grid.confidence < 0.75)) throw this.error('invalid-value', 'This action requires a reliable beat grid.', 'transport');
    return grid;
  }
  private requireTempoGrid(deck:DeckState):BeatGridSnapshot {
    if(!deck.beatGrid)throw this.error('invalid-value','Find or enter BPM before using beat controls.','transport');
    return deck.beatGrid;
  }
  private hasReliableGrid(deck:DeckState):boolean {return !!deck.beatGrid&&(deck.beatGrid.source!=='auto'||deck.beatGrid.confidence>=.75);}

  private nextQuantizedBoundary(deck: DeckState): QuantizedBoundary {
    const grid = this.requireReliableGrid(deck);
    const track = deck.track!;
    const beatFrames = 60 * track.sampleRate / grid.bpm;
    const position = this.readPosition(deck.id);
    const relativeBeat = (position.frame - grid.firstBeatSeconds * track.sampleRate) / beatFrames;
    let beatIndex: number;
    let applyFrame: number;
    const nowFrame = Math.max(0, Math.round((this.context?.currentTime ?? 0) * track.sampleRate));
    const minimumLead = Math.ceil(track.sampleRate * 0.05);
    if (position.playing && position.rate !== 0) {
      const direction = position.rate > 0 ? 1 : -1;
      beatIndex = direction > 0 ? Math.floor(relativeBeat + 1e-9) + 1 : Math.ceil(relativeBeat - 1e-9) - 1;
      let boundaryFrame = grid.firstBeatSeconds * track.sampleRate + beatIndex * beatFrames;
      let waitFrames = Math.max(0, (boundaryFrame - position.frame) / position.rate);
      while (waitFrames < minimumLead) {
        beatIndex += direction;
        boundaryFrame = grid.firstBeatSeconds * track.sampleRate + beatIndex * beatFrames;
        waitFrames = Math.max(0, (boundaryFrame - position.frame) / position.rate);
      }
      applyFrame = Math.ceil(nowFrame + waitFrames);
    } else {
      beatIndex = Math.floor(relativeBeat + 1e-9) + 1;
      const effective = grid.bpm * (1 + deck.tempoPercent / 100);
      applyFrame = nowFrame + Math.max(minimumLead, Math.ceil(60 * track.sampleRate / effective));
    }
    const mediaFrame = grid.firstBeatSeconds * track.sampleRate + beatIndex * beatFrames;
    if (!Number.isFinite(mediaFrame) || mediaFrame < 0 || mediaFrame >= track.frameCount) {
      throw this.error('invalid-value', 'No beat boundary remains inside the track in the playback direction.', 'transport');
    }
    return { applyFrame, mediaFrame };
  }

  private async clearLoopBeforeCue(id: DeckId, revision: number): Promise<CommandAck | null> {
    const deck = this.decks[id];
    if (!deck.loop) { deck.loopBeats = null; return null; }
    const ack = await this.sendCommand(id, 'loop', { loop: null });
    if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
    if (deck.revision !== revision) throw this.error('stale-load', 'The track changed before the loop could be cleared.', 'transport');
    deck.loop = null;
    deck.loopBeats = null;
    this.publish();
    return ack;
  }

  private async seekClearingLoop(id: DeckId, mediaFrame: number, applyFrame?: number): Promise<CommandAck> {
    const deck = this.decks[id];
    const revision = deck.revision;
    if (!deck.loop) return this.sendCommand(id, 'seek', { mediaFrame, applyFrame });
    if (applyFrame === undefined) {
      await this.clearLoopBeforeCue(id, revision);
      if (deck.revision !== revision) throw this.error('stale-load', 'The track changed before the seek completed.', 'transport');
      return this.sendCommand(id, 'seek', { mediaFrame });
    }
    if (this.pending.size > MAX_PENDING_COMMANDS - 2) throw this.error('queue-full', 'The audio command queue cannot fit a paired loop-clear and seek.', 'transport');
    const clearPromise = this.sendCommand(id, 'loop', { loop: null, applyFrame });
    const seekPromise = this.sendCommand(id, 'seek', { mediaFrame, applyFrame });
    await Promise.all([clearPromise, seekPromise]);
    if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
    if (deck.revision !== revision) throw this.error('stale-load', 'The track changed before the seek completed.', 'transport');
    deck.loop = null;
    deck.loopBeats = null;
    this.publish();
    return seekPromise;
  }

  private beginCuePreviewGeneration(id: DeckId): number {
    const generation = (this.cuePreviewGenerations.get(id) ?? 0) + 1;
    this.cuePreviewGenerations.set(id, generation);
    this.cuePreviewActive.add(id);
    return generation;
  }

  private endCuePreviewGeneration(id: DeckId): number | null {
    if (!this.cuePreviewActive.delete(id)) return null;
    const generation = (this.cuePreviewGenerations.get(id) ?? 0) + 1;
    this.cuePreviewGenerations.set(id, generation);
    return generation;
  }

  private cancelCuePreview(id: DeckId): void {
    this.cuePreviewGenerations.set(id, (this.cuePreviewGenerations.get(id) ?? 0) + 1);
    this.cuePreviewActive.delete(id);
  }

  private cancelAllCuePreviews(): void {
    for (const id of DECK_IDS) this.cancelCuePreview(id);
  }

  private isCuePreviewGenerationCurrent(id: DeckId, generation: number, revision: number): boolean {
    return !this.disposed && this.cuePreviewGenerations.get(id) === generation && this.decks[id].revision === revision;
  }

  private isCuePreviewCurrent(id: DeckId, generation: number, revision: number): boolean {
    return this.cuePreviewActive.has(id) && this.isCuePreviewGenerationCurrent(id, generation, revision);
  }

  private noopAck(deck: DeckState): CommandAck {
    const frame = Math.max(0, Math.round((this.context?.currentTime ?? 0) * (deck.track?.sampleRate ?? 48_000)));
    return Object.freeze({ commandId: this.commandId, trackRevision: deck.revision, requestedFrame: frame, appliedFrame: frame, lateFrames: 0, outcome: 'applied' });
  }

  private defaultFx(): FxSnapshot {
    return Object.freeze({
      delay: Object.freeze({ enabled: false, wet: 0.22, feedback: 0.35, division: 1 as const }),
      reverb: Object.freeze({ enabled: false, wet: 0.18 }),
      drive: Object.freeze({ enabled: false, amount: .3 }),
      flanger: Object.freeze({ enabled: false, amount: .35, rate: .4 }),
      tremolo: Object.freeze({ enabled: false, amount: .4, rate: 3 }),
    });
  }

  private breakSyncForSeek(id: DeckId): void {
    const own = this.decks[id];
    if (own.sync.status === 'active') {
      own.sync = Object.freeze({ status: 'unavailable', masterId: own.sync.masterId, reason: 'seek', phaseErrorSeconds: own.sync.phaseErrorSeconds });
      this.sendSyncOff(id);
    }
    for (const otherId of DECK_IDS) {
      const other = this.decks[otherId];
      if (otherId === id || other.sync.status !== 'active' || other.sync.masterId !== id) continue;
      other.sync = Object.freeze({ status: 'unavailable', masterId: id, reason: 'seek', phaseErrorSeconds: other.sync.phaseErrorSeconds });
      this.sendSyncOff(otherId);
    }
  }

  private breakSyncForLoad(id: DeckId): void {
    const own = this.decks[id];
    if (own.sync.status === 'active') {
      own.sync = Object.freeze({ status: 'unavailable', masterId: own.sync.masterId, reason: 'load', phaseErrorSeconds: own.sync.phaseErrorSeconds });
      this.sendSyncOff(id);
    }
    for (const otherId of DECK_IDS) {
      const other = this.decks[otherId];
      if (otherId === id || other.sync.status !== 'active' || other.sync.masterId !== id) continue;
      other.sync = Object.freeze({ status: 'unavailable', masterId: id, reason: 'load', phaseErrorSeconds: other.sync.phaseErrorSeconds });
      this.sendSyncOff(otherId);
    }
  }

  private breakFollowersForMasterStop(masterId: DeckId): void {
    for (const id of DECK_IDS) {
      const follower = this.decks[id];
      if (id === masterId || follower.sync.status !== 'active' || follower.sync.masterId !== masterId || follower.sync.mode === 'tempo') continue;
      follower.sync = Object.freeze({ status: 'unavailable', masterId, reason: 'master-stopped', phaseErrorSeconds: follower.sync.phaseErrorSeconds });
      this.sendSyncOff(id);
    }
  }

  private refreshSyncSnapshots(): void {
    if (this.disposed) return;
    for (const id of DECK_IDS) {
      const deck = this.decks[id];
      if (deck.sync.status !== 'active' || !deck.sync.masterId) continue;
      const masterId = deck.sync.masterId;
      const master = this.decks[masterId];
      const reason = this.syncUnavailableReason(deck, master);
      if (reason) {
        deck.sync = Object.freeze({ status: 'unavailable', masterId, reason, phaseErrorSeconds: deck.sync.phaseErrorSeconds });
        this.sendSyncOff(id);
        continue;
      }
      const targetRate = master.beatGrid!.bpm * (1 + master.tempoPercent / 100) / deck.beatGrid!.bpm;
      if (!Number.isFinite(targetRate) || targetRate < 0.84 || targetRate > 1.16) {
        deck.sync = Object.freeze({ status: 'unavailable', masterId, reason: 'outside-tempo-range', phaseErrorSeconds: deck.sync.phaseErrorSeconds });
        this.sendSyncOff(id);
        continue;
      }
      deck.tempoPercent = (targetRate - 1) * 100;
      this.updateEffectiveBpm(id);
      deck.sync = Object.freeze({ status: 'active', masterId, reason: null,mode:deck.sync.mode, phaseErrorSeconds: deck.sync.mode==='tempo'?null:this.measurePhaseError(deck, master) });
    }
  }

  private cancelScratchGesture(id: DeckId): void {
    const deck = this.decks[id];
    const wasActive = deck.scratchActive;
    this.clearScratchIntent(id);
    deck.scratchActive = false;
    if (!wasActive) return;
    this.publish();
    if (!deck.track || !this.graph || this.context?.state !== 'running' || this.disposed) return;
    try { void this.sendCommand(id, 'scratch-end').catch(() => undefined); } catch { /* A context transition already parks scratch in the processor. */ }
  }

  private clearAllScratchIntents(): void {
    for (const id of DECK_IDS) {
      this.clearScratchIntent(id);
      this.decks[id].scratchActive = false;
    }
    try { this.graph?.transport.port.postMessage({ type: 'release-scratch' } satisfies TransportCommand); } catch { /* A closed port already has no live gesture. */ }
  }

  private cancelScheduledForInterruption(): void {
    for(const id of DECK_IDS)this.decks[id].nudgePercent=0;
    try{this.graph?.transport.port.postMessage({type:'release-nudge'} satisfies TransportCommand);}catch{/* Context is closing. */}
    const activeCuePreviews = DECK_IDS.flatMap(id => {
      const deck = this.decks[id];
      if (!this.cuePreviewActive.has(id) || !deck.track) return [];
      return [{ id, revision: deck.revision, cueFrame: Math.round(deck.cueSeconds * deck.track.sampleRate) }];
    });
    this.pausePendingTimeouts();
    this.cancelAllCuePreviews();
    this.clearAllScratchIntents();
    try { this.graph?.transport.port.postMessage({ type: 'cancel-scheduled', reason: 'context-interrupted' } satisfies TransportCommand); } catch { /* The graph is already closing. */ }
    for (const preview of activeCuePreviews) this.parkInterruptedCuePreview(preview.id, preview.revision, preview.cueFrame);
  }

  private parkInterruptedCuePreview(id: DeckId, revision: number, cueFrame: number): void {
    const context = this.context;
    const transport = this.graph?.transport;
    if (!context || !transport || this.decks[id].revision !== revision) return;
    const requestedFrame = Math.max(0, Math.round(context.currentTime * context.sampleRate));
    const base = { requestedFrame, deckId: id, trackRevision: revision };
    try {
      transport.port.postMessage({ ...base, commandId: ++this.commandId, type: 'pause' } satisfies TransportCommand);
      transport.port.postMessage({ ...base, commandId: ++this.commandId, type: 'seek', mediaFrame: cueFrame } satisfies TransportCommand);
    } catch { /* If the graph is closing, no preview can resume from it. */ }
  }

  private syncUnavailableReason(deck: DeckState, master: DeckState,mode:'beat'|'tempo'=deck.sync.mode??'beat'): SyncSnapshot['reason'] {
    const reliable = (candidate: DeckState): boolean => !!candidate.beatGrid
      && (candidate.beatGrid.source !== 'auto' || candidate.beatGrid.confidence >= 0.75);
    if (!deck.beatGrid||!master.beatGrid||(mode==='beat'&&(!reliable(deck)||!reliable(master)))) return 'unreliable-grid';
    if (deck.scratchActive || master.scratchActive) return 'scratch';
    if (mode==='beat'&&!master.anchor.playing) return 'master-stopped';
    return null;
  }

  private measurePhaseError(deck: DeckState, master: DeckState): number | null {
    if (!deck.beatGrid || !master.beatGrid) return null;
    const slavePosition = this.readPosition(deck.id).frame;
    const masterPosition = this.readPosition(master.id).frame;
    const slavePeriod = 60 * deck.track!.sampleRate / deck.beatGrid.bpm;
    const masterPeriod = 60 * master.track!.sampleRate / master.beatGrid.bpm;
    const slavePhase = ((slavePosition - deck.beatGrid.firstBeatSeconds * deck.track!.sampleRate) / slavePeriod % 1 + 1) % 1;
    const masterPhase = ((masterPosition - master.beatGrid.firstBeatSeconds * master.track!.sampleRate) / masterPeriod % 1 + 1) % 1;
    let phase = masterPhase - slavePhase;
    if (phase > 0.5) phase -= 1;
    else if (phase < -0.5) phase += 1;
    const effectiveBpm = master.beatGrid.bpm * (1 + master.tempoPercent / 100);
    return phase * 60 / effectiveBpm;
  }

  private sendBeatGridToProcessor(id: DeckId): void {
    const deck = this.decks[id];
    if (!this.graph || !deck.track) return;
    const grid = deck.beatGrid;
    this.graph.transport.port.postMessage({
      type: 'grid', deckId: id, trackRevision: deck.revision,
      grid: grid ? { bpm: grid.bpm, firstBeatFrame: grid.firstBeatSeconds * deck.track.sampleRate } : null,
    } satisfies TransportCommand);
  }

  private updateEffectiveBpm(id: DeckId): void {
    const deck = this.decks[id];
    const bpm = deck.beatGrid ? deck.beatGrid.bpm * (1 + deck.tempoPercent / 100) : 120;
    this.graph?.decks[id].setEffectiveBpm(bpm);
  }

  private flushScratch(id: DeckId): void {
    const timer = this.scratchTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.scratchTimers.delete(id);
    const intent = this.scratchIntents.get(id);
    this.scratchIntents.delete(id);
    if (!intent || !this.graph || this.disposed) return;
    try {
      this.graph.transport.port.postMessage({ type: 'scratch-update', deckId: id, ...intent } satisfies TransportCommand);
    } catch { /* A closed processor already parks the deck during teardown. */ }
  }

  private clearScratchIntent(id: DeckId): void {
    const timer = this.scratchTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.scratchTimers.delete(id);
    this.scratchIntents.delete(id);
  }

  private sendSyncOff(id: DeckId): void {
    if (!this.graph || !this.decks[id].track || this.disposed) return;
    try { void this.sendCommand(id, 'sync', { masterId: null }).catch(() => undefined); }
    catch { /* Context teardown rejects all pending operations centrally. */ }
  }

  private breakSyncForManualRate(id: DeckId): void {
    const deck = this.decks[id];
    if (deck.sync.status !== 'active') return;
    const masterId = deck.sync.masterId;
    deck.sync = Object.freeze({ status: 'unavailable', masterId, reason: 'manual-rate', phaseErrorSeconds: deck.sync.phaseErrorSeconds });
    this.sendSyncOff(id);
  }

  private breakSyncForScratch(id: DeckId): void {
    const own = this.decks[id];
    if (own.sync.status === 'active') {
      own.sync = Object.freeze({ status: 'unavailable', masterId: own.sync.masterId, reason: 'scratch', phaseErrorSeconds: own.sync.phaseErrorSeconds });
      this.sendSyncOff(id);
    }
    for (const otherId of DECK_IDS) {
      const other = this.decks[otherId];
      if (otherId === id || other.sync.status !== 'active' || other.sync.masterId !== id) continue;
      other.sync = Object.freeze({ status: 'unavailable', masterId: id, reason: 'scratch', phaseErrorSeconds: other.sync.phaseErrorSeconds });
      this.sendSyncOff(otherId);
    }
  }

  private breakFollowersOutsideTempoRange(masterId: DeckId, masterRate: number): void {
    const master = this.decks[masterId];
    if (!master.beatGrid) return;
    for (const id of DECK_IDS) {
      const follower = this.decks[id];
      if (follower.sync.status !== 'active' || follower.sync.masterId !== masterId || !follower.beatGrid) continue;
      const followerRate = masterRate * master.beatGrid.bpm / follower.beatGrid.bpm;
      if (followerRate >= 0.84 && followerRate <= 1.16) continue;
      follower.sync = Object.freeze({ status: 'unavailable', masterId, reason: 'outside-tempo-range', phaseErrorSeconds: follower.sync.phaseErrorSeconds });
      this.sendSyncOff(id);
    }
  }

  private runLoadPipeline<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.loadPipelineTail.then(operation, operation);
    this.loadPipelineTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private abortDeckLoads(id: DeckId): void {
    for (const controller of this.activeLoadControllers.get(id) ?? []) controller.abort();
  }

  private enqueueDeckOperation<T>(id: DeckId, operation: () => Promise<T>): Promise<T> {
    const previous = this.deckOperationTails.get(id) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.deckOperationTails.set(id, tail);
    return result.finally(() => {
      if (this.deckOperationTails.get(id) === tail) this.deckOperationTails.delete(id);
    });
  }

  private installTrack(
    id: DeckId,
    metadata: Omit<TrackInfo, 'revision'>,
    channels: Float32Array[],
    pcmBytes: number,
    generation: number,
    signal: AbortSignal,
  ): Promise<TrackInfo> {
    const deck = this.decks[id];
    return this.enqueueDeckOperation(id, async () => {
      this.assertLoadCurrent(deck, generation, signal);
      this.assertRunning();
      const previousRevision = deck.revision;
      const previousBytes = deck.installedPcmBytes;
      if (deck.track || previousBytes > 0) {
        const clearAck = await this.clearDeckForRevision(id, previousRevision);
        if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
        await this.graph!.decks[id].resetFx();
        if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
        this.installedPcmBytes = Math.max(0, this.installedPcmBytes - previousBytes);
        deck.installedPcmBytes = 0;
        deck.installedLoadGeneration = 0;
        deck.track = null;
        deck.loop = null;
        deck.anchor = { frame: 0, contextFrame: clearAck.appliedFrame, playing: false, rate: 0 };
        deck.status = 'loading';
        this.publish();
        this.assertLoadCurrent(deck, generation, signal);
      }

      const revision = previousRevision + 1;
      const track: TrackInfo = Object.freeze({ ...metadata, revision });
      const ack = await this.sendCommand(id, 'install', { trackRevision: revision, channels });
      if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
      this.installedPcmBytes += pcmBytes;
      deck.installedPcmBytes = pcmBytes;
      deck.installedLoadGeneration = generation;
      deck.revision = revision;
      deck.track = track;
      deck.loop = null;
      deck.loopBeats = null;
      deck.tempoPercent = 0;
      deck.beatGrid = null;
      deck.bpmAnalysis = Object.freeze({ status: 'analyzing', confidence: 0, candidates: Object.freeze([]) });
      deck.scratchActive = false;
      deck.hotCues = Array(8).fill(null);
      deck.cueSeconds = 0;
      deck.quantize = false;
      deck.fx = this.defaultFx();
      this.graph!.decks[id].setFx({ type: 'delay', ...deck.fx.delay });
      this.graph!.decks[id].setFx({ type: 'reverb', ...deck.fx.reverb });
      this.graph!.decks[id].setEffectiveBpm(120);
      deck.sync = Object.freeze({ status: 'off', masterId: null, reason: null, phaseErrorSeconds: null });
      deck.error = null;
      deck.anchor = { frame: 0, contextFrame: ack.appliedFrame, playing: false, rate: 0 };
      if (deck.loadGeneration === generation) deck.status = 'ready';
      this.publish();
      if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
      if (signal.aborted || generation !== deck.loadGeneration) {
        const cancellation = signal.aborted
          ? this.error('aborted', 'The audio load was cancelled.', 'install')
          : this.error('stale-load', 'A newer load or unload replaced this audio request.', 'install');
        const clearAck = await this.clearDeckForRevision(id, revision);
        if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
        this.installedPcmBytes = Math.max(0, this.installedPcmBytes - deck.installedPcmBytes);
        deck.installedPcmBytes = 0;
        deck.installedLoadGeneration = 0;
        this.sendBeatGridToProcessor(id);
        deck.track = null;
        deck.loop = null;
        deck.loopBeats = null;
        deck.tempoPercent = 0;
        deck.beatGrid = null;
        deck.bpmAnalysis = Object.freeze({ status: 'idle', confidence: 0, candidates: Object.freeze([]) });
        deck.scratchActive = false;
        deck.hotCues = Array(8).fill(null);
        deck.cueSeconds = 0;
        deck.quantize = false;
        deck.sync = Object.freeze({ status: 'off', masterId: null, reason: null, phaseErrorSeconds: null });
        deck.anchor = { frame: 0, contextFrame: clearAck.appliedFrame, playing: false, rate: 0 };
        await this.graph!.decks[id].resetFx();
        if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
        deck.fx = this.defaultFx();
        this.graph!.decks[id].setFx({ type: 'delay', ...deck.fx.delay });
        this.graph!.decks[id].setFx({ type: 'reverb', ...deck.fx.reverb });
        this.graph!.decks[id].setEffectiveBpm(120);
        this.publish();
        if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
        throw cancellation;
      }
      return track;
    });
  }

  private clearInstalledGeneration(id: DeckId, generation: number): Promise<void> {
    const deck = this.decks[id];
    return this.enqueueDeckOperation(id, async () => {
      if (this.disposed || deck.installedLoadGeneration !== generation || !deck.track) return;
      const revision = deck.revision;
      const ack = await this.clearDeckForRevision(id, revision);
      if (this.disposed || deck.installedLoadGeneration !== generation) return;
      await this.graph!.decks[id].resetFx();
      if (this.disposed || deck.installedLoadGeneration !== generation) return;
      deck.fx = this.defaultFx();
      this.graph!.decks[id].setFx({ type: 'delay', ...deck.fx.delay });
      this.graph!.decks[id].setFx({ type: 'reverb', ...deck.fx.reverb });
      this.graph!.decks[id].setEffectiveBpm(120);
      deck.beatGrid = null;
      deck.bpmAnalysis = Object.freeze({ status: 'idle', confidence: 0, candidates: Object.freeze([]) });
      deck.tempoPercent = 0;
      deck.loopBeats = null;
      deck.hotCues = Array(8).fill(null);
      deck.cueSeconds = 0;
      deck.quantize = false;
      deck.sync = Object.freeze({ status: 'off', masterId: null, reason: null, phaseErrorSeconds: null });
      this.installedPcmBytes = Math.max(0, this.installedPcmBytes - deck.installedPcmBytes);
      deck.installedPcmBytes = 0;
      deck.installedLoadGeneration = 0;
      deck.track = null;
      deck.loop = null;
      deck.anchor = { frame: 0, contextFrame: ack.appliedFrame, playing: false, rate: 0 };
      this.publish();
    });
  }

  private closeContextOnce(context: AudioContext): Promise<void> {
    const existing = this.contextCloses.get(context);
    if (existing) return existing;
    let closing: Promise<void>;
    try {
      closing = context.state === 'closed'
        ? Promise.resolve()
        : Promise.resolve(context.close()).then(() => undefined).catch(() => undefined);
    } catch {
      closing = Promise.resolve();
    }
    this.contextCloses.set(context, closing);
    return closing;
  }

  private createContext(): AudioContext {
    const Context = globalThis.AudioContext;
    if (!Context) throw this.error('context-unavailable', 'Web Audio is unavailable in this browser.', 'context');
    try {
      return new Context({ latencyHint: 'interactive', sampleRate: 48_000 });
    } catch {
      try { return new Context({ latencyHint: 'interactive' }); }
      catch (cause) { throw asEngineError(cause, 'context-unavailable', 'context'); }
    }
  }

  private capabilitiesFor(context: AudioContext): EngineCapabilities {
    return Object.freeze({
      sampleRate: context.sampleRate,
      baseLatencySeconds: Number.isFinite(context.baseLatency) ? context.baseLatency : 0,
      outputLatencySeconds: Number.isFinite(context.outputLatency) ? context.outputLatency : 0,
      audioWorklet: true,
      maxChannels: 2,
    });
  }

  private bindProcessorEvents(graph: AudioGraph): void {
    graph.transport.port.onmessage = (event: MessageEvent<TransportProcessorMessage>) => this.onTransportMessage(event.data);
    graph.transport.addEventListener('processorerror', this.onProcessorError);
    graph.limiter.addEventListener('processorerror', this.onProcessorError);
    for(const id of DECK_IDS)graph.pitch[id].node.addEventListener('processorerror',this.onProcessorError);
  }

  private onTransportMessage = (message: TransportProcessorMessage): void => {
    if (message.type === 'ack') {
      const pending = this.pending.get(message.ack.commandId);
      if (!pending) return;
      if (pending.timeout !== null) clearTimeout(pending.timeout);
      pending.timeout = null;
      this.pending.delete(message.ack.commandId);
      const deck = this.decks[pending.deckId];
      if (message.position.trackRevision === deck.revision) {
        deck.anchor = { frame: message.position.frame, contextFrame: message.position.contextFrame, playing: message.position.playing, rate: message.position.rate };
        if (message.position.playing) deck.status = deck.track ? 'playing' : deck.status;
        else if (deck.track && deck.status !== 'loading' && deck.status !== 'error') deck.status = 'paused';
      }
      this.refreshSyncSnapshots();
      this.publish();
      if (this.disposed) pending.reject(this.error('disposed', 'The audio engine has been disposed.', 'engine'));
      else pending.resolve(message.ack);
      return;
    }
    if (message.type === 'error') {
      const pending = this.pending.get(message.commandId);
      if (!pending) return;
      if (pending.timeout !== null) clearTimeout(pending.timeout);
      pending.timeout = null;
      this.pending.delete(message.commandId);
      const code: AudioEngineErrorCode = message.code === 'queue-full' ? 'queue-full' : message.code === 'stale-load' ? 'stale-load' : message.code === 'invalid-value' ? 'invalid-value' : message.code === 'context-interrupted' ? 'context-interrupted' : message.code === 'disposed' ? 'disposed' : 'processor-error';
      pending.reject(this.error(code, message.message, 'transport'));
      return;
    }
    if (message.type === 'snapshot') {
      for (const id of DECK_IDS) {
        const position = message.positions[id];
        const deck = this.decks[id];
        if (position.trackRevision !== deck.revision) continue;
        deck.anchor = { frame: position.frame, contextFrame: position.contextFrame, playing: position.playing, rate: position.rate };
        if (deck.track && deck.status !== 'loading' && deck.status !== 'error') deck.status = position.playing ? 'playing' : 'paused';
      }
      this.refreshSyncSnapshots();
      this.publish();
      return;
    }
    if (message.type === 'fault') this.failProcessor(message.message);
  };

  private onProcessorError = (): void => this.failProcessor('An audio worklet processor failed.');

  private onContextStateChange = (): void => {
    if (this.context?.state !== 'running') this.recorder.interrupt();
    if (this.context?.state === 'closed') {
      this.stopHeadphoneMonitoring();
      for(const controller of this.fileAnalysisControllers)controller.abort();
      for(const id of DECK_IDS)this.decks[id].nudgePercent=0;
      this.cancelAllCuePreviews();
      this.rejectPending(this.error('context-unavailable', 'The audio context was closed.', 'context'));
      this.clearAllScratchIntents();
    } else if (this.context?.state !== 'running') {
      this.cancelScheduledForInterruption();
    } else {
      this.resumePendingTimeouts();
    }
    this.publish();
  };

  private failProcessor(message: string): void {
    this.stopHeadphoneMonitoring();
    this.recorder.interrupt();
    for(const controller of this.fileAnalysisControllers)controller.abort();
    this.fault = this.error('processor-error', message, 'transport');
    this.cancelAllCuePreviews();
    this.clearAllScratchIntents();
    this.rejectPending(this.fault);
    for (const deck of Object.values(this.decks)) {
      deck.nudgePercent=0;
      deck.status = deck.track ? 'error' : deck.status;
      deck.error = snapshotError(this.fault);
    }
    this.publish();
  }

  private rejectPending(error: AudioEngineError): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout !== null) clearTimeout(pending.timeout);
      pending.timeout = null;
      pending.reject(error);
    }
    this.pending.clear();
  }

  private pausePendingTimeouts(): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout === null) continue;
      clearTimeout(pending.timeout);
      pending.timeout = null;
    }
  }

  private resumePendingTimeouts(): void {
    if (this.context?.state !== 'running') return;
    for (const [commandId, pending] of this.pending) {
      if (pending.timeout !== null) continue;
      pending.timeout = setTimeout(() => {
        if (this.pending.get(commandId) !== pending) return;
        pending.timeout = null;
        if (this.context?.state !== 'running') return;
        this.pending.delete(commandId);
        pending.reject(this.error('processor-error', 'The audio processor did not acknowledge the command.', 'transport'));
      }, COMMAND_TIMEOUT_MS);
    }
  }

  private sendSharedTransport(type:'play'|'pause'):Promise<readonly CommandAck[]> {
    this.assertRunning();
    const applyFrame=Math.ceil((this.context!.currentTime*this.context!.sampleRate+384)/128)*128;
    const commands:SharedTransportCommand[]=[];
    const pending=DECK_IDS.map(id=>this.sendCommand(id,type,{applyFrame},commands));
    try { this.graph!.transport.port.postMessage({type:'transport-pair',applyFrame,commands:commands as [SharedTransportCommand,SharedTransportCommand]} satisfies TransportCommand); }
    catch(cause){for(const command of commands){const entry=this.pending.get(command.commandId);if(entry?.timeout)clearTimeout(entry.timeout);this.pending.delete(command.commandId);entry?.reject(asEngineError(cause,'processor-error','transport'));}}
    return Promise.all(pending);
  }

  private sendCommand(id: DeckId, type: CommandKind, details: CommandDetails = {}, batch?:SharedTransportCommand[]): Promise<CommandAck> {
    this.assertRunning();
    const graph = this.graph!;
    if (this.pending.size >= MAX_PENDING_COMMANDS) throw this.error('queue-full', 'The audio command queue is full.', 'transport');
    const commandId = ++this.commandId;
    const nowFrame = Math.max(0, Math.round(this.context!.currentTime * this.context!.sampleRate));
    const requestedFrame = details.applyFrame ?? nowFrame;
    const trackRevision = details.trackRevision ?? this.decks[id].revision;
    const base = { commandId, requestedFrame, deckId: id, trackRevision, ...(details.applyFrame === undefined ? {} : { applyFrame: details.applyFrame }) };
    let command: TransportCommand;
    if (type === 'install') {
      if (!details.channels) throw this.error('internal', 'Install command has no PCM channels.', 'engine');
      command = { ...base, type, channels: details.channels };
    } else if (type === 'seek') {
      command = { ...base, type, mediaFrame: details.mediaFrame ?? 0 };
    } else if (type === 'loop') {
      command = { ...base, type, loop: details.loop ?? null, loopBeats: details.loopBeats };
    } else if (type === 'tempo') {
      command = { ...base, type, tempoPercent: details.tempoPercent ?? 0 };
    } else if (type === 'nudge' || type === 'nudge-hold') {
      command = { ...base, type, deltaPercent: details.deltaPercent ?? 0 };
    } else if (type === 'sync') {
      command = { ...base, type, masterId: details.masterId ?? null,alignPhase:details.alignPhase };
    } else {
      command = { ...base, type };
    }
    return new Promise((resolve, reject) => {
      const pending: PendingCommand = { deckId: id, trackRevision, resolve, reject, timeout: null };
      this.pending.set(commandId, pending);
      this.resumePendingTimeouts();
      try {
        const transfer = type === 'install' ? (details.channels ?? []).map(channel => channel.buffer as ArrayBuffer) : [];
        if(batch&&(command.type==='play'||command.type==='pause'))batch.push({...command,type:command.type});
        else graph.transport.port.postMessage(command, transfer);
      } catch (cause) {
        if (pending.timeout !== null) clearTimeout(pending.timeout);
        pending.timeout = null;
        this.pending.delete(commandId);
        reject(asEngineError(cause, 'processor-error', 'transport'));
      }
    });
  }

  private clearDeckForRevision(id: DeckId, revision: number): Promise<CommandAck> {
    return this.sendCommand(id, 'clear', { trackRevision: revision });
  }

  private assertRunning(): void {
    this.assertNotDisposed();
    if (this.fault) throw this.fault;
    if (!this.context || !this.graph) throw this.error('context-unavailable', 'Initialize audio from a user gesture first.', 'context');
    if (this.context.state !== 'running') throw this.error('context-interrupted', 'Resume audio before sending transport commands.', 'context');
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw this.error('disposed', 'The audio engine has been disposed.', 'engine');
  }

  private assertDeckLoaded(id: DeckId): void {
    this.assertRunning();
    if (!this.decks[id].track) throw this.error('invalid-value', 'Load an audio track into this deck first.', 'transport');
  }

  private requireTrack(id: DeckId): DeckState {
    this.assertRunning();
    const deck = this.decks[id];
    if (!deck.track) throw this.error('invalid-value', 'Load an audio track into this deck first.', 'transport');
    return deck;
  }

  private assertLoadCurrent(deck: DeckState, generation: number, signal?: AbortSignal): void {
    if (signal?.aborted) throw this.error('aborted', 'The audio load was cancelled.', 'decode');
    if (generation !== deck.loadGeneration) throw this.error('stale-load', 'A newer load replaced this audio request.', 'install');
    this.assertNotDisposed();
  }

  private bounded(value: number, minimum: number, maximum: number, label: string): number {
    this.assertNotDisposed();
    try { return clampFinite(value, minimum, maximum, label); }
    catch (cause) { throw asEngineError(cause, 'invalid-value', 'engine'); }
  }

  private recordTransient(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_TRANSIENT_PCM_BYTES) {
      throw this.error('file-too-large', 'The estimated transient PCM exceeds the 768 MiB safety budget.', 'decode');
    }
    this.peakTransientPcmBytes = Math.max(this.peakTransientPcmBytes, bytes);
  }

  private error(code: AudioEngineErrorCode, message: string, stage: 'admission' | 'decode' | 'install' | 'transport' | 'context' | 'engine'): AudioEngineError {
    return new AudioEngineError(code, message, true, stage);
  }

  private contextState(): AudioContextState {
    if (this.disposed) return 'disposed';
    if (this.fault) return 'faulted';
    if (!this.context) return 'uninitialized';
    const state = this.context.state as string;
    if (state === 'closed') return 'closed';
    if (state === 'interrupted') return 'interrupted';
    return state === 'running' ? 'running' : 'suspended';
  }

  private publish(): void {
    if(this.graph)for(const id of DECK_IDS){
      const deck=this.decks[id];
      const revision=deck.track?.revision??0;
      if(revision!==this.pitchTrackRevision[id]){
        this.pitchTrackRevision[id]=revision;deck.pitchSemitones=0;deck.nudgePercent=0;this.graph.pitch[id].reset();
      }
      const rate=(1+deck.tempoPercent/100)*(1+deck.nudgePercent/100);
      const sourceRate=deck.scratchActive?1:rate;
      const pitch=deck.pitchMode==='linked'?12*Math.log2(sourceRate):deck.pitchSemitones;
      this.graph.pitch[id].set(pitch,sourceRate,deck.pitchMode!=='tape');
    }
    this.snapshot = this.buildSnapshot();
    this.notify();
  }

  private buildSnapshot(): AudioSnapshot {
    const decks = {} as Record<DeckId, DeckSnapshot>;
    for (const id of DECK_IDS) {
      const state = this.decks[id];
      const position = this.readPosition(id);
      const eqDb = Object.freeze({ low: state.eqDb.low, mid: state.eqDb.mid, high: state.eqDb.high });
      decks[id] = Object.freeze({
        id,
        revision: state.revision,
        status: state.status,
        track: state.track,
        positionSeconds: position.positionSeconds,
        durationSeconds: state.track?.durationSeconds ?? 0,
        gainDb: state.gainDb,
        eqDb,
        filterValue: state.filterValue,
        volume: state.volume,
        loop: state.loop ? Object.freeze({ ...state.loop }) : null,
        loopBeats: state.loopBeats,
        tempoPercent: state.tempoPercent,
        pitchSemitones: state.pitchSemitones,
        pitchMode: state.pitchMode,
        nudgePercent: state.nudgePercent,
        effectiveBpm: state.beatGrid ? state.beatGrid.bpm * (1 + state.tempoPercent / 100) : null,
        beatGrid: state.beatGrid ? Object.freeze({ ...state.beatGrid }) : null,
        bpmAnalysis: Object.freeze({
          status: state.bpmAnalysis.status,
          confidence: state.bpmAnalysis.confidence,
          candidates: Object.freeze(state.bpmAnalysis.candidates.map(candidate => Object.freeze({ ...candidate }))),
          ...(state.bpmAnalysis.tempoRange?{tempoRange:Object.freeze({...state.bpmAnalysis.tempoRange})}:{}),
        }),
        scratchActive: state.scratchActive,
        hotCues: Object.freeze(state.hotCues.map(cue => cue ? Object.freeze({ ...cue }) : null)),
        cueSeconds: state.cueSeconds,
        quantize: state.quantize,
        fx: Object.freeze({
          delay: Object.freeze({ ...state.fx.delay }),
          reverb: Object.freeze({ ...state.fx.reverb }),
          drive: Object.freeze({ ...state.fx.drive }),
          flanger: Object.freeze({ ...state.fx.flanger }),
          tremolo: Object.freeze({ ...state.fx.tremolo }),
        }),
        sync: Object.freeze({ ...state.sync }),
        error: state.error,
      });
    }
    return Object.freeze({
      contextState: this.contextState(),
      sampleRate: this.context?.sampleRate ?? null,
      decks: Object.freeze(decks),
      mixer: this.snapshot?.mixer ?? Object.freeze({ crossfader: 0.5, crossfaderCurve: 'mix', masterVolume: 1 }),
    });
  }

  private notify(id?: DeckId): void {
    for (const [listener, target] of this.listeners) if (target === undefined || target === id || id === undefined) listener();
  }
}

