import type { AudioEngineErrorCode } from './types';

export class AudioEngineError extends Error {
  readonly name = 'AudioEngineError' as const;
  constructor(
    readonly code: AudioEngineErrorCode,
    message: string,
    readonly recoverable = true,
    readonly stage: 'admission' | 'decode' | 'install' | 'transport' | 'context' | 'engine' = 'engine',
  ) {
    super(message);
  }
}
