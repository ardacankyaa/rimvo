import type { DeckId, DeckSnapshot, MixerSnapshot } from '../audio/types';

export const SESSION_BYTE_LIMIT = 256 * 1024 * 1024;
export type SessionDeck = Pick<DeckSnapshot, 'gainDb' | 'eqDb' | 'filterValue' | 'volume' | 'tempoPercent' | 'pitchMode' | 'pitchSemitones' | 'beatGrid' | 'hotCues' | 'cueSeconds' | 'quantize' | 'fx' | 'loop' | 'loopBeats'> & { trackId: string | null; positionSeconds: number };
export interface SavedSession {
  version: 1;
  savedAt: number;
  tracks: { id: string; name: string; lastModified: number; file: Blob | null }[];
  decks: Record<DeckId, SessionDeck>;
  mixer: MixerSnapshot;
  recording: Blob | null;
}

const TRACK_BYTE_LIMIT = 128 * 1024 * 1024;
const MEDIA_PREFIX = 'media:';
const SAVE_FAILED = 'The session could not be saved. Device storage may be full; the previous save is preserved.';
type MediaRef = { key: string; bytes: number };
type StoredMedia<Media> = Omit<SavedSession, 'tracks' | 'recording'> & {
  tracks: (Omit<SavedSession['tracks'][number], 'file'> & { file: Media; fileType: string })[];
  recording: Media;
  recordingType: string;
};
/** Earlier saves kept every file inline in the session record. */
type InlineSession = StoredMedia<ArrayBuffer | null> & { mediaEncoding: 'array-buffer-v1' };
/** Each file is its own record, so saving and restoring hold one file in memory at a time. */
type StoredSession = StoredMedia<MediaRef | null> & { mediaEncoding: 'media-records-v1' };


export class InvalidSessionError extends Error {
  constructor(cause: unknown) { super('The saved session is invalid.', { cause }); this.name = 'InvalidSessionError'; }
}

const SESSION_CHANNEL = 'rimvo-session-changes';
export function subscribeToSessionChanges(onChange: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  try {
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.onmessage = onChange;
    return () => channel.close();
  } catch { return () => undefined; } // Focus/open refresh still works when channels are blocked.
}
function notifySessionChanged(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(SESSION_CHANNEL); channel.postMessage('changed'); }
  catch { /* Notifications must never turn a completed storage write into a failure. */ }
  finally { channel?.close(); }
}
/** A storage failure while reading, as opposed to a save that is itself invalid. */
class SessionReadError extends Error {}

function settle<T>(request: IDBRequest<T>, failure: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(failure());
  });
}
function readValue(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try { settle(db.transaction('sessions').objectStore('sessions').get(key), () => new SessionReadError('The saved session could not be read.')).then(resolve, reject); }
    catch { reject(new SessionReadError('The saved session could not be read.')); }
  });
}
function writeTransaction(db: IDBDatabase, failure: string, work: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction('sessions', 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(new Error(failure));
      try { work(transaction.objectStore('sessions')); }
      catch { transaction.abort(); }
    } catch { reject(new Error(failure)); }
  });
}
async function putMedia(db: IDBDatabase, key: string, blob: Blob): Promise<MediaRef> {
  // Some WebKit stores cannot persist Blob backing files, so store a binary
  // clone. The read finishes before the transaction opens, as IndexedDB requires.
  const buffer = await blob.arrayBuffer();
  await writeTransaction(db, SAVE_FAILED, store => { store.put(buffer, key); });
  return { key, bytes: buffer.byteLength };
}
function mediaKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || (value as { mediaEncoding?: unknown }).mediaEncoding !== 'media-records-v1') return [];
  const stored = value as StoredSession, refs = [stored.recording, ...(Array.isArray(stored.tracks) ? stored.tracks.map(track => track?.file) : [])];
  return refs.flatMap(ref => ref && typeof ref.key === 'string' && ref.key.startsWith(MEDIA_PREFIX) ? [ref.key] : []);
}

async function decodeMedia(db: IDBDatabase, value: unknown): Promise<unknown> {
  if (!value || typeof value !== 'object' || !('mediaEncoding' in value)) return value; // The first local saves used Blobs.
  const stored = value as InlineSession | StoredSession;
  if (!['array-buffer-v1', 'media-records-v1'].includes(stored.mediaEncoding) || !Array.isArray(stored.tracks) || stored.tracks.length > 200) throw new Error('The saved session is invalid.');
  let size = 0;
  const reserve = (bytes: unknown, max: number) => {
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > max) throw new Error('The saved audio is invalid.');
    size += bytes;
    if (size > SESSION_BYTE_LIMIT) throw new Error('The saved session exceeds its safe memory limit.');
  };
  const blob = async (media: unknown, type: unknown, max: number, fallbackType = ''): Promise<Blob | null> => {
    if (media === null) return null;
    let buffer: unknown = media;
    if (stored.mediaEncoding === 'media-records-v1') {
      const ref = media as MediaRef;
      if (!ref || typeof ref.key !== 'string' || !ref.key.startsWith(MEDIA_PREFIX)) throw new Error('The saved audio is invalid.');
      reserve(ref.bytes, max); // Check the declared size before reading the record.
      buffer = await readValue(db, ref.key);
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== ref.bytes) throw new Error('The saved audio is missing or invalid.');
    } else {
      if (!(buffer instanceof ArrayBuffer)) throw new Error('The saved audio is invalid.');
      reserve(buffer.byteLength, max);
    }
    return new Blob([buffer], { type: typeof type === 'string' ? type : fallbackType });
  };
  const recording = await blob(stored.recording, stored.recordingType, SESSION_BYTE_LIMIT, 'audio/wav');
  const tracks: SavedSession['tracks'] = [];
  for (const track of stored.tracks) {
    if (!track || typeof track !== 'object') throw new Error('The saved session contains an invalid track.');
    tracks.push({ id: track.id, name: track.name, lastModified: track.lastModified, file: await blob(track.file, track.fileType, TRACK_BYTE_LIMIT) });
  }
  return { version: stored.version, savedAt: stored.savedAt, decks: stored.decks, mixer: stored.mixer, tracks, recording };
}

export function validateSession(value: unknown): asserts value is SavedSession {
  if (!value || typeof value !== 'object') throw new Error('The saved session is invalid.');
  const session = value as SavedSession;
  if (session.version !== 1 || !Number.isFinite(session.savedAt) || session.savedAt < 0 || !Array.isArray(session.tracks) || session.tracks.length > 200) throw new Error('The saved session version or track list is invalid.');
  let size = session.recording instanceof Blob ? session.recording.size : 0;
  if (session.recording !== null && !(session.recording instanceof Blob)) throw new Error('The saved recording is invalid.');
  const ids = new Set<string>();
  for (const track of session.tracks) {
    if (!track || typeof track.id !== 'string' || ids.has(track.id) || typeof track.name !== 'string' || !Number.isFinite(track.lastModified)
      || (track.file !== null && (!(track.file instanceof Blob) || !track.file.size || track.file.size > 128 * 1024 * 1024))
      || (track.file === null && !['demo-after-hours', 'demo-open-circuit'].includes(track.id))) throw new Error('The saved session contains an invalid track.');
    ids.add(track.id); size += track.file?.size ?? 0;
  }
  if (size > SESSION_BYTE_LIMIT) throw new Error('Saved sessions are limited to 256 MiB. Remove some tracks or save the recording separately.');
  function number(value: unknown, min: number, max: number): void { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('The saved session contains an invalid control value.'); }
  if (!session.mixer || !['mix', 'cut'].includes(session.mixer.crossfaderCurve)) throw new Error('The saved mixer is invalid.');
  number(session.mixer.crossfader, 0, 1); number(session.mixer.masterVolume, 0, 1);
  for (const id of ['A', 'B'] as const) {
    const deck = session.decks?.[id];
    if (!deck || (deck.trackId !== null && !ids.has(deck.trackId)) || !Array.isArray(deck.hotCues) || deck.hotCues.length !== 8 || !deck.eqDb || !deck.fx
      || !['tape', 'linked', 'independent'].includes(deck.pitchMode) || typeof deck.quantize !== 'boolean') throw new Error('The saved deck is invalid.');
    number(deck.positionSeconds, 0, 480); number(deck.cueSeconds, 0, 480); number(deck.gainDb, -24, 12);
    for (const band of ['low', 'mid', 'high'] as const) number(deck.eqDb[band], -24, 6);
    number(deck.filterValue, -1, 1); number(deck.volume, 0, 1); number(deck.tempoPercent, -16, 16); number(deck.pitchSemitones, -12, 12);
    for (const cue of deck.hotCues) if (cue !== null) number(cue.positionSeconds, 0, 480);
    if (deck.beatGrid) {
      number(deck.beatGrid.bpm, 30, 300); number(deck.beatGrid.firstBeatSeconds, 0, 480); number(deck.beatGrid.confidence, 0, 1);
      if (!['auto', 'manual', 'tap'].includes(deck.beatGrid.source)) throw new Error('The saved beat grid is invalid.');
    }
    if (deck.loop) { number(deck.loop.startSeconds, 0, 480); number(deck.loop.endSeconds, deck.loop.startSeconds + 0.000001, 480); }
    if (deck.loopBeats !== null && (!deck.loop || !deck.beatGrid || ![.25, .5, 1, 2, 4, 8, 16, 32].includes(deck.loopBeats))) throw new Error('The saved beat loop is invalid.');
    for (const type of ['delay', 'reverb', 'drive', 'flanger', 'tremolo'] as const) {
      const fx = deck.fx[type];
      if (!fx || typeof fx.enabled !== 'boolean') throw new Error('The saved effects are invalid.');
      for (const [key, value] of Object.entries(fx)) if (key !== 'enabled') number(value, 0, 20);
    }
    number(deck.fx.delay.wet, 0, .5); number(deck.fx.delay.feedback, 0, .6);
    if (![0.25, 0.5, 1].includes(deck.fx.delay.division)) throw new Error('The saved echo division is invalid.');
    number(deck.fx.reverb.wet, 0, .4); number(deck.fx.drive.amount, 0, 1);
    for (const type of ['flanger', 'tremolo'] as const) { number(deck.fx[type].amount, 0, 1); number(deck.fx[type].rate, .1, 8); }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot save sessions locally.')); return; }
    const request = indexedDB.open('rimvo-sessions', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(new Error('Local session storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other RIMVO tabs and try again.'));
  });
}
export async function writeSession(session: SavedSession): Promise<void> {
  validateSession(session);
  const db = await openDatabase();
  const saveId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const written: string[] = [];
  const store = async (blob: Blob | null, name: string): Promise<MediaRef | null> => {
    if (!blob) return null;
    const ref = await putMedia(db, MEDIA_PREFIX + saveId + ':' + name, blob);
    written.push(ref.key);
    return ref;
  };
  try {
    const tracks: StoredSession['tracks'] = [];
    for (const [index, track] of session.tracks.entries()) {
      tracks.push({ id: track.id, name: track.name, lastModified: track.lastModified, file: await store(track.file, String(index)), fileType: track.file?.type ?? '' });
    }
    const recording = await store(session.recording, 'recording');
    const stored: StoredSession = { version: session.version, savedAt: session.savedAt, decks: session.decks, mixer: session.mixer,
      mediaEncoding: 'media-records-v1', tracks, recording, recordingType: session.recording?.type ?? '' };
    // Replace the session and release the previous save's media atomically.
    await writeTransaction(db, SAVE_FAILED, sessions => {
      const previous = sessions.get('latest');
      previous.onsuccess = () => {
        try { for (const key of mediaKeys(previous.result)) sessions.delete(key); sessions.put(stored, 'latest'); }
        catch { previous.transaction?.abort(); }
      };
    });
  } catch (cause) {
    if (written.length) await writeTransaction(db, SAVE_FAILED, sessions => { for (const key of written) sessions.delete(key); }).catch(() => undefined);
    db.close();
    throw new Error(SAVE_FAILED, { cause });
  }
  db.close();
  notifySessionChanged();
}
export async function readSession(): Promise<SavedSession | null> {
  const db = await openDatabase();
  try {
    const result = await readValue(db, 'latest');
    if (result === undefined || result === null) return null;
    try {
      const decoded = await decodeMedia(db, result);
      validateSession(decoded); return decoded;
    } catch (cause) {
      if (cause instanceof SessionReadError) throw new Error(cause.message, { cause });
      throw new InvalidSessionError(cause);
    }
  } finally { db.close(); }
}
export async function deleteSession(): Promise<void> {
  const db = await openDatabase();
  try {
    // Removing every media record also clears any left by an interrupted save.
    await writeTransaction(db, 'The saved session could not be deleted.', sessions => {
      sessions.delete('latest');
      sessions.delete(IDBKeyRange.bound(MEDIA_PREFIX, MEDIA_PREFIX + '￿'));
    });
    notifySessionChanged();
  } finally { db.close(); }
}
