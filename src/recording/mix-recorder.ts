import captureWorkletUrl from './capture-processor.ts?worker&url';
import { encodeRecordingWav } from './wav';
import { MAX_RECORDING_BYTES, MAX_RECORDING_SECONDS } from './types';
import type { CaptureMessage, RecordingSnapshot } from './types';

const frameLimit = (sampleRate: number) => Math.min(Math.floor(sampleRate * MAX_RECORDING_SECONDS), Math.floor(MAX_RECORDING_BYTES / 4));
const idleSnapshot = (revision = 0): RecordingSnapshot => Object.freeze({ revision, status: 'idle', durationSeconds: 0, maxDurationSeconds: frameLimit(48000) / 48000, sampleRate: null, bytes: 0, stopReason: null, error: null });

/** One session-local take, tapped after the limiter. Never requests a microphone. */
export class MixRecorder {
  private snapshot = idleSnapshot();
  private listeners = new Set<() => void>();
  private chunks: Int16Array[] = [];
  private blob: Blob | null = null;
  private node: AudioWorkletNode | null = null;
  private source: AudioNode | null = null;
  private modules = new WeakMap<AudioContext, Promise<void>>();
  private generation = 0;
  private disposed = false;
  private stopPromise: Promise<RecordingSnapshot> | null = null;
  private finishStop: ((snapshot: RecordingSnapshot) => void) | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  getSnapshot = (): RecordingSnapshot => this.snapshot;
  get activeNodes(): number { return this.node ? 1 : 0; }
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  async start(context: AudioContext, source: AudioNode): Promise<void> {
    if (this.disposed) throw new Error('The recorder has been disposed.');
    if (['recording', 'preparing', 'stopping'].includes(this.snapshot.status)) throw new Error('A recording is already in progress.');
    if (context.state !== 'running') throw new Error('Resume audio before recording.');
    const generation = ++this.generation;
    this.chunks = []; this.blob = null;
    const maxFrames = frameLimit(context.sampleRate);
    this.publish({ revision: generation, status: 'preparing', durationSeconds: 0, sampleRate: context.sampleRate, maxDurationSeconds: maxFrames / context.sampleRate, bytes: 0, stopReason: null, error: null });
    try {
      let loaded = this.modules.get(context);
      if (!loaded) {
        loaded = context.audioWorklet.addModule(captureWorkletUrl).catch(cause => { this.modules.delete(context); throw cause; });
        this.modules.set(context, loaded);
      }
      await loaded;
      if (this.disposed || generation !== this.generation || context.state !== 'running') throw new Error('Recording preparation was interrupted.');
      const node = new AudioWorkletNode(context, 'rimvo-mix-capture', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
        processorOptions: { maxFrames },
      });
      this.node = node; this.source = source;
      node.port.onmessage = (event: MessageEvent<CaptureMessage>) => {
        if (this.node !== node || generation !== this.generation) return;
        const message = event.data;
        if (message.type === 'chunk') {
          if (!(message.samples instanceof Int16Array) || message.samples.length % 2 || this.snapshot.bytes + message.samples.byteLength > MAX_RECORDING_BYTES) {
            this.fail('Recording data exceeded its safe memory limit.'); return;
          }
          this.chunks.push(message.samples);
          const bytes = this.snapshot.bytes + message.samples.byteLength;
          const durationSeconds = bytes / (4 * context.sampleRate);
          // Accumulate the exact frame count, publish UI at most once a second.
          const previousSecond = Math.floor(this.snapshot.durationSeconds);
          this.snapshot = Object.freeze({ ...this.snapshot, bytes, durationSeconds });
          if (Math.floor(durationSeconds) !== previousSecond) this.notify();
        } else if (message.type === 'stopped') {
          this.detach();
          this.publish({ status: this.snapshot.bytes ? 'ready' : 'idle', stopReason: message.reason });
          this.resolveStop();
        }
      };
      node.addEventListener('processorerror', this.onProcessorError);
      source.connect(node);
      // The capture output is digital silence: pulling it adds no duplicate sound.
      node.connect(context.destination);
      this.publish({ status: 'recording' });
    } catch (cause) {
      if (!this.disposed && generation === this.generation) this.fail(cause instanceof Error ? cause.message : 'Recording could not start.');
      throw cause;
    }
  }
  stop(reason: 'manual' | 'interrupted' = 'manual'): Promise<RecordingSnapshot> {
    if (this.stopPromise) return this.stopPromise;
    if (this.snapshot.status === 'preparing') {
      this.generation++;
      this.publish({ status: 'idle', stopReason: reason });
      return Promise.resolve(this.snapshot);
    }
    if (!this.node || this.snapshot.status !== 'recording') return Promise.resolve(this.snapshot);
    this.stopPromise = new Promise(resolve => { this.finishStop = resolve; });
    this.publish({ status: 'stopping' });
    // ACK follows the final partial chunk on the same ordered MessagePort.
    this.node.port.postMessage({ type: 'stop', reason });
    this.stopTimer = setTimeout(() => this.fail('Recording stopped unexpectedly. Only the captured portion is available.'), 3000);
    return this.stopPromise;
  }
  export(): Blob {
    if (this.disposed || !['ready', 'error'].includes(this.snapshot.status) || !this.snapshot.bytes || !this.snapshot.sampleRate) throw new Error('Stop a recording before saving it.');
    if (!this.blob) {
      this.blob = encodeRecordingWav(this.chunks, this.snapshot.sampleRate);
      this.chunks = [];
    }
    return this.blob;
  }
  clear(): void {
    if (['recording', 'preparing', 'stopping'].includes(this.snapshot.status)) throw new Error('Stop the recording before clearing it.');
    this.chunks = []; this.blob = null; this.publish(idleSnapshot(++this.generation));
  }
  async restore(wav: Blob): Promise<void> {
    if (this.disposed || ['recording', 'preparing', 'stopping'].includes(this.snapshot.status)) throw new Error('Stop the recording before restoring a take.');
    if (wav.size <= 44 || wav.size > MAX_RECORDING_BYTES + 44) throw new Error('The saved recording exceeds its safe memory limit.');
    const view = new DataView(await wav.slice(0, 44).arrayBuffer());
    const rate = view.getUint32(24, true), bytes = wav.size - 44;
    if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645 || view.getUint16(20, true) !== 1
      || view.getUint16(22, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(36) !== 0x64617461
      || view.getUint32(40, true) !== bytes || bytes % 4 || rate < 8000 || rate > 192000 || bytes / 4 > frameLimit(rate)) throw new Error('The saved recording is not a supported stereo WAV.');
    if (this.disposed || ['recording', 'preparing', 'stopping'].includes(this.snapshot.status)) throw new Error('Recording changed while restoring the take.');
    this.chunks = []; this.blob = wav;
    this.publish({ revision: ++this.generation, status: 'ready', durationSeconds: bytes / (rate * 4), maxDurationSeconds: frameLimit(rate) / rate, sampleRate: rate, bytes, stopReason: 'manual', error: null });
  }
  interrupt(): void { void this.stop('interrupted'); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    this.detach(); this.chunks = []; this.blob = null;
    this.modules = new WeakMap(); this.snapshot = idleSnapshot(); this.resolveStop(); this.listeners.clear();
  }
  private onProcessorError = (): void => this.fail('Recording was interrupted by an audio capture error.');
  private fail(error: string): void {
    this.detach(); this.publish({ status: 'error', stopReason: 'error', error }); this.resolveStop();
  }
  private resolveStop(): void {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    const resolve = this.finishStop; this.finishStop = null; this.stopPromise = null;
    resolve?.(this.snapshot);
  }
  private detach(): void {
    const node = this.node; this.node = null;
    if (node) {
      node.port.onmessage = null; node.removeEventListener('processorerror', this.onProcessorError);
      try { this.source?.disconnect(node); } catch { /* already disconnected */ }
      node.disconnect(); node.port.postMessage({ type: 'dispose' }); node.port.close();
    }
    this.source = null;
  }
  private publish(patch: Partial<RecordingSnapshot>): void { this.snapshot = Object.freeze({ ...this.snapshot, ...patch }); this.notify(); }
  private notify(): void { for (const listener of [...this.listeners]) listener(); }
}
