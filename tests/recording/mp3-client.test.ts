import { afterEach, expect, it, vi } from 'vitest';

const { worker } = vi.hoisted(() => ({ worker: { terminate: vi.fn(), postMessage: vi.fn(), onmessage: null as null | ((event: MessageEvent) => void), onerror: null, onmessageerror: null } }));
vi.mock('../../src/audio/worker-ledger', () => ({ createTrackedWorker: () => worker }));
import { prepareRecordingMp3 } from '../../src/recording/mp3-client';

afterEach(() => { vi.clearAllMocks(); });
it('reports progress without completing and terminates the encoder on cancellation', async () => {
  const controller = new AbortController(), progress = vi.fn();
  const result = prepareRecordingMp3(new Blob(['wav']), controller.signal, progress);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  worker.onmessage?.({ data: { progress: 30 } } as MessageEvent);
  expect(progress).toHaveBeenCalledWith(30);
  expect(worker.terminate).not.toHaveBeenCalled();
  controller.abort(); await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('finishes only with a nonempty MP3 blob and releases its worker', async () => {
  const result = prepareRecordingMp3(new Blob(['wav']), new AbortController().signal);
  const mp3 = new Blob(['encoded'], { type: 'audio/mpeg' });
  worker.onmessage?.({ data: { blob: mp3 } } as MessageEvent);
  expect(await result).toBe(mp3);
  expect(worker.terminate).toHaveBeenCalledOnce();
});
