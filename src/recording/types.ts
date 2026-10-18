export type RecordingFormat = 'wav' | 'mp3';

export interface RecordingSnapshot {
  /** Changes whenever a take is started, cleared, or restored. */
  readonly revision: number;
  readonly status: 'idle' | 'preparing' | 'recording' | 'stopping' | 'ready' | 'error';
  readonly durationSeconds: number;
  readonly maxDurationSeconds: number;
  readonly sampleRate: number | null;
  readonly bytes: number;
  readonly stopReason: 'manual' | 'limit' | 'interrupted' | 'error' | null;
  readonly error: string | null;
}
export type CaptureMessage =
  | { readonly type: 'chunk'; readonly samples: Int16Array }
  | { readonly type: 'stopped'; readonly reason: 'manual' | 'limit' | 'interrupted' };
export const MAX_RECORDING_BYTES = 128 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 15 * 60;
export const CAPTURE_CHUNK_FRAMES = 4096;
