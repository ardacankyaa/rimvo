import { t } from '../../i18n';
import { BpmControl } from './BpmControl';
import {syncForMix} from './sync-action';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { DeckId, DeckSnapshot } from '../../audio/types';
import type { LibraryTrack } from '../../library/library';
import { engine, getSnapshot } from '../../state/engine';
import { LinearControl, ToggleButton } from '../../ui/ControlPrimitives';
import { registerGesture } from '../../ui/gesture-registry';
import { FxControls, type DeckFx, type FxWrite } from './FxPads';
import { JogWheel } from './JogWheel';
import { Icon } from '../../ui/Icon';
import { NudgeButton } from './NudgeButton';
import { formatMediaTime } from '../../ui/time';
import { registerVisualTask } from '../../ui/visual-loop';

export type DeckToolTab = 'loop' | 'cues' | 'grid' | 'fx' | 'waveform' | 'track';
export { DeckTools } from './DeckTools';

export interface DeckPanelProps {
  readonly id: DeckId;
  readonly deck: DeckSnapshot;
  readonly trackEntry: LibraryTrack | null;
  readonly run: (action: () => void | Promise<unknown>) => void;
  readonly onError: (cause: unknown) => void;
  readonly onNotify: (message: string) => void;
  readonly onLoadFile: (file: File, id: DeckId) => void | Promise<unknown>;
  readonly onUnloadDeck: (id: DeckId) => void | Promise<unknown>;
  readonly onFocusDeck: (id: DeckId) => void;
  readonly isActive: boolean;
  readonly activeTool?: DeckToolTab | null;
  readonly zoomLevel: 1 | 2 | 4;
  readonly onOpenTools: (id: DeckId, tab?: DeckToolTab) => void;
  readonly loading: boolean;
  readonly bpmRequest?: number;
}

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map(word => word[0]?.toUpperCase() || '').join('') || '—');
}
function syncReasonText(deck: DeckSnapshot): string {
  switch (deck.sync.reason) {
    case 'unreliable-grid': return 'Set a reliable beat grid to sync';
    case 'outside-tempo-range': return 'Tempo match is outside ±16%';
    case 'scratch': return 'Release the platter to sync';
    case 'seek': return 'Sync paused after seek';
    case 'load': return 'Load a track to sync';
    case 'master-stopped': return 'Master deck is stopped';
    case 'manual-rate': return 'Sync disengaged after tempo adjustment';
    default: return deck.sync.status === 'active' ? deck.sync.mode==='tempo'?'Tempo matched · adjust alignment by ear':'Following the other deck' : deck.beatGrid ? 'Match the two track tempos' : 'Find or enter BPM to sync';
  }
}

const clockText = (seconds: number) => formatMediaTime(seconds).replace(/\.\d+$/, '');

/** Elapsed time follows the engine every frame; React snapshots skip position-only updates. */
function DeckProgress({ id, loaded, durationSeconds }: { id: DeckId; loaded: boolean; durationSeconds: number }) {
  const elapsed = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    let lastText = '', lastRatio = -1;
    const draw = () => {
      const position = loaded ? engine.readPosition(id).positionSeconds : 0;
      const text = clockText(position);
      const ratio = durationSeconds > 0 ? Math.min(1, Math.max(0, position / durationSeconds)) : 0;
      if (elapsed.current && text !== lastText) { elapsed.current.textContent = t(text); lastText = text; }
      if (bar.current && Math.abs(ratio - lastRatio) > 0.0005) { bar.current.style.setProperty('--track-progress', ratio * 100 + '%'); lastRatio = ratio; }
    };
    draw();
    return loaded ? registerVisualTask(draw) : undefined;
  }, [id, loaded, durationSeconds]);
  return <div className="deck-track__progress"><span ref={elapsed}>{t(clockText(0))}</span><i ref={bar} /><span>{t(clockText(durationSeconds))}</span></div>;
}

function CueButton({ id, playing, loaded, revision, run, onAuditionChange }: { id: DeckId; playing: boolean; loaded: boolean; revision: number; run: (action: () => void | Promise<unknown>) => void; onAuditionChange: (held: boolean) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const pointer = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);
  const unregister = useRef<(() => void) | null>(null);
  const pointerRevision = useRef<number | null>(null);
  const runRef = useRef(run);
  const finishRef = useRef<(pointerId?: number, notifyParent?: boolean) => void>(() => undefined);

  function finish(pointerId?: number, notifyParent = true): void {
    if (pointer.current === null || (pointerId !== undefined && pointer.current !== pointerId)) return;
    const active = pointer.current;
    const trackRevision = pointerRevision.current;
    pointer.current = null;
    pointerRevision.current = null;
    setHolding(false);
    if (notifyParent) onAuditionChange(false);
    unregister.current?.();
    unregister.current = null;
    const element = button.current;
    element?.classList.remove('is-held');
    element?.setAttribute('aria-pressed', 'false');
    if (element?.hasPointerCapture(active)) {
      try { element.releasePointerCapture(active); } catch { /* Capture may already be gone. */ }
    }
    const deck = getSnapshot().decks[id];
    if (trackRevision !== null && deck.track?.revision === trackRevision && deck.revision === trackRevision) {
      runRef.current(() => engine.endCuePreview(id));
    }
  }
  useLayoutEffect(() => {
    runRef.current = run;
    finishRef.current = finish;
  });
  useEffect(() => {
    const activePointer = pointer.current;
    if (activePointer !== null && (!loaded || pointerRevision.current !== revision)) finishRef.current(activePointer);
  }, [loaded, revision]);
  useEffect(() => () => finishRef.current(undefined, false), []);

  function begin(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!loaded || playing || event.button !== 0 || pointer.current !== null) {
      if (loaded && playing && event.button === 0) run(() => engine.cueDeck(id));
      return;
    }
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    pointer.current = event.pointerId;
    pointerRevision.current = revision;
    setHolding(true);
    onAuditionChange(true);
    event.currentTarget.classList.add('is-held');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* App-level blur cleanup still ends audition. */ }
    unregister.current = registerGesture(() => finish(event.pointerId));
    run(() => engine.startCuePreview(id));
  }
  return <ToggleButton ref={button} className={'transport-cue' + (holding ? ' is-held' : '')} tone="cue" aria-label={t('Cue ' + id)} pressed={holding} disabled={!loaded}
    onPointerDown={begin} onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)}
    onLostPointerCapture={event => finish(event.pointerId)} onClick={event => { if (event.detail === 0 && loaded) run(() => engine.cueDeck(id)); }}>{t("Cue")}</ToggleButton>;
}

export function DeckPanel({ id, deck, trackEntry, run, onError, onNotify, onLoadFile, onFocusDeck, isActive, activeTool=null, onOpenTools, loading, bpmRequest }: DeckPanelProps) {
  const [failedArtworkId, setFailedArtworkId] = useState<string | null>(null);
  const [cueAuditioning, setCueAuditioning] = useState(false);
  const loaded = deck.track !== null;
  const trackRevision = deck.track?.revision ?? null;
  const isPlaying = deck.status === 'playing';
  const playIsLatched = isPlaying && !cueAuditioning;
  const coverTitle = trackEntry?.title ?? deck.track?.name ?? t('Your track here');
  const coverArtist = trackEntry?.artist ?? (loaded ? t('Local audio file') : t('Add a file or pick from Library'));
  const showArtist = loaded && !['RIMVO originals', 'Local audio file', 'Local track', 'Unknown artist'].includes(coverArtist);
  const coverUrl = trackEntry?.artworkUrl ?? null;
  const fx = deck.fx as DeckFx;
  const activeEffects = Object.values(fx).filter(effect => effect.enabled).length;
  function setTempo(value: number): void {
    const current = getSnapshot().decks[id];
    if (trackRevision === null || current.track?.revision !== trackRevision || current.revision !== trackRevision) return;
    run(() => engine.setTempo(id, value));
  }
  function receiveFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    if (file) void Promise.resolve(onLoadFile(file, id)).catch(onError);
    event.currentTarget.value = '';
  }
  function dropFile(event: ReactDragEvent<HTMLElement>): void {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('is-drop-target');
    const file = event.dataTransfer.files[0];
    if (file) {
      const remaining = event.dataTransfer.files.length - 1;
      const previousRevision = getSnapshot().decks[id].track?.revision;
      void Promise.resolve(onLoadFile(file, id)).then(() => {
        const current = getSnapshot().decks[id];
        if (remaining > 0 && !current.error && current.track?.name === file.name && current.track.revision !== previousRevision) {
          onNotify('Loaded “' + file.name + '” into Deck ' + id + '. Add the remaining ' + remaining + ' file' + (remaining === 1 ? '' : 's') + ' through Library → Add music, or drop them in Library.');
        }
      }).catch(onError);
    }
  }

  const writeFx = (setting: FxWrite) => {
    const current = getSnapshot().decks[id];
    if (trackRevision === null || current.track?.revision !== trackRevision || current.revision !== trackRevision) return;
    run(() => engine.setFx(id, setting));
  };

  return <section className={'deck-panel deck-panel-' + id + (isActive ? ' is-active' : '') + (!loaded ? ' is-empty' : '') + (isPlaying ? ' is-playing' : '')} aria-label={t('Deck ' + id)} tabIndex={0} onPointerDownCapture={() => onFocusDeck(id)} onFocusCapture={() => onFocusDeck(id)}
    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; event.currentTarget.classList.add('is-drop-target'); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.classList.remove('is-drop-target'); }} onDrop={dropFile}>
    <header className="deck-header">
      <div className="deck-header__topline"><div className="deck-name"><h2>{t("Deck ")}{t(id)}</h2></div>
        <span className={'deck-status status-' + (loading ? 'loading' : deck.status)}><span className="deck-status__dot" />{t(loading ? (isPlaying ? 'Playing · loading' : 'Loading') : deck.status === 'playing' ? 'Playing' : deck.status === 'paused' ? 'Paused' : deck.status === 'loading' ? 'Loading' : deck.status === 'error' ? 'Needs attention' : deck.status === 'empty' ? 'Empty' : 'Ready')}</span>
        {deck.error && <span role="alert" className="deck-error">{t(deck.error.message)}</span>}
      </div>
      <div className="deck-header__track">
        <div className="deck-track__art" role="img" aria-label={t(loaded ? coverTitle + ' artwork' : undefined)} aria-hidden={!loaded}>
          {coverUrl && failedArtworkId !== trackEntry?.id && <img src={coverUrl} alt={t(coverTitle + ' cover')} width="320" height="320" onError={() => setFailedArtworkId(trackEntry?.id ?? null)} />}
          <span className="deck-track__fallback" hidden={!!coverUrl && failedArtworkId !== trackEntry?.id}>{loaded ? initials(coverTitle) : <Icon name="folder" />}</span>
          <span className="deck-track__art-id">{t(id)}</span>
        </div>
        <div className="deck-track__info"><div className="deck-track__title"><span className="deck-name__mark" aria-hidden="true">{t(id)}</span><h3 title={coverTitle}>{coverTitle}</h3></div><p className={showArtist?undefined:'visually-hidden'} title={coverArtist}>{coverArtist}</p><span className="deck-track__meta">{t(loaded ? (deck.effectiveBpm?.toFixed(0) ?? '—') + ' BPM · ' + deck.track?.format.toUpperCase() : 'MP3 · WAV · FLAC')}</span><DeckProgress id={id} loaded={loaded} durationSeconds={deck.durationSeconds} /></div>
        <label className={'file-button deck-header__replace' + (!loaded ? ' deck-header__replace--empty' : '')}><Icon name="folder" /><span>{t(loaded ? 'Replace' : 'Add track')}</span><input key={id + '-' + deck.revision} aria-label={t((loaded ? 'Replace ' : 'Load track ') + id)} type="file" accept=".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/flac" onChange={receiveFile} /></label>
      </div>
    </header>
    <div className="deck-quick-controls">
    <details className={'deck-quick-effects' + (activeEffects ? ' has-active-effects' : '')}><summary><svg className="effects-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c3-10 3 10 6 0s3 10 6 0 3 10 6 0" /></svg>{t("Effects")}{activeEffects > 0 && <span className="effects-count"><span aria-hidden="true">{t(activeEffects)}</span><span className="visually-hidden">{t(activeEffects)} {t("active effects")}</span></span>}<span className="disclosure-chevron" aria-hidden="true">⌄</span></summary><div className="deck-effects-menu"><FxControls key={trackRevision ?? -1} variant="quick" id={id} value={fx} loaded={loaded} onChange={writeFx} /><button type="button" aria-label={t('FX details ' + id)} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onOpenTools(id,'fx'); }}>{t("FX details")}</button></div></details>
    <button className="deck-tools-entry" type="button" aria-label={t('Tools ' + id)} aria-controls={'dock-panel-'+id} aria-expanded={activeTool==='loop'} onClick={() => onOpenTools(id,'loop')}>
      <span className="loop-symbol" aria-hidden="true">↻</span><span className="deck-tools-entry__status">{t(deck.loopBeats ?? 'Loop')}</span><span className="disclosure-chevron" aria-hidden="true">⌄</span>
    </button>
    <button className="deck-track-disclosure" type="button" aria-label={t('Track information ' + id)} aria-controls={'dock-panel-'+id} aria-expanded={activeTool==='track'} onClick={() => onOpenTools(id,'track')}>•••</button>
    </div>
    <div className="deck-performance">
    <div className="transport-row">
      <CueButton id={id} playing={isPlaying} loaded={loaded} revision={deck.revision} run={run} onAuditionChange={setCueAuditioning} />
      <ToggleButton className="transport-play" tone={id === 'A' ? 'a' : 'b'} aria-label={t('Play/Pause ' + id)} pressed={playIsLatched} disabled={!loaded}
        onClick={() => { if (cueAuditioning) { setCueAuditioning(false); run(() => engine.playDeck(id)); return; } run(() => isPlaying ? engine.pauseDeck(id) : engine.playDeck(id)); }}>
        <Icon name={playIsLatched ? 'pause' : 'play'} /><span className="visually-hidden">{t(isPlaying ? 'Pause' : 'Play')}</span>
      </ToggleButton>
      <ToggleButton className="sync-button" tone="cue" aria-label={t('Sync ' + id)} aria-describedby={'sync-reason-'+id} title={t(syncReasonText(deck))} pressed={deck.sync.status === 'active'} disabled={!loaded}
        onClick={() => run(() => syncForMix(engine,id))}>{t(deck.sync.status==='active'&&deck.sync.mode==='tempo'?'Tempo':'Sync')}</ToggleButton>
      <span id={'sync-reason-'+id} className={'sync-note' + (deck.sync.status === 'unavailable' ? ' is-unavailable' : '')}>{t(syncReasonText(deck))}</span>
    </div>

      <div className="deck-performance__platter"><JogWheel id={id} durationSeconds={deck.durationSeconds} revision={deck.revision} disabled={!loaded} onError={onError} artworkUrl={coverUrl} /><span className="record-caption" aria-hidden="true">{t(loaded ? isPlaying ? 'Scratch · release to keep playing' : 'Play, then try a scratch' : 'Start with a track you love')}</span></div>
      <div className="deck-performance__tools"><BpmControl key={trackRevision ?? -1} id={id} deck={deck} run={run} openTrackBpmRequest={bpmRequest} />
        <LinearControl orientation="vertical" className="tempo-fader" label={t('Tempo ' + id)} value={deck.tempoPercent} min={-16} max={16} step={0.1} defaultValue={0} disabled={!loaded} unit="%" valueText={number => (number > 0 ? '+' : '') + number.toFixed(1) + '%'} onChange={setTempo} />
        <div className="nudge-row"><NudgeButton id={id} direction={-1} enabled={loaded&&isPlaying&&!deck.scratchActive} revision={deck.revision} run={run}/><NudgeButton id={id} direction={1} enabled={loaded&&isPlaying&&!deck.scratchActive} revision={deck.revision} run={run}/></div>
      </div>
    </div>

  </section>;
}
