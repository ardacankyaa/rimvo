declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorConstructor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

declare const currentFrame: number;
declare const sampleRate: number;
