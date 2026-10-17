import type { AudioEngine, AudioSnapshot, DeckId } from '../../audio/types';

export type TransitionScene = 'air' | 'echo' | 'sweep';
type FxWrite = Parameters<AudioEngine['setFx']>[1];
type TransitionEngine = Pick<AudioEngine, 'getSnapshot' | 'setCrossfader' | 'setFilter' | 'setFx'>;
const deckIds: readonly DeckId[] = ['A', 'B'];
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function transitionChanges(baseline: AudioSnapshot, scene: TransitionScene, position: number, intensity: number) {
  const x = clamp(position), y = clamp(intensity);
  const decks = deckIds.map(id => {
    const deck = baseline.decks[id];
    const leaving = id === 'A' ? x : 1 - x;
    const strength = scene === 'echo' ? y * leaving : y;
    const filter = clamp(deck.filterValue + y * leaving * (scene === 'sweep' ? 0.75 : scene === 'air' ? 0.25 : 0.35), -1, 1);
    const fx: FxWrite = scene === 'echo'
      ? { type: 'delay', ...deck.fx.delay, enabled: deck.fx.delay.enabled || strength > 0.001,
        wet: strength === 0 ? deck.fx.delay.wet : clamp((deck.fx.delay.enabled ? deck.fx.delay.wet : 0) + strength * 0.3, 0, 0.5),
        feedback: strength === 0 ? deck.fx.delay.feedback : Math.max(deck.fx.delay.feedback, 0.32) }
      : { type: 'reverb', ...deck.fx.reverb, enabled: deck.fx.reverb.enabled || strength > 0.001,
        wet: strength === 0 ? deck.fx.reverb.wet : clamp((deck.fx.reverb.enabled ? deck.fx.reverb.wet : 0) + strength * (scene === 'air' ? 0.24 : 0.12), 0, 0.4) };
    return { id, filter, fx };
  });
  return { x, y, decks };
}

function sameFx(current: object, expected: FxWrite): boolean {
  const values = current as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => key === 'type' || values[key] === value);
}

type FxType = FxWrite['type'];
type FxEngine = Pick<AudioEngine, 'getSnapshot' | 'setFx'>;
interface TemporaryFxOwner {
  readonly revision: number;
  readonly trackRevision: number | undefined;
  readonly enabled: boolean;
  last: FxWrite | null;
}
const temporaryFx = new WeakMap<FxEngine, Map<string, TemporaryFxOwner>>();
const fxKey = (id: DeckId, type: FxType) => id + ':' + type;

/** Temporary Canvas/pad enables never become permanent Keep state. */
export function permanentFxEnabled(engine: FxEngine, id: DeckId, type: FxType): boolean {
  const deck = engine.getSnapshot().decks[id];
  const owner = temporaryFx.get(engine)?.get(fxKey(id, type));
  return owner && deck.revision === owner.revision && deck.track?.revision === owner.trackRevision
    && (!owner.last || sameFx(deck.fx[type], owner.last)) ? owner.enabled : deck.fx[type].enabled;
}

/** Release only parameters still owned by this gesture and this record. */
export function createTemporaryFxGesture(engine: FxEngine, id: DeckId, type: FxType, restoreSettings = false,
  write: (setting: FxWrite) => void = setting => engine.setFx(id, setting)) {
  const baseline = engine.getSnapshot().decks[id];
  const owner: TemporaryFxOwner = { revision: baseline.revision, trackRevision: baseline.track?.revision,
    enabled: permanentFxEnabled(engine, id, type), last: null };
  const owners = temporaryFx.get(engine) ?? new Map<string, TemporaryFxOwner>();
  temporaryFx.set(engine, owners);
  const key = fxKey(id, type);
  owners.set(key, owner);
  let ended = false;
  const owns = () => {
    const snapshot = engine.getSnapshot(), deck = snapshot.decks[id];
    return !['closed', 'disposed', 'faulted'].includes(snapshot.contextState) && owners.get(key) === owner
      && deck.revision === owner.revision && deck.track?.revision === owner.trackRevision
      && (!owner.last || sameFx(deck.fx[type], owner.last));
  };
  function finish() {
    if (ended) return;
    const restore = owns() && owner.last;
    ended = true;
    // Keep ownership registered during publish, so quick controls see the durable state.
    if (restore) {
      const current = engine.getSnapshot().decks[id].fx[type];
      write({ type, ...(restoreSettings ? baseline.fx[type] : current), enabled: owner.enabled } as FxWrite);
    }
    if (owners.get(key) === owner) owners.delete(key);
  }
  return {
    move(setting: FxWrite): boolean {
      if (ended || setting.type !== type || !owns()) { finish(); return false; }
      owner.last = setting;
      write(setting);
      return true;
    },
    finish,
  };
}

/** Owns only the temporary scene parameters. Normal release keeps the new blend. */
export function createTransitionGesture(engine: TransitionEngine, scene: TransitionScene) {
  const baseline = engine.getSnapshot();
  if (!baseline.decks.A.track || !baseline.decks.B.track || ['closed','disposed','faulted'].includes(baseline.contextState)) return null;
  let last: ReturnType<typeof transitionChanges> | null = null;
  let ended = false;
  const fxType = scene === 'echo' ? 'delay' : 'reverb';
  const fxGestures = Object.fromEntries(deckIds.map(id => [id, createTemporaryFxGesture(engine, id, fxType, true)])) as Record<DeckId, ReturnType<typeof createTemporaryFxGesture>>;
  const ownsDeck = (current: AudioSnapshot, id: DeckId) => current.decks[id].track?.revision === baseline.decks[id].track?.revision
    && current.decks[id].revision === baseline.decks[id].revision;

  function finish(cancel = false): void {
    if (ended) return;
    ended = true;
    if (!last) { for (const id of deckIds) fxGestures[id].finish(); return; }
    const current = engine.getSnapshot();
    if(['closed','disposed','faulted'].includes(current.contextState)) { for (const id of deckIds) fxGestures[id].finish(); return; }
    for (const { id, filter } of last.decks) {
      fxGestures[id].finish();
      if (!ownsDeck(current, id)) continue;
      // Leave settings alone if another control has taken ownership meanwhile.
      if (current.decks[id].filterValue === filter) engine.setFilter(id, baseline.decks[id].filterValue);
    }
    if (cancel && current.mixer.crossfader === last.x) engine.setCrossfader(baseline.mixer.crossfader);
  }

  return {
    move(position: number, intensity: number): boolean {
      if (ended || !Number.isFinite(position) || !Number.isFinite(intensity)) return false;
      const current = engine.getSnapshot();
      if (['closed','disposed','faulted'].includes(current.contextState) || deckIds.some(id => !ownsDeck(current, id))) {
        finish(true);
        return false;
      }
      if (last && last.decks.some(({id,filter,fx}) => current.decks[id].filterValue !== filter || !sameFx(current.decks[id].fx[fx.type], fx))) {
        finish(true);
        return false;
      }
      last = transitionChanges(baseline, scene, position, intensity);
      engine.setCrossfader(last.x);
      for (const { id, filter, fx } of last.decks) {
        engine.setFilter(id, filter);
        if (!fxGestures[id].move(fx)) { finish(true); return false; }
      }
      return true;
    },
    finish,
  };
}
