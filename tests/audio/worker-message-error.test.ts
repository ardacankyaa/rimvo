import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { worker } = vi.hoisted(() => ({ worker: { terminate: vi.fn(), postMessage: vi.fn(), onmessage: null as null | ((event: MessageEvent) => void), onerror: null, onmessageerror: null as null | ((event: MessageEvent) => void) } }));
vi.mock('../../src/audio/worker-ledger', () => ({ createTrackedWorker: () => worker }));
import { inspectAudioBlob } from '../../src/audio/admission';
import { analyzeWaveformInWorker } from '../../src/analysis/waveform-client';

beforeEach(() => { vi.stubGlobal('Worker', class {}); worker.onmessage = null; worker.onmessageerror = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('rejects MP3 admission when the worker reply cannot be deserialized', async () => {
  const result = inspectAudioBlob(new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0])]), { maxEncodedBytes: 1024, maxDurationSeconds: 480 });
  await vi.waitFor(() => expect(worker.onmessageerror).toBeTypeOf('function'));
  worker.onmessageerror!({} as MessageEvent);
  await expect(result).rejects.toMatchObject({ code: 'internal', message: 'The audio file could not be analysed.' });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('rejects waveform analysis when the worker reply cannot be deserialized', async () => {
  const result = analyzeWaveformInWorker([new Float32Array(16)], 48_000);
  worker.onmessageerror!({} as MessageEvent);
  await expect(result).rejects.toThrow('The audio file could not be analysed.');
  expect(worker.terminate).toHaveBeenCalledOnce();
});
