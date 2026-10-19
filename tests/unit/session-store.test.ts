import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../../src/audio/public';
import { deleteSession, readSession, validateSession, writeSession, type SavedSession } from '../../src/session/session-store';

function session(): SavedSession {
  const snapshot = createAudioEngine().getSnapshot();
  return { version: 1, savedAt: Date.now(), tracks: [], recording: null, mixer: snapshot.mixer,
    decks: { A: { ...snapshot.decks.A, trackId: null, positionSeconds: 0 }, B: { ...snapshot.decks.B, trackId: null, positionSeconds: 0 } } };
}
afterEach(async () => { vi.restoreAllMocks(); await deleteSession(); });
it('round-trips a local session and deletes it explicitly', async () => {
  const value = session();
  value.mixer = { ...value.mixer, crossfader: 0.2 };
  await writeSession(value);
  expect((await readSession())?.mixer.crossfader).toBe(0.2);
  await deleteSession(); expect(await readSession()).toBeNull();
});
it('rejects broken references and nonfinite controls before replacing a previous save', async () => {
  const value = session(); await writeSession(value);
  value.decks.A.trackId = 'missing';
  await expect(writeSession(value)).rejects.toThrow(/deck/i);
  expect((await readSession())?.decks.A.trackId).toBeNull();
  value.decks.A.trackId = null; value.mixer = { ...value.mixer, crossfader: NaN };
  expect(() => validateSession(value)).toThrow(/control/);
});
it('preserves local audio when IndexedDB cannot persist Blob objects', async () => {
  const put = IDBObjectStore.prototype.put;
  const hasBlob = (value: unknown): boolean => value instanceof Blob || (!!value && typeof value === 'object' && Object.values(value).some(hasBlob));
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (hasBlob(value)) throw new DOMException('Blob persistence is unavailable.', 'DataCloneError');
    return put.call(this, value, key);
  });
  const value = session();
  value.tracks = [{ id: 'local-one', name: 'track.wav', lastModified: 123, file: new Blob(['track'], { type: 'audio/wav' }) }];
  value.decks.A.trackId = 'local-one'; value.recording = new Blob(['take'], { type: 'audio/wav' });
  await writeSession(value);
  const restored = await readSession();
  expect(await restored?.tracks[0].file?.text()).toBe('track');
  expect(restored?.tracks[0].file?.type).toBe('audio/wav');
  expect(await restored?.recording?.text()).toBe('take');
});
it('still reads sessions saved in the earlier Blob format', async () => {
  const value = session(); value.recording = new Blob(['earlier take'], { type: 'audio/wav' });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('rimvo-sessions', 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(value, 'latest');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
  expect(await (await readSession())?.recording?.text()).toBe('earlier take');
});
