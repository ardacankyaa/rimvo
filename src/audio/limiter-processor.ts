import { SamplePeakLimiterKernel } from '../dsp/limiter-kernel';

class MasterLimiterProcessor extends AudioWorkletProcessor {
  private readonly kernel = new SamplePeakLimiterKernel(sampleRate);
  private disposed = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ readonly type?: string }>) => {
      if (event.data?.type === 'dispose') {
        this.kernel.dispose();
        this.disposed = true;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const leftOutput = output?.[0];
    const rightOutput = output?.[1] ?? leftOutput;
    if (!leftOutput || !rightOutput) return !this.disposed;

    if (this.disposed) {
      leftOutput.fill(0);
      rightOutput.fill(0);
      return false;
    }

    const input = inputs[0];
    const leftInput = input?.[0];
    const rightInput = input?.[1] ?? leftInput;
    if (!leftInput || !rightInput) {
      leftOutput.fill(0);
      rightOutput.fill(0);
      return true;
    }

    this.kernel.processInto(leftInput, rightInput, leftOutput, rightOutput);
    return true;
  }
}

registerProcessor('rimvo-master-limiter', MasterLimiterProcessor);
