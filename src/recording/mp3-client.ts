import { createTrackedWorker } from '../audio/worker-ledger';
import mp3WorkerUrl from './mp3.worker.ts?worker&url';

export function prepareRecordingMp3(wav: Blob, signal: AbortSignal, onProgress?: (percent: number) => void): Promise<Blob> {
  if (signal.aborted) return Promise.reject(new DOMException('Encoding cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = createTrackedWorker(mp3WorkerUrl, { type: 'module' });
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      callback();
    };
    const abort = (): void => finish(() => reject(new DOMException('Encoding cancelled.', 'AbortError')));
    const armTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => finish(() => reject(new Error('MP3 encoding timed out. Try WAV or retry.'))), 120_000); };
    armTimeout();
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => finish(() => reject(new Error(event.message || 'MP3 encoding failed. Try WAV instead.')));
    worker.onmessageerror = () => finish(() => reject(new Error('Could not read the MP3 export. Try WAV instead.')));
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string; progress?: number }>) => {
      if (settled) return;
      const { blob, error, progress } = event.data;
      if (typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100) { armTimeout(); onProgress?.(progress); return; }
      finish(() => {
        if (blob instanceof Blob && blob.type === 'audio/mpeg' && blob.size) resolve(blob);
        else reject(new Error(error || 'MP3 encoding failed. Try WAV instead.'));
      });
    };
    try { worker.postMessage(wav); }
    catch (cause) { finish(() => reject(cause)); }
  });
}
