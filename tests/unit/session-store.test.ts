import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { createAudioEngine } from '../../src/audio/public';
import { deleteSession, readSession, validateSession, writeSession, type SavedSession } from '../../src/session/session-store';

function session(): SavedSession {
  const snapshot = createAudioEngine().getSnapshot();
  return { version: 1, savedAt: Date.now(), tracks: [], recording: null, mixer: snapshot.mixer,
    decks: { A: { ...snapshot.decks.A, trackId: null, positionSeconds: 0 }, B: { ...snapshot.decks.B, trackId: null, positionSeconds: 0 } } };
}
afterEach(deleteSession);
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
