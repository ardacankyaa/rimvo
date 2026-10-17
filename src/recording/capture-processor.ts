import { StereoCaptureKernel } from './capture-kernel';

class MixCaptureProcessor extends AudioWorkletProcessor {
  private kernel: StereoCaptureKernel;
  private disposed = false;
  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.kernel = new StereoCaptureKernel(options?.processorOptions?.maxFrames, (message, transfer) => this.port.postMessage(message, transfer ?? []));
    this.port.onmessage = event => {
      if (event.data?.type === 'stop') this.kernel.stop(event.data.reason === 'interrupted' ? 'interrupted' : 'manual');
      if (event.data?.type === 'dispose') { this.disposed = true; this.port.onmessage = null; this.port.close(); }
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    for (const channel of outputs[0] ?? []) channel.fill(0);
    if (this.disposed) return false;
    const left = inputs[0]?.[0];
    if (left) this.kernel.process(left, inputs[0]?.[1] ?? left);
    return true;
  }
}
registerProcessor('rimvo-mix-capture', MixCaptureProcessor);
