import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, AudioEngineError } from '../../src/audio/public';
import type { AudioGraph, AudioMixerGraph, DeckAudioStrip } from '../../src/audio/audio-graph';
import type { AudioFileDescriptor } from '../../src/audio/admission';
import type { TransportCommand, TransportProcessorMessage } from '../../src/audio/protocol';
import type { WaveformAnalysisResult } from '../../src/analysis/waveform-client';
import type { CommandAck, WaveformData } from '../../src/audio/types';

const mocks = vi.hoisted(() => ({
  createAudioGraph: vi.fn(),
  inspectAudioBlob: vi.fn(),
  analyzeWaveformInWorker: vi.fn(),
  commands: [] as TransportCommand[],
  graphs: [] as FakeGraphRecord[],
}));

type FakeGraphRecord = {
  readonly graph: AudioGraph;
  readonly dispose: ReturnType<typeof vi.fn>;
};

vi.mock('../../src/audio/audio-graph', () => ({ createAudioGraph: mocks.createAudioGraph }));
vi.mock('../../src/audio/admission', () => ({
  inspectAudioBlob: mocks.inspectAudioBlob,
  safeTrackName: (_file: Blob, requested?: string) => requested ?? 'Audio track',
}));
vi.mock('../../src/analysis/waveform-client', () => ({ analyzeWaveformInWorker: mocks.analyzeWaveformInWorker }));

function makeStrip(id: 'A' | 'B'): DeckAudioStrip {
  return {
    id,
    input: {} as GainNode,
    output: {} as GainNode,
    nodeCount: 0,
    setGainDb: vi.fn(),
    setEqDb: vi.fn(),
    setFilter: vi.fn(),
    setVolume: vi.fn(),
    setFx: vi.fn(),
    setEffectiveBpm: vi.fn(),
    resetFx: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
}

function makeGraph(): FakeGraphRecord {
  const positions = {
    A: { frame: 0, playing: false, rate: 0 },
    B: { frame: 0, playing: false, rate: 0 },
  };
  const makePort = (transportPort = false) => ({
    onmessage: null as ((event: MessageEvent<TransportProcessorMessage>) => void) | null,
    postMessage(command: TransportCommand): void {
      mocks.commands.push(command);
      if(command.type==='transport-pair'){for(const item of command.commands)this.postMessage(item);return;}
      if (!transportPort || !('commandId' in command)) return;
      const state = positions[command.deckId];
      const appliedFrame = command.applyFrame ?? command.requestedFrame;
      if (command.type === 'install' || command.type === 'clear') { state.frame = 0; state.playing = false; state.rate = 0; }
      else if (command.type === 'play') { state.playing = true; state.rate = 1; }
      else if (command.type === 'pause') { state.playing = false; state.rate = 0; }
      else if (command.type === 'seek') state.frame = command.mediaFrame;
      else if (command.type === 'tempo') state.rate = 1 + command.tempoPercent / 100;
      else if (command.type === 'nudge') state.rate += command.deltaPercent / 100;
      else if (command.type === 'sync' && command.masterId === null) state.rate = 1;
      const ack = {
        commandId: command.commandId,
        trackRevision: command.trackRevision,
        requestedFrame: command.requestedFrame,
        appliedFrame,
        lateFrames: Math.max(0, appliedFrame - command.requestedFrame),
        outcome: appliedFrame > command.requestedFrame ? 'late' as const : 'applied' as const,
      };
      const message: TransportProcessorMessage = {
        type: 'ack', ack,
        position: {
          trackRevision: command.trackRevision,
          frame: state.frame,
          contextFrame: appliedFrame,
          playing: state.playing,
          rate: state.playing ? state.rate : 0,
        },
      };
      queueMicrotask(() => port.onmessage?.({ data: message } as MessageEvent<TransportProcessorMessage>));
    },
    close: vi.fn(),
  });
  const port = makePort(true);
  const limiterPort = makePort();
  const transport = {
    port,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioWorkletNode;
  const limiter = {
    port: limiterPort,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioWorkletNode;
  const mixer: AudioMixerGraph = {
    input: {} as GainNode,
    output: {} as AudioNode,
    setCrossfader: vi.fn(),
    setCrossfaderCurve: vi.fn(),
    setMasterVolume: vi.fn(),
  };
  let disposed = false;
  const dispose = vi.fn(() => {
    if (disposed) return;
    disposed = true;
    port.close();
    limiterPort.close();
  });
  const graph: AudioGraph = {
    pitch: {A:{node:{addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as AudioWorkletNode,set:vi.fn(),reset:vi.fn(),underruns:0},B:{node:{addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as AudioWorkletNode,set:vi.fn(),reset:vi.fn(),underruns:0}},
    decks: { A: makeStrip('A'), B: makeStrip('B') },
    transport,
    limiter,
    mixer,
    output: limiter,
    diagnostics: { nodeCount: 2, activePortCount: 2, connectedNodeCount: 2 },
    dispose,
  };
  const record = { graph, dispose };
  mocks.graphs.push(record);
  return record;
}

class TestAudioContext {
  static latest: TestAudioContext | null = null;
  state: AudioContextState = 'suspended';
  readonly sampleRate = 44_100;
  readonly currentTime = 0;
  readonly baseLatency = 0.01;
  readonly outputLatency = 0;
  readonly destination = {} as AudioDestinationNode;
  readonly audioWorklet = {} as AudioWorklet;
  closeCalls = 0;

  constructor(options?: AudioContextOptions) { void options; TestAudioContext.latest = this; }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    void bytes;
    const samples = new Float32Array(this.sampleRate).fill(0.1);
    return Promise.resolve({
      numberOfChannels: 1,
      duration: 1,
      length: samples.length,
      sampleRate: this.sampleRate,
      getChannelData: () => samples,
    } as unknown as AudioBuffer);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void { void type; void listener; }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void { void type; void listener; }
}

const waveform: WaveformData = {
  sampleRate: 44_100,
  frameCount: 44_100,
  channels: 1,
  baseBlockFrames: 128,
  levels: [],
};

function admitted(): AudioFileDescriptor {
  return { format: 'wav', sampleRate: 44_100, channels: 1, durationSeconds: 1 };
}

function configureMocks(): void {
  mocks.commands.length = 0;
  mocks.graphs.length = 0;
  mocks.createAudioGraph.mockReset();
  mocks.inspectAudioBlob.mockReset();
  mocks.analyzeWaveformInWorker.mockReset();
  mocks.createAudioGraph.mockImplementation(async () => makeGraph().graph);
  mocks.inspectAudioBlob.mockImplementation(async () => admitted());
  mocks.analyzeWaveformInWorker.mockImplementation(async (channels: Float32Array[]) => ({
    channels,
    waveform,
    bpmAnalysis: { status: 'unavailable', confidence: 0, candidates: [] },
  } satisfies WaveformAnalysisResult));
  vi.stubGlobal('AudioContext', TestAudioContext);
}

beforeEach(configureMocks);
afterEach(() => vi.unstubAllGlobals());

describe('BrowserAudioEngine lifecycle and admission', () => {
  it('analyzes a library file on the shared decoder without installing or changing either deck',async()=>{
    const engine=createAudioEngine();await engine.initializeFromGesture();await engine.loadDeck('B',new Blob(['playing']),{name:'playing.wav'});await engine.playDeck('B');
    const before=engine.getSnapshot(),bytes=engine.getDiagnostics().installedPcmBytes;
    const result=await engine.analyzeFile(new Blob(['library']));
    expect(result.durationSeconds).toBe(1);expect(engine.getSnapshot().decks.B.track).toBe(before.decks.B.track);expect(engine.getSnapshot().decks.B.status).toBe('playing');expect(engine.getSnapshot().decks.A.track).toBeNull();expect(engine.getDiagnostics().installedPcmBytes).toBe(bytes);expect(engine.getDiagnostics().pendingDecodeCount).toBe(0);await engine.dispose();
  });
  it('cancels a library worker on disposal and settles its owned decode job',async()=>{
    const engine=createAudioEngine();await engine.initializeFromGesture();let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});
    mocks.analyzeWaveformInWorker.mockImplementationOnce(async(_channels:Float32Array[],_rate:number,signal?:AbortSignal)=>new Promise((_resolve,reject)=>{signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});ready();}));
    const job=engine.analyzeFile(new Blob(['pending'])).catch(error=>error);await started;expect(engine.getDiagnostics().pendingDecodeCount).toBe(1);await engine.dispose();expect((await job).name).toBe('AbortError');expect(engine.getDiagnostics().pendingDecodeCount).toBe(0);expect(engine.getDiagnostics().activeContexts).toBe(0);
  });
  it('rejects unsafe constructor memory and duration limits', () => {
    expect(() => createAudioEngine({ maxEncodedBytes: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => createAudioEngine({ maxDecodedPcmBytes: 0 })).toThrow(RangeError);
    expect(() => createAudioEngine({ maxDurationSeconds: Number.NaN })).toThrow(RangeError);
  });

  it('preserves the installed track when replacement admission fails', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    const original = await engine.loadDeck('A', new Blob(['original']), { name: 'original.wav' });
    const installedBytes = engine.getDiagnostics().installedPcmBytes;
    mocks.inspectAudioBlob.mockRejectedValueOnce(new AudioEngineError('corrupt-file', 'Bad replacement.', true, 'admission'));

    await expect(engine.loadDeck('A', new Blob(['broken']), { name: 'broken.wav' }))
      .rejects.toMatchObject({ code: 'corrupt-file' });
    expect(engine.getSnapshot().decks.A.track?.name).toBe(original.name);
    expect(engine.getSnapshot().decks.A.status).toBe('ready');
    expect(engine.getDiagnostics().installedPcmBytes).toBe(installedBytes);
    await engine.dispose();
  });

  it('rejects a loop that rounds below the render kernel minimum before posting it', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    const loopsBefore = mocks.commands.filter(command => command.type === 'loop').length;

    await expect(engine.setLoop('A', { startSeconds: 0, endSeconds: 441 / 44_100 }))
      .rejects.toMatchObject({ code: 'invalid-value' });
    expect(mocks.commands.filter(command => command.type === 'loop')).toHaveLength(loopsBefore);

    await expect(engine.setLoop('A', { startSeconds: 0, endSeconds: 442 / 44_100 }))
      .resolves.toMatchObject({ trackRevision: 1 });
    await engine.dispose();
  });

  it('leaves no installed track or PCM when a snapshot listener disposes on install ack', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    engine.subscribe(() => {
      if (engine.getSnapshot().decks.A.track) void engine.dispose();
    });

    await expect(engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' }))
      .rejects.toMatchObject({ code: 'disposed' });
    await engine.dispose();
    expect(engine.getSnapshot().contextState).toBe('disposed');
    expect(engine.getSnapshot().decks.A.track).toBeNull();
    expect(engine.getDiagnostics()).toMatchObject({
      activeContexts: 0,
      activeTransportNodes: 0,
      activeLimiterNodes: 0,
      installedPcmBytes: 0,
      pendingDecodeCount: 0,
      subscriptionCount: 0,
      disposed: true,
    });
    expect(mocks.graphs[0].dispose).toHaveBeenCalledOnce();
  });

  it('rejects a loop ACK when a snapshot listener disposes the engine synchronously', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    engine.subscribe(() => { void engine.dispose(); });

    await expect(engine.setLoop('A', { startSeconds: 0, endSeconds: 442 / 44_100 }))
      .rejects.toMatchObject({ code: 'disposed' });
    await engine.dispose();
    expect(engine.getSnapshot().decks.A.loop).toBeNull();
    expect(engine.getDiagnostics()).toMatchObject({ disposed: true, installedPcmBytes: 0 });
  });

  it('returns the same pending dispose promise and awaits the context close', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    const first = engine.dispose();
    const second = engine.dispose();
    expect(second).toBe(first);
    await first;
    expect(engine.getDiagnostics().disposed).toBe(true);
  });

  it('rejects control setters after disposal', async () => {
    const engine = createAudioEngine();
    await engine.dispose();
    expect(() => engine.setGainDb('A', 0)).toThrowError(expect.objectContaining({ code: 'disposed' }));
    expect(() => engine.setCrossfader(0.5)).toThrowError(expect.objectContaining({ code: 'disposed' }));
    expect(() => engine.setMasterVolume(1)).toThrowError(expect.objectContaining({ code: 'disposed' }));
  });

  it('keeps a posted clear acknowledgement alive through a long suspension', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const engine = createAudioEngine();
    try {
      await engine.initializeFromGesture();
      await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
      await engine.playDeck('A');

      const port = mocks.graphs[0].graph.transport.port as unknown as {
        onmessage: ((event: MessageEvent<TransportProcessorMessage>) => void) | null;
        postMessage: (command: TransportCommand, transfer?: Transferable[]) => void;
      };
      const originalHandler = port.onmessage;
      const originalPost = port.postMessage.bind(port);
      let clearCommandId: number | null = null;
      let heldClearAck: MessageEvent<TransportProcessorMessage> | null = null;
      port.onmessage = event => {
        if (event.data.type === 'ack' && event.data.ack.commandId === clearCommandId) {
          heldClearAck = event;
          return;
        }
        originalHandler?.(event);
      };
      port.postMessage = (command, transfer) => {
        originalPost(command, transfer);
        if (command.type === 'clear') clearCommandId = command.commandId;
      };

      let settled = false;
      const unloading = engine.unloadDeck('A').then(
        ack => { settled = true; return { ack }; },
        error => { settled = true; return { error }; },
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(clearCommandId).not.toBeNull();

      await engine.suspend();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(settled).toBe(false);
      expect(heldClearAck).not.toBeNull();

      await engine.resume();
      port.onmessage = originalHandler;
      originalHandler?.(heldClearAck!);
      const result = await unloading;
      expect(result).toHaveProperty('ack');
      expect(engine.getSnapshot().decks.A).toMatchObject({ status: 'empty', track: null });
      expect(engine.getDiagnostics().installedPcmBytes).toBe(0);
    } finally {
      await engine.dispose();
      vi.useRealTimers();
    }
  });

  it('keeps a posted install acknowledgement and PCM accounting through suspension', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const engine = createAudioEngine();
    try {
      await engine.initializeFromGesture();
      const port = mocks.graphs[0].graph.transport.port as unknown as {
        onmessage: ((event: MessageEvent<TransportProcessorMessage>) => void) | null;
        postMessage: (command: TransportCommand, transfer?: Transferable[]) => void;
      };
      const originalHandler = port.onmessage;
      const originalPost = port.postMessage.bind(port);
      let installCommandId: number | null = null;
      let heldInstallAck: MessageEvent<TransportProcessorMessage> | null = null;
      port.onmessage = event => {
        if (event.data.type === 'ack' && event.data.ack.commandId === installCommandId) {
          heldInstallAck = event;
          return;
        }
        originalHandler?.(event);
      };
      port.postMessage = (command, transfer) => {
        originalPost(command, transfer);
        if (command.type === 'install') installCommandId = command.commandId;
      };

      let settled = false;
      const loading = engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' }).then(
        track => { settled = true; return { track }; },
        error => { settled = true; return { error }; },
      );
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      expect(installCommandId).not.toBeNull();

      await engine.suspend();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(settled).toBe(false);
      expect(heldInstallAck).not.toBeNull();

      await engine.resume();
      port.onmessage = originalHandler;
      originalHandler?.(heldInstallAck!);
      const result = await loading;
      expect(result).toHaveProperty('track');
      expect(engine.getSnapshot().decks.A).toMatchObject({ status: 'ready', track: { revision: 1 } });
      expect(engine.getDiagnostics().installedPcmBytes).toBe(44_100 * Float32Array.BYTES_PER_ELEMENT);
    } finally {
      await engine.dispose();
      vi.useRealTimers();
    }
  });

  it('rearms a pending acknowledgement timeout only after audio resumes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const engine = createAudioEngine();
    try {
      await engine.initializeFromGesture();
      await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });

      const port = mocks.graphs[0].graph.transport.port as unknown as {
        onmessage: ((event: MessageEvent<TransportProcessorMessage>) => void) | null;
        postMessage: (command: TransportCommand, transfer?: Transferable[]) => void;
      };
      const originalHandler = port.onmessage;
      const originalPost = port.postMessage.bind(port);
      let tempoCommandId: number | null = null;
      port.onmessage = event => {
        if (event.data.type === 'ack' && event.data.ack.commandId === tempoCommandId) return;
        originalHandler?.(event);
      };
      port.postMessage = (command, transfer) => {
        if (command.type === 'tempo') tempoCommandId = command.commandId;
        originalPost(command, transfer);
      };

      let settled = false;
      const changingTempo = engine.setTempo('A', 5).then(
        ack => { settled = true; return { ack }; },
        error => { settled = true; return { error }; },
      );
      expect(tempoCommandId).not.toBeNull();

      await engine.suspend();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(settled).toBe(false);

      await engine.resume();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const result = await changingTempo;
      expect(result).toHaveProperty('error');
      expect((result as { error: AudioEngineError }).error.code).toBe('processor-error');
    } finally {
      await engine.dispose();
      vi.useRealTimers();
    }
  });

  it('waits for the processor cancellation result for a future command', async () => {
    const engine = createAudioEngine();
    try {
      await engine.initializeFromGesture();
      await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
      engine.setBeatGrid('A', { bpm: 120, firstBeatSeconds: 0 });
      engine.setQuantize('A', true);

      const port = mocks.graphs[0].graph.transport.port as unknown as {
        onmessage: ((event: MessageEvent<TransportProcessorMessage>) => void) | null;
        postMessage: (command: TransportCommand, transfer?: Transferable[]) => void;
      };
      const originalPost = port.postMessage.bind(port);
      const scheduled: { command: Extract<TransportCommand, { commandId: number }> | null; cancel: (() => void) | null } = { command: null, cancel: null };
      port.postMessage = (command, transfer) => {
        if (command.type === 'loop' && command.applyFrame !== undefined) {
          mocks.commands.push(command);
          scheduled.command = command;
          return;
        }
        if (command.type === 'cancel-scheduled' && scheduled.command) {
          mocks.commands.push(command);
          scheduled.cancel = () => port.onmessage?.({
            data: {
              type: 'error',
              commandId: scheduled.command!.commandId,
              code: 'context-interrupted',
              message: 'Audio context was suspended.',
              trackRevision: scheduled.command!.trackRevision,
            },
          } as MessageEvent<TransportProcessorMessage>);
          return;
        }
        originalPost(command, transfer);
      };

      let settled = false;
      const settingLoop = engine.setBeatLoop('A', 1).then(
        ack => { settled = true; return { ack }; },
        error => { settled = true; return { error }; },
      );
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
      expect(scheduled.command?.applyFrame).toBeGreaterThan(0);

      await engine.suspend();
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      scheduled.cancel?.();
      const result = await settingLoop;
      expect(result).toHaveProperty('error');
      expect((result as { error: AudioEngineError }).error.code).toBe('context-interrupted');
      expect(engine.getSnapshot().decks.A.loop).toBeNull();
    } finally {
      await engine.dispose();
    }
  });
});

describe('BrowserAudioEngine M2 snapshot contract', () => {
  it('publishes independent tempo, analysis, cue, loop, FX, and sync defaults for both decks', () => {
    const engine = createAudioEngine();
    const snapshot = engine.getSnapshot();
    for (const id of ['A', 'B'] as const) {
      expect(snapshot.decks[id]).toMatchObject({
        tempoPercent: 0,
        effectiveBpm: null,
        beatGrid: null,
        bpmAnalysis: { status: 'idle', confidence: 0, candidates: [] },
        scratchActive: false,
        hotCues: Array(8).fill(null),
        cueSeconds: 0,
        quantize: false,
        loopBeats: null,
        fx: {
          delay: { enabled: false, wet: 0.22, feedback: 0.35, division: 1 },
          reverb: { enabled: false, wet: 0.18 },
      drive: { enabled: false, amount: .3 },
      flanger: { enabled: false, amount: .35, rate: .4 },
      tremolo: { enabled: false, amount: .4, rate: 3 },
        },
        sync: { status: 'off', masterId: null, reason: null, phaseErrorSeconds: null },
      });
    }
    expect(snapshot.mixer.crossfaderCurve).toBe('mix');
    void engine.dispose();
  });
});

describe('BrowserAudioEngine M2 command boundaries', () => {
  it('rejects a manual grid above 300 BPM or whose first beat is at the track end', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    expect(() => engine.setBeatGrid('A', { bpm: 301, firstBeatSeconds: 0 })).toThrowError(expect.objectContaining({ code: 'invalid-value' }));
    expect(() => engine.setBeatGrid('A', { bpm: 120, firstBeatSeconds: 1 })).toThrowError(expect.objectContaining({ code: 'invalid-value' }));
    await engine.dispose();
  });

  it('rejects beat loops that do not fit instead of shifting or overflowing the track', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    engine.setBeatGrid('A', { bpm: 120, firstBeatSeconds: 0 });
    const before = mocks.commands.filter(command => command.type === 'loop').length;
    await expect(engine.setBeatLoop('A', 32)).rejects.toMatchObject({ code: 'invalid-value' });
    expect(mocks.commands.filter(command => command.type === 'loop')).toHaveLength(before);
    await engine.seekDeck('A', 0.9);
    const nearEnd = mocks.commands.filter(command => command.type === 'loop').length;
    await expect(engine.setBeatLoop('A', 1)).rejects.toMatchObject({ code: 'invalid-value' });
    expect(mocks.commands.filter(command => command.type === 'loop')).toHaveLength(nearEnd);
    await engine.dispose();
  });

  it('gives quantized commands at least 50 ms lead and reports the scheduled frame as requested', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    engine.setBeatGrid('A', { bpm: 120, firstBeatSeconds: 0 });
    engine.setQuantize('A', true);
    engine.setHotCue('A', 0, 0.25);
    const ack = await engine.triggerHotCue('A', 0);
    const command = mocks.commands.filter((item): item is Extract<TransportCommand, { type: 'seek' }> => item.type === 'seek').at(-1)!;
    expect(command.applyFrame).toBeGreaterThanOrEqual(2205);
    expect(ack.requestedFrame).toBe(command.applyFrame);
    expect(ack.lateFrames).toBe(0);
    await engine.dispose();
  });

  it('clears an active loop before cueing a cue point outside that loop', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    await engine.seekDeck('A', 0.7);
    engine.setCuePoint('A');
    await engine.setLoop('A', { startSeconds: 0, endSeconds: 0.2 });
    const before = mocks.commands.length;
    await engine.cueDeck('A');
    const transition = mocks.commands.slice(before).filter(command => command.type === 'pause' || command.type === 'loop' || command.type === 'seek');
    expect(transition.map(command => command.type)).toEqual(['pause', 'loop', 'seek']);
    expect(transition[1]).toMatchObject({ type: 'loop', loop: null });
    expect(transition[2]).toMatchObject({ type: 'seek', mediaFrame: 0.7 * 44_100 });
    expect(engine.getSnapshot().decks.A.loop).toBeNull();
    await engine.dispose();
  });

  it('clears beat-loop metadata when replacing a beat loop with a manual loop', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    engine.setBeatGrid('A', { bpm: 120, firstBeatSeconds: 0 });
    await engine.setBeatLoop('A', 1);
    expect(engine.getSnapshot().decks.A.loopBeats).toBe(1);
    await engine.setLoop('A', { startSeconds: 0.1, endSeconds: 0.6 });
    expect(engine.getSnapshot().decks.A.loopBeats).toBeNull();
    await engine.dispose();
  });

  it('rejects runtime FX discriminants without mutating settings', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    const before = engine.getSnapshot().decks.A.fx;
    expect(() => engine.setFx('A', { type: 'unknown', enabled: true, wet: 0.2 } as never))
      .toThrowError(expect.objectContaining({ code: 'invalid-value' }));
    expect(engine.getSnapshot().decks.A.fx).toEqual(before);
    await engine.dispose();
  });

  it('uses one sync command to align phase and reflects the master tempo in the follower snapshot', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await Promise.all([
      engine.loadDeck('A', new Blob(['master']), { name: 'master.wav' }),
      engine.loadDeck('B', new Blob(['slave']), { name: 'slave.wav' }),
    ]);
    engine.setBeatGrid('A', { bpm: 120, firstBeatSeconds: 0 });
    engine.setBeatGrid('B', { bpm: 120, firstBeatSeconds: 0 });
    await engine.playDeck('A');
    const before = mocks.commands.length;
    await engine.syncDeck('B', 'A');
    const syncCommands = mocks.commands.slice(before).filter(command => command.type === 'sync' || command.type === 'tempo');
    expect(syncCommands.map(command => command.type)).toEqual(['sync']);
    expect(engine.getSnapshot().decks.B.sync.status).toBe('active');
    await engine.setTempo('A', 5);
    expect(engine.getSnapshot().decks.B.tempoPercent).toBeCloseTo(5, 5);
    expect(engine.getSnapshot().decks.B.effectiveBpm).toBeCloseTo(126, 5);
    await engine.dispose();
  });

  it('does not restart cue preview when release races an unresolved cue seek', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    const port = mocks.graphs[0].graph.transport.port as unknown as { onmessage: ((event: MessageEvent<TransportProcessorMessage>) => void) | null; postMessage: (command: TransportCommand, transfer?: Transferable[]) => void };
    const normalPost = port.postMessage.bind(port);
    let held: Extract<TransportCommand, { type: 'seek' }> | null = null;
    port.postMessage = (command: TransportCommand) => {
      if (command.type === 'seek' && !held) { mocks.commands.push(command); held = command; return; }
      normalPost(command);
    };
    const preview = engine.startCuePreview('A');
    await Promise.resolve();
    const release = engine.endCuePreview('A');
    await release;
    const heldSeek = held!;
    const ack: CommandAck = { commandId: heldSeek.commandId, trackRevision: heldSeek.trackRevision, requestedFrame: heldSeek.requestedFrame, appliedFrame: heldSeek.requestedFrame, lateFrames: 0, outcome: 'applied' };
    const message: TransportProcessorMessage = { type: 'ack', ack, position: { trackRevision: heldSeek.trackRevision, frame: heldSeek.mediaFrame, contextFrame: heldSeek.requestedFrame, playing: false, rate: 0 } };
    port.onmessage?.({ data: message } as MessageEvent<TransportProcessorMessage>);
    await preview;
    expect(mocks.commands.filter(command => command.type === 'play')).toHaveLength(0);
    const seeks = mocks.commands.filter((command): command is Extract<TransportCommand, { type: 'seek' }> => command.type === 'seek');
    expect(seeks).toHaveLength(2);
    await engine.dispose();
  });
});

describe('Cue preview play latch', () => {
  it('keeps playback running when Play is pressed before releasing the cue preview', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    await engine.startCuePreview('A');

    await engine.playDeck('A');
    const pauseCount = mocks.commands.filter(command => command.type === 'pause').length;
    await engine.endCuePreview('A');

    expect(mocks.commands.filter(command => command.type === 'pause')).toHaveLength(pauseCount);
    expect(engine.getSnapshot().decks.A.status).toBe('playing');
    await engine.dispose();
  });
});
describe('Interrupted cue previews', () => {
  it('ignores a held cue release after audio suspension', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    await engine.startCuePreview('A');

    await engine.suspend();
    const commandsAfterSuspend = mocks.commands.length;
    await expect(engine.endCuePreview('A')).resolves.toMatchObject({ outcome: 'applied' });
    expect(mocks.commands).toHaveLength(commandsAfterSuspend);
    await engine.dispose();
  });

  it('parks an active preview at its cue point across suspension', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    await engine.seekDeck('A', 0.25);
    engine.setCuePoint('A');
    await engine.startCuePreview('A');
    const beforeSuspend = mocks.commands.length;

    await engine.suspend();
    const interruptionCommands = mocks.commands.slice(beforeSuspend);
    const pauseIndex = interruptionCommands.findIndex(command => command.type === 'pause');
    const cueSeekIndex = interruptionCommands.findIndex(command => command.type === 'seek' && command.mediaFrame === 11_025);
    expect(pauseIndex).toBeGreaterThanOrEqual(0);
    expect(cueSeekIndex).toBeGreaterThan(pauseIndex);

    await engine.resume();
    const commandsAfterSuspend = mocks.commands.length;
    await engine.endCuePreview('A');
    expect(mocks.commands).toHaveLength(commandsAfterSuspend);
    await engine.dispose();
  });

  it('does not park playback after Play latched a cue preview', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    await engine.startCuePreview('A');
    await engine.playDeck('A');
    const beforeSuspend = mocks.commands.length;

    await engine.suspend();
    expect(mocks.commands.slice(beforeSuspend).some(command => command.type === 'pause' || command.type === 'seek')).toBe(false);
    expect(engine.getSnapshot().decks.A.status).toBe('playing');
    await engine.dispose();
  });
});

describe('Scratch transport cancellation', () => {
  it('does not flush a queued scratch update after begin is rejected', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });

    const port = mocks.graphs[0].graph.transport.port as unknown as {
      onmessage: ((event: MessageEvent<TransportProcessorMessage>) => void) | null;
      postMessage: (command: TransportCommand, transfer?: Transferable[]) => void;
    };
    const normalPost = port.postMessage.bind(port);
    let holdBegin = true;
    port.postMessage = (command, transfer) => {
      if (command.type === 'scratch-begin' && holdBegin) {
        holdBegin = false;
        mocks.commands.push(command);
        return;
      }
      normalPost(command, transfer);
    };

    const begin = engine.beginScratch('A');
    const rejected = expect(begin).rejects.toMatchObject({ code: 'queue-full' });
    engine.updateScratch('A', 0.5, -1);
    const beginCommand = mocks.commands.find(command => command.type === 'scratch-begin');
    if (!beginCommand || !('commandId' in beginCommand) || !('trackRevision' in beginCommand)) throw new Error('Expected the scratch-begin command to be held');

    port.onmessage?.({
      data: {
        type: 'error',
        commandId: beginCommand.commandId,
        code: 'queue-full',
        message: 'Simulated scratch-begin rejection',
        trackRevision: beginCommand.trackRevision,
      },
    } as MessageEvent<TransportProcessorMessage>);
    await rejected;

    await new Promise(resolve => setTimeout(resolve, 40));
    const updates = mocks.commands.filter(command => command.type === 'scratch-update');
    await engine.dispose();
    expect(updates).toHaveLength(0);
  });

  it('cancels a scratch gesture before pause so a later release is inert', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    await engine.playDeck('A');
    await engine.beginScratch('A');
    engine.updateScratch('A', 0.5, 1);
    const beforePause = mocks.commands.length;

    await engine.pauseDeck('A');
    expect(engine.getSnapshot().decks.A.scratchActive).toBe(false);
    expect(mocks.commands.slice(beforePause).map(command => command.type)).toEqual(['scratch-end', 'pause']);
    const scratchEndCount = mocks.commands.filter(command => command.type === 'scratch-end').length;
    await engine.endScratch('A');
    expect(mocks.commands.filter(command => command.type === 'scratch-end')).toHaveLength(scratchEndCount);
    await engine.dispose();
  });

  it('cancels a scratch gesture before seek so a later release is inert', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    await engine.playDeck('A');
    await engine.beginScratch('A');
    engine.updateScratch('A', 0.5, 1);
    const beforeSeek = mocks.commands.length;

    await engine.seekDeck('A', 0.3);
    expect(engine.getSnapshot().decks.A.scratchActive).toBe(false);
    expect(mocks.commands.slice(beforeSeek).map(command => command.type)).toEqual(['scratch-end', 'seek']);
    const scratchEndCount = mocks.commands.filter(command => command.type === 'scratch-end').length;
    await engine.endScratch('A');
    expect(mocks.commands.filter(command => command.type === 'scratch-end')).toHaveLength(scratchEndCount);
    await engine.dispose();
  });
});

describe('FX track lifecycle', () => {
  it('resets effect history and returns new tracks to disabled defaults', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    await engine.loadDeck('A', new Blob(['first']), { name: 'first.wav' });
    engine.setFx('A', { type: 'delay', enabled: true, wet: 0.3, feedback: 0.4, division: 0.5 });
    await engine.loadDeck('A', new Blob(['second']), { name: 'second.wav' });
    expect(mocks.graphs[0].graph.decks.A.resetFx).toHaveBeenCalledOnce();
    expect(engine.getSnapshot().decks.A.fx).toEqual({
      delay: { enabled: false, wet: 0.22, feedback: 0.35, division: 1 },
      reverb: { enabled: false, wet: 0.18 },
      drive: { enabled: false, amount: .3 },
      flanger: { enabled: false, amount: .35, rate: .4 },
      tremolo: { enabled: false, amount: .4, rate: 3 },
    });
    await engine.dispose();
  });
});

describe('BPM installation', () => {
  it('uses uncertain BPM for an unquantized loop and tempo sync without claiming phase alignment',async()=>{
    mocks.analyzeWaveformInWorker.mockImplementation(async(channels:Float32Array[])=>({channels,waveform,bpmAnalysis:{status:'complete',confidence:.6,candidates:[{bpm:120,firstBeatSeconds:0,confidence:.6}],tempoRange:{minimum:119.5,maximum:120.5,sections:5}}}));
    const engine=createAudioEngine();await engine.initializeFromGesture();await engine.loadDeck('A',new Blob(['a']));await engine.loadDeck('B',new Blob(['b']));
    expect(engine.getSnapshot().decks.A.bpmAnalysis.tempoRange).toEqual({minimum:119.5,maximum:120.5,sections:5});expect(Object.isFrozen(engine.getSnapshot().decks.A.bpmAnalysis.tempoRange)).toBe(true);
    engine.setQuantize('A',true);await engine.setBeatLoop('A',1);expect(engine.getSnapshot().decks.A.loop).toEqual({startSeconds:0,endSeconds:.5});const loop=[...mocks.commands].reverse().find(c=>c.type==='loop');expect(loop).not.toHaveProperty('applyFrame');
    await engine.syncDeck('B','A',{mode:'tempo'});expect(engine.getSnapshot().decks.B.sync).toMatchObject({status:'active',mode:'tempo',phaseErrorSeconds:null});expect([...mocks.commands].reverse().find(c=>c.type==='sync')).toMatchObject({alignPhase:false});
    expect(engine.getSnapshot().decks.B.beatGrid?.confidence).toBe(.6);await engine.playDeck('A');await engine.pauseDeck('A');expect(engine.getSnapshot().decks.B.sync).toMatchObject({status:'active',mode:'tempo'});await engine.dispose();
  });
  it('publishes temporary nudge without changing the saved tempo and retains a common delay in Linked mode',async()=>{
    const engine=createAudioEngine({defaultPitchMode:'linked'});await engine.initializeFromGesture();await engine.loadDeck('A',new Blob(['a']));engine.setBeatGrid('A',{bpm:120,firstBeatSeconds:0});await engine.playDeck('A');
    await engine.setTempo('A',16);expect(mocks.graphs[0].graph.pitch.A.set).toHaveBeenLastCalledWith(12*Math.log2(1.16),1.16,true);
    await engine.beginNudge('A',4);expect(engine.getSnapshot().decks.A).toMatchObject({nudgePercent:4,tempoPercent:16,effectiveBpm:139.2});
    expect(mocks.graphs[0].graph.pitch.A.set).toHaveBeenLastCalledWith(12*Math.log2(1.16*1.04),1.16*1.04,true);
    await engine.endNudge('A');expect(engine.getSnapshot().decks.A.nudgePercent).toBe(0);
    engine.setPitchSemitones('A',3);expect(engine.getSnapshot().decks.A.pitchMode).toBe('independent');expect(mocks.graphs[0].graph.pitch.A.set).toHaveBeenLastCalledWith(3,1.16,true);await engine.dispose();
  });
  it('shows an uncertain tempo estimate but still refuses beat-accurate sync until confirmed',async()=>{
    mocks.analyzeWaveformInWorker.mockImplementation(async(channels:Float32Array[])=>({channels,waveform,bpmAnalysis:{status:'complete',confidence:.6,candidates:[{bpm:120,firstBeatSeconds:0,confidence:.6}]}}));
    const engine=createAudioEngine();await engine.initializeFromGesture();
    await engine.loadDeck('A',new Blob(['a']));await engine.loadDeck('B',new Blob(['b']));await engine.playDeck('A');
    expect(engine.getSnapshot().decks.A.effectiveBpm).toBe(120);
    await expect(engine.syncDeck('B','A')).rejects.toMatchObject({code:'invalid-value'});
    expect(engine.getSnapshot().decks.B.sync.reason).toBe('unreliable-grid');await engine.dispose();
  });
  it('installs a reliable worker grid and exposes its nominal BPM as the default tempo', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    mocks.analyzeWaveformInWorker.mockImplementationOnce(async (channels: Float32Array[]) => ({
      channels,
      waveform,
      bpmAnalysis: {
        status: 'complete' as const,
        confidence: 0.94,
        candidates: [
          { bpm: 123, confidence: 0.94, firstBeatSeconds: 0.125 },
          { bpm: 61.5, confidence: 0.68, firstBeatSeconds: 0.125 },
          { bpm: 246, confidence: 0.68, firstBeatSeconds: 0.125 },
        ],
      },
    }));

    await engine.loadDeck('A', new Blob(['tone']), { name: 'tone.wav' });
    expect(engine.getSnapshot().decks.A).toMatchObject({
      bpmAnalysis: { status: 'complete', confidence: 0.94 },
      beatGrid: { bpm: 123, firstBeatSeconds: 0.125, confidence: 0.94, source: 'auto' },
      effectiveBpm: 123,
    });
    await engine.dispose();
  });

});

describe('AudioContext state reporting', () => {
  it('preserves a native interrupted state in the public snapshot', async () => {
    const engine = createAudioEngine();
    await engine.initializeFromGesture();
    const context = TestAudioContext.latest;
    if (!context) throw new Error('AudioContext was not constructed.');

    (context as unknown as { state: string }).state = 'interrupted';
    engine.setGainDb('A', -3);

    expect(engine.getSnapshot().contextState).toBe('interrupted');
    await engine.dispose();
  });
});
