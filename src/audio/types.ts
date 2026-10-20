import type { RecordingSnapshot } from '../recording/types';
export type { RecordingSnapshot } from '../recording/types';

export type DeckId = 'A' | 'B';
export type EqBand = 'low' | 'mid' | 'high';
export type SupportedAudioFormat = 'mp3' | 'wav' | 'flac';
export type BeatDivision = 0.25 | 0.5 | 1 | 2 | 4 | 8 | 16 | 32;
export type HotCueIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type CrossfaderCurve = 'mix' | 'cut';

export type AudioContextState =
  | 'uninitialized'
  | 'running'
  | 'suspended'
  | 'interrupted'
  | 'closed'
  | 'faulted'
  | 'disposed';

export type DeckStatus = 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

export type AudioEngineErrorCode =
  | 'unsupported-format'
  | 'corrupt-file'
  | 'file-too-large'
  | 'duration-too-long'
  | 'too-many-channels'
  | 'decode-failed'
  | 'aborted'
  | 'stale-load'
  | 'worklet-unavailable'
  | 'worker-unavailable'
  | 'context-unavailable'
  | 'context-interrupted'
  | 'processor-error'
  | 'invalid-value'
  | 'queue-full'
  | 'disposed'
  | 'internal';

export interface AudioEngineErrorLike {
  readonly name: 'AudioEngineError';
  readonly code: AudioEngineErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly stage: 'admission' | 'decode' | 'install' | 'transport' | 'context' | 'engine';
}

export interface CommandAck {
  readonly commandId: number;
  readonly trackRevision: number;
  readonly requestedFrame: number;
  readonly appliedFrame: number;
  readonly lateFrames: number;
  readonly outcome: 'applied' | 'late';
}

export interface WaveformPeak {
  readonly min: number;
  readonly max: number;
}

export interface WaveformLevel {
  /** Number of decoded media frames represented by one peak pair. */
  readonly blockFrames: number;
  readonly left: readonly WaveformPeak[];
  readonly right: readonly WaveformPeak[] | null;
}

export interface WaveformData {
  readonly sampleRate: number;
  readonly frameCount: number;
  readonly channels: 1 | 2;
  readonly baseBlockFrames: number;
  readonly levels: readonly WaveformLevel[];
}

export interface BpmCandidate {
  readonly bpm: number;
  readonly confidence: number;
  readonly firstBeatSeconds: number;
}

export interface BpmAnalysisSnapshot {
  readonly status: 'idle' | 'analyzing' | 'complete' | 'unavailable';
  readonly confidence: number;
  readonly candidates: readonly BpmCandidate[];
  /** Spread of compatible regional observations; not an accuracy percentage. */
  readonly tempoRange?: {readonly minimum:number;readonly maximum:number;readonly sections:number};
}

export interface BeatGridSnapshot {
  readonly bpm: number;
  readonly firstBeatSeconds: number;
  readonly confidence: number;
  readonly source: 'auto' | 'manual' | 'tap';
}

export interface HotCueSnapshot {
  readonly positionSeconds: number;
}

export interface DelayFxSnapshot {
  readonly enabled: boolean;
  readonly wet: number;
  readonly feedback: number;
  readonly division: 0.25 | 0.5 | 1;
}

export interface ReverbFxSnapshot {
  readonly enabled: boolean;
  readonly wet: number;
}

export interface FxSnapshot {
  readonly delay: DelayFxSnapshot;
  readonly reverb: ReverbFxSnapshot;
  readonly drive: { readonly enabled: boolean; readonly amount: number };
  readonly flanger: { readonly enabled: boolean; readonly amount: number; readonly rate: number };
  readonly tremolo: { readonly enabled: boolean; readonly amount: number; readonly rate: number };
}

export type PerformanceFxSetting =
  | { readonly type: 'drive'; readonly enabled: boolean; readonly amount: number }
  | { readonly type: 'flanger' | 'tremolo'; readonly enabled: boolean; readonly amount: number; readonly rate: number };

export type SyncUnavailableReason =
  | 'unreliable-grid'
  | 'outside-tempo-range'
  | 'scratch'
  | 'seek'
  | 'load'
  | 'master-stopped'
  | 'manual-rate';

export interface SyncSnapshot {
  readonly mode?:'beat'|'tempo';
  readonly status: 'off' | 'active' | 'unavailable';
  readonly masterId: DeckId | null;
  readonly reason: SyncUnavailableReason | null;
  readonly phaseErrorSeconds: number | null;
}

export interface TrackInfo {
  readonly keyAnalysis?: KeyAnalysisSnapshot;
  readonly revision: number;
  readonly name: string;
  readonly format: SupportedAudioFormat;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly frameCount: number;
  readonly waveform: WaveformData;
}

export interface LoopRegion {
  /** Inclusive start, exclusive end, in media seconds. */
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface KeyAnalysisSnapshot {
  readonly status:'complete'|'unavailable';
  readonly tonic:number|null;
  readonly mode:'major'|'minor'|'unknown';
  readonly confidence:number;
}

export interface DeckSnapshot {
  readonly pitchSemitones: number;
  readonly pitchMode: 'tape' | 'linked' | 'independent';
  /** Temporary tempo bend; nominal tempoPercent remains unchanged. */
  readonly nudgePercent: number;
  readonly id: DeckId;
  readonly revision: number;
  readonly status: DeckStatus;
  readonly track: TrackInfo | null;
  /** Last UI-rate position publication; use readPosition for high-resolution time. */
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly gainDb: number;
  readonly eqDb: Readonly<Record<EqBand, number>>;
  /** -1 is low-pass, 0 is true bypass, +1 is high-pass. */
  readonly filterValue: number;
  readonly volume: number;
  readonly loop: LoopRegion | null;
  readonly loopBeats: BeatDivision | null;
  readonly tempoPercent: number;
  /** Grid BPM multiplied by nominal tempo ratio; null while no beat grid is available. */
  readonly effectiveBpm: number | null;
  readonly beatGrid: BeatGridSnapshot | null;
  readonly bpmAnalysis: BpmAnalysisSnapshot;
  readonly scratchActive: boolean;
  readonly hotCues: readonly (HotCueSnapshot | null)[];
  readonly cueSeconds: number;
  readonly quantize: boolean;
  readonly fx: FxSnapshot;
  readonly sync: SyncSnapshot;
  readonly error: AudioEngineErrorLike | null;
}

export interface MixerSnapshot {
  /** 0 routes A, 0.5 is equal-power center, 1 routes B. */
  readonly crossfader: number;
  readonly crossfaderCurve: CrossfaderCurve;
  /** Linear master gain in [0, 1]. */
  readonly masterVolume: number;
}

export interface AudioSnapshot {
  readonly contextState: AudioContextState;
  readonly sampleRate: number | null;
  readonly decks: Readonly<Record<DeckId, DeckSnapshot>>;
  readonly mixer: MixerSnapshot;
}

export interface PositionSnapshot {
  readonly trackRevision: number;
  /** Estimated media frame at read time, extrapolated from the latest processor anchor using AudioContext.currentTime. */
  readonly frame: number;
  /** Latest AudioWorklet currentFrame observed by the engine. */
  readonly contextFrame: number;
  readonly positionSeconds: number;
  readonly playing: boolean;
  /** Actual media-frame rate relative to context frames: negative for reverse scratch, zero when parked. */
  readonly rate: number;
}

export interface EngineCapabilities {
  readonly sampleRate: number;
  readonly baseLatencySeconds: number;
  readonly outputLatencySeconds: number;
  readonly audioWorklet: true;
  readonly maxChannels: 2;
}

export interface AudioEngineOptions {
  readonly defaultPitchMode?: 'tape' | 'linked' | 'independent';
  readonly maxEncodedBytes?: number;
  readonly maxDecodedPcmBytes?: number;
  readonly maxDurationSeconds?: number;
}

export interface ResourceDiagnostics {
  readonly contextsCreated: number;
  readonly activeContexts: number;
  readonly transportNodesCreated: number;
  readonly activeTransportNodes: number;
  readonly limiterNodesCreated: number;
  readonly activeLimiterNodes: number;
  readonly connectedNodeCount: number;
  readonly activePortCount: number;
  readonly pitchLatencyFrames:number;
  readonly pitchUnderruns:number;
  readonly installedPcmBytes: number;
  readonly peakTransientPcmBytes: number;
  readonly pendingDecodeCount: number;
  readonly workersCreated: number;
  readonly activeWorkers: number;
  readonly subscriptionCount: number;
  readonly disposed: boolean;
}

export interface AudioEngine {
  /** Record stereo master output, including FX and master volume, after limiting. */
  startRecording(): Promise<void>;
  stopRecording(): Promise<RecordingSnapshot>;
  getRecordingSnapshot(): RecordingSnapshot;
  subscribeRecording(listener: () => void): () => void;
  /** Reusable stopped take; caller chooses Save / Save as names and local delivery. */
  exportRecording(): Blob;
  clearRecording(): void;
  restoreRecording(wav: Blob): Promise<void>;
  getHeadphoneStream(): MediaStream;
  setHeadphoneCue(id: DeckId, enabled: boolean): void;
  stopHeadphoneMonitoring(): void;
  initializeFromGesture(): Promise<EngineCapabilities>;
  /** Analyze a library file without installing it or changing either deck. One bounded job at a time. */
  analyzeFile(file:File|Blob,signal?:AbortSignal):Promise<{readonly durationSeconds:number;readonly bpmAnalysis:BpmAnalysisSnapshot;readonly keyAnalysis?:KeyAnalysisSnapshot}>;
  loadDeck(
    id: DeckId,
    file: File | Blob,
    options?: { readonly signal?: AbortSignal; readonly name?: string },
  ): Promise<TrackInfo>;
  unloadDeck(id: DeckId): Promise<CommandAck>;
  playDeck(id: DeckId): Promise<CommandAck>;
  pauseDeck(id: DeckId): Promise<CommandAck>;
  playDecks(): Promise<readonly CommandAck[]>;
  pauseDecks(): Promise<readonly CommandAck[]>;
  cueDeck(id: DeckId): Promise<CommandAck>;
  seekDeck(id: DeckId, positionSeconds: number): Promise<CommandAck>;
  setGainDb(id: DeckId, gainDb: number): void;
  setEqDb(id: DeckId, band: EqBand, gainDb: number): void;
  setFilter(id: DeckId, value: number): void;
  setVolume(id: DeckId, linear: number): void;
  setLoop(id: DeckId, loop: LoopRegion | null): Promise<CommandAck>;
  setTempo(id: DeckId, percent: number): Promise<CommandAck>;
  setPitchSemitones(id: DeckId, semitones: number): void;
  setPitchMode(id: DeckId, mode: 'tape' | 'linked' | 'independent'): void;
  beginScratch(id: DeckId): Promise<CommandAck>;
  updateScratch(id: DeckId, positionSeconds: number, velocity: number): void;
  endScratch(id: DeckId): Promise<CommandAck>;
  nudgeDeck(id: DeckId, deltaPercent: number): Promise<CommandAck>;
  beginNudge(id: DeckId, deltaPercent: number): Promise<CommandAck>;
  endNudge(id: DeckId): Promise<CommandAck>;
  setBeatGrid(id: DeckId, grid: { readonly bpm: number; readonly firstBeatSeconds: number }, provenance?: Pick<BeatGridSnapshot, 'source' | 'confidence'>): void;
  clearBeatGridOverride(id: DeckId): void;
  syncDeck(id: DeckId, masterId: DeckId | null,options?:{readonly mode?:'beat'|'tempo'}): Promise<CommandAck>;
  setQuantize(id: DeckId, enabled: boolean): void;
  setHotCue(id: DeckId, index: HotCueIndex, positionSeconds: number): void;
  clearHotCue(id: DeckId, index: HotCueIndex): void;
  triggerHotCue(id: DeckId, index: HotCueIndex): Promise<CommandAck>;
  setCuePoint(id: DeckId): void;
  startCuePreview(id: DeckId): Promise<CommandAck>;
  endCuePreview(id: DeckId): Promise<CommandAck>;
  beatJump(id: DeckId, beats: number): Promise<CommandAck>;
  /** Restore a beat loop's saved bounds without recomputing them from the current grid. */
  setBeatLoop(id: DeckId, beats: BeatDivision, region?: LoopRegion): Promise<CommandAck>;
  setFx(id: DeckId, setting:
    | { readonly type: 'delay'; readonly enabled: boolean; readonly wet: number; readonly feedback: number; readonly division: 0.25 | 0.5 | 1 }
    | { readonly type: 'reverb'; readonly enabled: boolean; readonly wet: number }
    | PerformanceFxSetting
  ): void;
  setCrossfader(value: number): void;
  setCrossfaderCurve(curve: CrossfaderCurve): void;
  setMasterVolume(value: number): void;
  getSnapshot(): AudioSnapshot;
  readPosition(id: DeckId): PositionSnapshot;
  getWaveform(id: DeckId): WaveformData | null;
  subscribe(listener: () => void, id?: DeckId): () => void;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  getDiagnostics(): ResourceDiagnostics;
  dispose(): Promise<void>;
}

export interface CreateAudioGraphOptions {
  readonly transportWorkletUrl: string;
  readonly limiterWorkletUrl: string;
}

