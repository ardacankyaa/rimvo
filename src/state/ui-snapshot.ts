import type { AudioSnapshot, DeckSnapshot } from '../audio/types';

function sameValue(left: unknown, right: unknown, ignoredKey?: string): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = left as Readonly<Record<string, unknown>>;
  const b = right as Readonly<Record<string, unknown>>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key)
    && (key === ignoredKey || sameValue(a[key], b[key])));
}

function sameDeck(left: DeckSnapshot, right: DeckSnapshot): boolean {
  if (left === right) return true;
  // Track/waveform objects remain immutable and retain identity until replacement.
  // Compare this identity before visiting the small control-state records.
  if (left.track !== right.track) return false;
  const a = left as unknown as Readonly<Record<string, unknown>>;
  const b = right as unknown as Readonly<Record<string, unknown>>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key)
    && (key === 'positionSeconds' || key === 'track'
      || (key === 'sync' ? sameValue(a[key], b[key], 'phaseErrorSeconds') : sameValue(a[key], b[key]))));
}

function sameControls(left: AudioSnapshot, right: AudioSnapshot): boolean {
  return left === right || (left.contextState === right.contextState && left.sampleRate === right.sampleRate
    && sameValue(left.mixer, right.mixer) && sameDeck(left.decks.A, right.decks.A) && sameDeck(left.decks.B, right.decks.B));
}

export function createUiSnapshotReader(read: () => AudioSnapshot): () => AudioSnapshot {
  let controls = read();
  return () => {
    const current = read();
    // Time/phase stay in the engine's readPosition-driven visual loop. React sees
    // every semantic control update, including cue positions and track revisions.
    if (!sameControls(controls, current)) controls = current;
    return controls;
  };
}
