import { BrowserAudioEngine } from './audio-engine';
import type { AudioEngine, AudioEngineOptions } from './types';

export function createAudioEngine(options?: AudioEngineOptions): AudioEngine {
  return new BrowserAudioEngine(options);
}

export { AudioEngineError } from './errors';
export type * from './types';
