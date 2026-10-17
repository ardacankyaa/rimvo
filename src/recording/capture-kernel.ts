import { CAPTURE_CHUNK_FRAMES } from './types';
import type { CaptureMessage } from './types';

/** Runs on the audio thread. Time and limits count rendered frames. */
export class StereoCaptureKernel {
  private buffer = new Int16Array(CAPTURE_CHUNK_FRAMES * 2);
  private used = 0;
  private frames = 0;
  private stopped = false;
  constructor(private readonly maxFrames: number, private readonly send: (message: CaptureMessage, transfer?: Transferable[]) => void) {
    if (!Number.isSafeInteger(maxFrames) || maxFrames < 1) throw new RangeError('Invalid recording frame limit.');
  }
  process(left: Float32Array, right: Float32Array = left): void {
    if (this.stopped) return;
    for (let index = 0; index < left.length && !this.stopped; index++) {
      this.buffer[this.used++] = this.pcm16(left[index]);
      this.buffer[this.used++] = this.pcm16(right[index] ?? left[index]);
      this.frames++;
      if (this.used === this.buffer.length) this.flush();
      if (this.frames >= this.maxFrames) this.stop('limit');
    }
  }
  stop(reason: 'manual' | 'limit' | 'interrupted'): void {
    if (this.stopped) return;
    this.stopped = true;
    this.flush();
    this.send({ type: 'stopped', reason });
  }
  private pcm16(value: number): number {
    const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    return Math.round(sample < 0 ? sample * 32768 : sample * 32767);
  }
  private flush(): void {
    if (!this.used) return;
    const samples = this.used === this.buffer.length ? this.buffer : this.buffer.slice(0, this.used);
    this.send({ type: 'chunk', samples }, [samples.buffer]);
    this.buffer = new Int16Array(CAPTURE_CHUNK_FRAMES * 2);
    this.used = 0;
  }
}
