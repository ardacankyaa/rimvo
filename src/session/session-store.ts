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

type StoredSession = Omit<SavedSession, 'tracks' | 'recording'> & {
  mediaEncoding: 'array-buffer-v1';
  tracks: (Omit<SavedSession['tracks'][number], 'file'> & { file: ArrayBuffer | null; fileType: string })[];
  recording: ArrayBuffer | null;
  recordingType: string;
};

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

async function encodeMedia(session: SavedSession): Promise<StoredSession> {
  // Some WebKit stores cannot persist Blob backing files. Binary structured
  // clones work across engines, and all async reads finish before the transaction.
  const tracks = await Promise.all(session.tracks.map(async track => ({ ...track,
    file: track.file ? await track.file.arrayBuffer() : null, fileType: track.file?.type ?? '' })));
  return { ...session, mediaEncoding: 'array-buffer-v1', tracks,
    recording: session.recording ? await session.recording.arrayBuffer() : null, recordingType: session.recording?.type ?? '' };
}

function decodeMedia(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('mediaEncoding' in value)) return value; // Earlier local saves used Blobs.
  const stored = value as StoredSession;
  if (stored.mediaEncoding !== 'array-buffer-v1' || !Array.isArray(stored.tracks) || stored.tracks.length > 200) throw new Error('The saved session is invalid.');
  let size = 0;
  const check = (buffer: unknown, max: number) => {
    if (buffer === null) return;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > max) throw new Error('The saved audio is invalid.');
    size += buffer.byteLength;
    if (size > SESSION_BYTE_LIMIT) throw new Error('The saved session exceeds its safe memory limit.');
  };
  check(stored.recording, SESSION_BYTE_LIMIT);
  for (const track of stored.tracks) check(track?.file, 128 * 1024 * 1024);
  return { version: stored.version, savedAt: stored.savedAt, decks: stored.decks, mixer: stored.mixer,
    tracks: stored.tracks.map(track => ({ id: track.id, name: track.name, lastModified: track.lastModified,
      file: track.file ? new Blob([track.file], { type: typeof track.fileType === 'string' ? track.fileType : '' }) : null })),
    recording: stored.recording ? new Blob([stored.recording], { type: typeof stored.recordingType === 'string' ? stored.recordingType : 'audio/wav' }) : null };
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
  const stored = await encodeMedia(session);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('sessions', 'readwrite');
      transaction.objectStore('sessions').put(stored, 'latest');
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(new Error('The session could not be saved. Device storage may be full; the previous save is preserved.'));
    });
    notifySessionChanged();
  } finally { db.close(); }
}
export async function readSession(): Promise<SavedSession | null> {
  const db = await openDatabase();
  try {
    const result: unknown = await new Promise((resolve, reject) => {
      const request = db.transaction('sessions').objectStore('sessions').get('latest');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(new Error('The saved session could not be read.'));
    });
    if (result === null) return null;
    try {
      const decoded = decodeMedia(result);
      validateSession(decoded); return decoded;
    } catch (cause) { throw new InvalidSessionError(cause); }
  } finally { db.close(); }
}
export async function deleteSession(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('sessions', 'readwrite');
      transaction.objectStore('sessions').delete('latest');
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(new Error('The saved session could not be deleted.'));
    });
    notifySessionChanged();
  } finally { db.close(); }
}
