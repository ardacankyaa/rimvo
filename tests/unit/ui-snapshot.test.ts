import { describe, expect, it } from 'vitest';
import { createAudioEngine } from '../../src/audio/public';
import type { AudioSnapshot, DeckSnapshot } from '../../src/audio/types';
import { createUiSnapshotReader } from '../../src/state/ui-snapshot';

const initial = createAudioEngine().getSnapshot();
function withDeck(snapshot: AudioSnapshot, changes: Partial<DeckSnapshot>): AudioSnapshot {
  return { ...snapshot, decks: { ...snapshot.decks, A: { ...snapshot.decks.A, ...changes } } };
}

describe('UI subscription separates the transport clock from control state', () => {
  it('keeps one snapshot identity across clock publications and sync drift while live visuals read the engine', () => {
    let source = initial;
    const read = createUiSnapshotReader(() => source);
    const first = read();
    source = withDeck(source, { positionSeconds: 3, sync: { ...source.decks.A.sync, phaseErrorSeconds: 0.02 } });
    expect(read()).toBe(first);
    source = withDeck(source, { positionSeconds: 4 });
    expect(read()).toBe(first);
  });

  it.each([
    { status: 'playing' as const }, { revision: 2 }, { tempoPercent: 3 }, { gainDb: -6 },
    { eqDb: { low: -3, mid: 0, high: 0 } }, { filterValue: 0.3 }, { volume: 0.4 },
    { loop: { startSeconds: 0.2, endSeconds: 1 }, loopBeats: 2 as const },
    { effectiveBpm: 121 }, { beatGrid: { bpm: 121, firstBeatSeconds: 0.1, confidence: 1, source: 'manual' as const } },
    { bpmAnalysis: { status: 'complete' as const, confidence: 0.8, candidates: [{ bpm: 121, confidence: 0.8, firstBeatSeconds: 0.1 }] } },
    { scratchActive: true }, { hotCues: [{ positionSeconds: 3 }, null, null, null, null, null, null, null] },
    { cueSeconds: 2 }, { quantize: true },
    { fx: { ...initial.decks.A.fx, delay: { ...initial.decks.A.fx.delay, enabled: true } } },
    { sync: { ...initial.decks.A.sync, status: 'unavailable' as const, reason: 'seek' as const } },
    { error: { name: 'AudioEngineError' as const, code: 'corrupt-file' as const, message: 'Choose another file', recoverable: true, stage: 'decode' as const } },
  ])('publishes semantic deck changes immediately: %j', changes => {
    let source = initial;
    const read = createUiSnapshotReader(() => source);
    const first = read();
    source = withDeck(source, changes);
    expect(read()).toBe(source);
    expect(read()).not.toBe(first);
  });

  it('publishes changes on B, mixer and audio session as well as A', () => {
    let source = initial;
    const read = createUiSnapshotReader(() => source);
    let previous = read();
    for (const next of [
      { ...initial, contextState: 'suspended' as const },
      { ...initial, sampleRate: 48000 },
      { ...initial, decks: { ...initial.decks, B: { ...initial.decks.B, status: 'loading' as const } } },
      { ...initial, mixer: { ...initial.mixer, crossfader: 0.2 } },
    ]) {
      source = next;
      expect(read()).toBe(next);
      expect(read()).not.toBe(previous);
      previous = read();
    }
  });

  it('does not mask edits to cue positions or a replacement track', () => {
    let source = withDeck(initial, { hotCues: [{ positionSeconds: 1 }, null, null, null, null, null, null, null] });
    const read = createUiSnapshotReader(() => source);
    const first = read();
    source = withDeck(source, { hotCues: [{ positionSeconds: 2 }, null, null, null, null, null, null, null] });
    expect(read()).not.toBe(first);
    const cueChanged = read();
    source = withDeck(source, { track: { revision: 1, name: 'Local', format: 'wav', durationSeconds: 4, sampleRate: 48000, channels: 1, frameCount: 192000, waveform: { sampleRate: 48000, frameCount: 192000, channels: 1, baseBlockFrames: 128, levels: [] } } });
    expect(read()).not.toBe(cueChanged);
  });
});
