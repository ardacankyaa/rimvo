export interface SamplePeakLimiterOptions {
  readonly lookaheadMs?: number;
  readonly ceiling?: number;
  readonly releaseMs?: number;
}

export class SamplePeakLimiterKernel {
  readonly lookaheadFrames: number;
  readonly ceiling: number;
  private readonly delayLeft: Float32Array;
  private readonly delayRight: Float32Array;
  private readonly peakIndexes: Float64Array;
  private readonly peakValues: Float32Array;
  /** Windowed minimum gains; their moving average ramps reduction across the lookahead. */
  private readonly gainHistory: Float64Array;
  private readonly releaseCoefficient: number;
  private writeIndex = 0;
  private frameIndex = 0;
  private dequeHead = 0;
  private dequeTail = 0;
  private gainHistoryIndex = 0;
  private gain = 1;
  private disposed = false;

  constructor(sampleRate: number, options: SamplePeakLimiterOptions = {}) {
    const lookaheadMs = options.lookaheadMs ?? 3;
    const releaseMs = options.releaseMs ?? 80;
    const ceiling = options.ceiling ?? 10 ** (-1 / 20);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('Sample rate must be finite and greater than zero.');
    }
    if (!Number.isFinite(lookaheadMs) || lookaheadMs <= 0) {
      throw new RangeError('Lookahead must be finite and greater than zero.');
    }
    if (!Number.isFinite(releaseMs) || releaseMs <= 0) {
      throw new RangeError('Release must be finite and greater than zero.');
    }
    if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling > 1) {
      throw new RangeError('Ceiling must be in the interval (0, 1].');
    }

    this.lookaheadFrames = Math.max(1, Math.round(sampleRate * lookaheadMs / 1000));
    this.ceiling = ceiling;
    this.delayLeft = new Float32Array(this.lookaheadFrames);
    this.delayRight = new Float32Array(this.lookaheadFrames);
    const queueCapacity = this.lookaheadFrames + 2;
    this.peakIndexes = new Float64Array(queueCapacity);
    this.peakValues = new Float32Array(queueCapacity);
    this.gainHistory = new Float64Array(this.lookaheadFrames).fill(1);
    this.releaseCoefficient = Math.exp(-1 / (sampleRate * releaseMs / 1000));
  }

  processInto(
    inputLeft: Float32Array,
    inputRight: Float32Array,
    outputLeft: Float32Array,
    outputRight: Float32Array,
  ): void {
    const frameCount = Math.min(inputLeft.length, inputRight.length, outputLeft.length, outputRight.length);
    if (this.disposed) {
      outputLeft.fill(0);
      outputRight.fill(0);
      return;
    }

    // Re-summed per block so the running average cannot drift.
    let gainSum = 0;
    for (const value of this.gainHistory) gainSum += value;
    for (let index = 0; index < frameCount; index += 1) {
      const rawLeft = inputLeft[index];
      const rawRight = inputRight[index];
      const left = Number.isFinite(rawLeft) ? rawLeft : 0;
      const right = Number.isFinite(rawRight) ? rawRight : 0;
      const peak = Math.max(Math.abs(left), Math.abs(right));
      const currentFrame = this.frameIndex;
      const oldestFrame = currentFrame - this.lookaheadFrames;

      while (
        this.dequeHead < this.dequeTail
        && this.peakIndexes[this.dequeHead % this.peakIndexes.length] < oldestFrame
      ) {
        this.dequeHead += 1;
      }
      while (this.dequeHead < this.dequeTail) {
        const last = (this.dequeTail - 1) % this.peakValues.length;
        if (this.peakValues[last] > peak) break;
        this.dequeTail -= 1;
      }
      const tailSlot = this.dequeTail % this.peakValues.length;
      this.peakIndexes[tailSlot] = currentFrame;
      this.peakValues[tailSlot] = peak;
      this.dequeTail += 1;

      const delayedLeft = this.delayLeft[this.writeIndex];
      const delayedRight = this.delayRight[this.writeIndex];
      this.delayLeft[this.writeIndex] = left;
      this.delayRight[this.writeIndex] = right;
      this.writeIndex = (this.writeIndex + 1) % this.lookaheadFrames;

      const windowPeak = this.peakValues[this.dequeHead % this.peakValues.length];
      const windowGain = windowPeak > this.ceiling ? this.ceiling / windowPeak : 1;
      // Every averaged gain covers the delayed sample, so the ramp completes before the peak leaves the delay line.
      gainSum += windowGain - this.gainHistory[this.gainHistoryIndex];
      this.gainHistory[this.gainHistoryIndex] = windowGain;
      this.gainHistoryIndex = (this.gainHistoryIndex + 1) % this.lookaheadFrames;
      const targetGain = Math.min(1, gainSum / this.lookaheadFrames);
      if (targetGain < this.gain) {
        this.gain = targetGain;
      } else {
        this.gain = targetGain + this.releaseCoefficient * (this.gain - targetGain);
      }

      if (currentFrame < this.lookaheadFrames) {
        outputLeft[index] = 0;
        outputRight[index] = 0;
      } else {
        const limitedLeft = delayedLeft * this.gain;
        const limitedRight = delayedRight * this.gain;
        outputLeft[index] = Math.max(-this.ceiling, Math.min(this.ceiling, limitedLeft));
        outputRight[index] = Math.max(-this.ceiling, Math.min(this.ceiling, limitedRight));
      }

      this.frameIndex += 1;
    }

    for (let index = frameCount; index < outputLeft.length; index += 1) outputLeft[index] = 0;
    for (let index = frameCount; index < outputRight.length; index += 1) outputRight[index] = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.delayLeft.fill(0);
    this.delayRight.fill(0);
    this.peakIndexes.fill(0);
    this.peakValues.fill(0);
    this.gainHistory.fill(0);
    this.dequeHead = 0;
    this.dequeTail = 0;
    this.gain = 0;
  }
}
