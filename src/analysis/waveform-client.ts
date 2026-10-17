import type { BpmAnalysisSnapshot, KeyAnalysisSnapshot, WaveformData, WaveformLevel, WaveformPeak } from '../audio/types';
import { createTrackedWorker } from '../audio/worker-ledger';
import waveformWorkerUrl from './waveform.worker.ts?worker&url';

type WorkerResponse = {
  readonly id: number;
  readonly channels?: ArrayBuffer[];
  readonly waveform?: WaveformData;
  readonly bpmAnalysis?: BpmAnalysisSnapshot;
  readonly keyAnalysis?: KeyAnalysisSnapshot;
  readonly error?: string;
};
export interface WaveformAnalysisResult {
  readonly channels: readonly Float32Array[];
  readonly waveform: WaveformData;
  readonly bpmAnalysis: BpmAnalysisSnapshot;
  readonly keyAnalysis?:KeyAnalysisSnapshot;
}

let nextRequestId = 0;

function freezeWaveform(waveform: WaveformData): WaveformData {
  for (const level of waveform.levels as WaveformLevel[]) {
    for (const peak of level.left as WaveformPeak[]) Object.freeze(peak);
    Object.freeze(level.left);
    if (level.right) {
      for (const peak of level.right as WaveformPeak[]) Object.freeze(peak);
      Object.freeze(level.right);
    }
    Object.freeze(level);
  }
  Object.freeze(waveform.levels);
  return Object.freeze(waveform);
}

export function analyzeWaveformInWorker(
  channels: readonly Float32Array[],
  sampleRate: number,
  signal?: AbortSignal,
): Promise<WaveformAnalysisResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('Web Workers are unavailable for waveform analysis.'));
  }

  const worker = createTrackedWorker(waveformWorkerUrl, { type: 'module' });
  const id = ++nextRequestId;
  const transfer: ArrayBuffer[] = [];
  for (const channel of channels) {
    if (channel.byteOffset !== 0 || channel.byteLength !== channel.buffer.byteLength) {
      worker.terminate();
      return Promise.reject(new TypeError('PCM channels must own their transferable buffers.'));
    }
    transfer.push(channel.buffer as ArrayBuffer);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      callback();
    };
    const abort = (): void => finish(() => reject(new DOMException('The operation was aborted.', 'AbortError')));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => finish(() => reject(new Error(event.message || 'Waveform worker failed.')));
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      if (response.error || !response.channels || !response.waveform || !response.bpmAnalysis) {
        finish(() => reject(new Error(response.error || 'Waveform worker returned an incomplete result.')));
        return;
      }
      const returnedChannels = response.channels.map(buffer => new Float32Array(buffer));
      const waveform = freezeWaveform(response.waveform);
      finish(() => resolve({ channels: returnedChannels, waveform, bpmAnalysis: response.bpmAnalysis!, keyAnalysis: response.keyAnalysis ? Object.freeze({...response.keyAnalysis}) : undefined }));
    };
    try {
      worker.postMessage({ id, sampleRate, channels: transfer }, transfer);
    } catch (cause) {
      finish(() => reject(cause));
    }
  });
}
