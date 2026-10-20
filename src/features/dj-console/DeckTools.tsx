import { t } from '../../i18n';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DeckId, DeckSnapshot, HotCueIndex } from '../../audio/types';
import { engine, getSnapshot } from '../../state/engine';
import { LinearControl, ToggleButton } from '../../ui/ControlPrimitives';
import { cancelAllGestures } from '../../ui/gesture-registry';
import { formatMediaTime } from '../../ui/time';
import { FxControls, type DeckFx, type FxWrite } from './FxPads';
import { HotCueGrid } from './HotCueGrid';
import type { DeckToolTab } from './DeckPanel';

const loopOptions = [
  { value: 0.25, name: '1/4 beat' }, { value: 0.5, name: '1/2 beat' }, { value: 1, name: '1 beat' },
  { value: 2, name: '2 beats' }, { value: 4, name: '4 beats' }, { value: 8, name: '8 beats' },
  { value: 16, name: '16 beats' }, { value: 32, name: '32 beats' },
] as const;

const tabs: readonly { readonly id: DeckToolTab; readonly label: string }[] = [
  { id: 'loop', label: 'Loop' }, { id: 'cues', label: 'Cues' }, { id: 'grid', label: 'Grid' },
  { id: 'fx', label: 'FX details' }, { id: 'waveform', label: 'Waveform' }, { id: 'track', label: 'Track' },
];
const views:Record<DeckToolTab,readonly string[]>={loop:['Beat','Jump','Manual'],cues:['Perform','Edit'],grid:['Tempo','Alignment'],fx:['Echo','Room','Flanger','Tremolo','Drive'],waveform:['Zoom'],track:['Adjust','Information']};

export interface DeckToolsProps {
  readonly id: DeckId;
  readonly deck: DeckSnapshot;
  readonly run: (action: () => void | Promise<unknown>) => void;
  readonly onError: (cause: unknown) => void;
  readonly onNotify: (message: string) => void;
  readonly onUnloadDeck: (id: DeckId) => void | Promise<unknown>;
  readonly onOpenBpm: (id: DeckId) => void;
  readonly tab: DeckToolTab;
  readonly onTabChange: (tab: DeckToolTab) => void;
  readonly zoomLevel: 1 | 2 | 4;
  readonly onZoomChange: (zoom: 1 | 2 | 4) => void;
}

interface ManualLoopControlsProps {
  readonly id: DeckId;
  readonly loaded: boolean;
  readonly durationSeconds: number;
  readonly loop: DeckSnapshot['loop'];
  readonly loopBeats: DeckSnapshot['loopBeats'];
  readonly runForTrack: (action: () => void | Promise<unknown>) => void;
}

function ManualLoopControls({ id, loaded, durationSeconds, loop, loopBeats, runForTrack }: ManualLoopControlsProps) {
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(Math.min(1, durationSeconds));
  return <div className="manual-loop">
    <label>{t("Loop start ")}{t(id)}<input type="number" disabled={!loaded} name={'loop-start-' + id} autoComplete="off" min="0" max={durationSeconds || 0} step="0.01" value={loopStart} onChange={event => setLoopStart(Number(event.currentTarget.value))} /></label>
    <label>{t("Loop end ")}{t(id)}<input type="number" disabled={!loaded} name={'loop-end-' + id} autoComplete="off" min="0" max={durationSeconds || 0} step="0.01" value={loopEnd} onChange={event => setLoopEnd(Number(event.currentTarget.value))} /></label>
    <label className="manual-loop__toggle"><input type="checkbox" aria-label={t('Enable loop ' + id)} checked={loop !== null && loopBeats === null} disabled={!loaded}
      onChange={event => runForTrack(() => engine.setLoop(id, event.currentTarget.checked ? { startSeconds: loopStart, endSeconds: loopEnd } : null))} />{t("Enable loop")}</label>
  </div>;
}

type DeckToolsContentProps = Omit<DeckToolsProps, 'onTabChange' | 'onError'> & { readonly view: string };

function DeckToolsContent({ id, deck, run, onUnloadDeck, onOpenBpm, tab, view, zoomLevel, onZoomChange }: DeckToolsContentProps) {
  const loaded = deck.track !== null;
  const trackRevision = deck.track?.revision ?? null;
  const bpm = deck.beatGrid?.bpm ?? null;
  const beatControlsAvailable = loaded && deck.beatGrid !== null;
  const fx = deck.fx as DeckFx;
  const gridSourceText = deck.beatGrid?.source === 'manual' || deck.beatGrid?.source === 'tap'
    ? 'Manual beat grid'
    : deck.bpmAnalysis.status === 'analyzing' ? 'Analysing BPM'
      : deck.bpmAnalysis.status === 'unavailable' ? 'No beat estimate'
        : deck.beatGrid ? Math.round(deck.beatGrid.confidence * 100) + '% grid confidence'
          : 'Choose or tap a tempo';

  function isCurrentTrack(): boolean {
    const current = getSnapshot().decks[id];
    return trackRevision !== null && current.track?.revision === trackRevision && current.revision === trackRevision;
  }
  function runForTrack(action: () => void | Promise<unknown>): void {
    if (isCurrentTrack()) run(action);
  }
  function setGridOffset(next: number): void {
    if (bpm === null) return;
    runForTrack(() => engine.setBeatGrid(id, { bpm, firstBeatSeconds: Math.max(0, Math.min(deck.durationSeconds || 0, next)) }));
  }
  function writeFx(setting: FxWrite): void {
    runForTrack(() => engine.setFx(id, setting));
  }
  function selectCue(index: HotCueIndex): void {
    runForTrack(() => engine.setHotCue(id, index, engine.readPosition(id).positionSeconds));
  }

  return <div className="deck-tools__panels">
    <section id={'deck-tools-' + id + '-panel-loop'} className="deck-tools__panel deck-tools__panel--loop" role="tabpanel" aria-labelledby={'deck-tools-' + id + '-tab-loop'} tabIndex={0} hidden={tab !== 'loop'}>
      <div className="performance-group" aria-label={t('Loop and beat jump ' + id)}>
        <div className="performance-group__heading"><h3>{t("Loop / jump")}</h3>
          <ToggleButton aria-label={t('Quantize ' + id)} pressed={deck.quantize} disabled={!loaded||!deck.beatGrid||(deck.beatGrid.source==='auto'&&deck.beatGrid.confidence<.75)} title={t("Quantize needs confirmed beat alignment; estimated BPM loops start here")} onClick={() => runForTrack(() => engine.setQuantize(id, !deck.quantize))}>{t("Quantize")}</ToggleButton>
        </div>
        {loaded && !beatControlsAvailable && view !== 'Manual' && <div className="loop-tempo-required"><span>{t("Set BPM for beat loops / jump.")}</span><button type="button" aria-label={t('Set BPM for loop and jump ' + id)} onClick={() => onOpenBpm(id)}>{t("Set BPM")}</button></div>}
        <div className="loop-pad-grid">{loopOptions.map(option => <ToggleButton key={option.value} className="loop-pad" aria-label={t('Loop ' + option.name + ' ' + id)} pressed={deck.loopBeats === option.value} disabled={!loaded || (!beatControlsAvailable && deck.loopBeats !== option.value)}
          onClick={() => runForTrack(() => deck.loopBeats === option.value ? engine.setLoop(id, null) : engine.setBeatLoop(id, option.value))}>{t(option.name)}</ToggleButton>)}</div>
        <div className="beat-jump-row"><button type="button" aria-label={t('−1 beat · Beat jump back 1 beat ' + id)} disabled={!beatControlsAvailable} onClick={() => runForTrack(() => engine.beatJump(id, -1))}>{t("−1 beat")}</button>
          <button type="button" aria-label={t('+1 beat · Beat jump forward 1 beat ' + id)} disabled={!beatControlsAvailable} onClick={() => runForTrack(() => engine.beatJump(id, 1))}>{t("+1 beat")}</button></div>
        <ManualLoopControls key={trackRevision ?? -1} id={id} loaded={loaded} durationSeconds={deck.durationSeconds} loop={deck.loop} loopBeats={deck.loopBeats} runForTrack={runForTrack} />
      </div>
    </section>

    <section id={'deck-tools-' + id + '-panel-cues'} className="deck-tools__panel deck-tools__panel--cues" role="tabpanel" aria-labelledby={'deck-tools-' + id + '-tab-cues'} tabIndex={0} hidden={tab !== 'cues'}>
      <div className="performance-group hot-cue-group" aria-label={t('Hot cues ' + id)}>
        <div className="performance-group__heading"><h3>{t("Hot cues")}</h3><span>{t("8 slots")}</span></div>
        <div className="cue-point-tools"><span>{t("Set cue point ·")}{t(formatMediaTime(deck.cueSeconds))}</span>
          <button type="button" className="set-cue" aria-label={t('Set cue point ' + id)} disabled={!loaded} onClick={() => runForTrack(() => engine.setCuePoint(id))}>{t("Set cue")}</button>
        </div>
        <HotCueGrid id={id} slots={deck.hotCues} loaded={loaded} onSet={selectCue}
          onTrigger={index => { if (isCurrentTrack()) return run(() => engine.triggerHotCue(id, index)); }}
          onClear={index => runForTrack(() => engine.clearHotCue(id, index))} />
      </div>
    </section>

    <section id={'deck-tools-' + id + '-panel-grid'} className="deck-tools__panel deck-tools__panel--grid" role="tabpanel" aria-labelledby={'deck-tools-' + id + '-tab-grid'} tabIndex={0} hidden={tab !== 'grid'}>
      <div className="grid-tools__editor">
        <div className="bpm-readout"><span>{t("Beat grid")}</span><strong>{t(bpm?.toFixed(1) ?? '—')}<small> {t("BPM")}</small></strong><small className="bpm-readout__confidence">{t(gridSourceText)}</small></div>
        <div className="grid-tools__buttons">
          <button type="button" aria-label={t('Open track BPM ' + id)} disabled={!loaded} onClick={() => onOpenBpm(id)}>{t("Track BPM")}</button>
        </div>
        <div className="grid-tools__alternatives">{deck.bpmAnalysis.candidates.filter(candidate => candidate.bpm >= 30 && candidate.bpm <= 300).slice(0, 3).map((candidate, index) => <button type="button" key={candidate.bpm + '-' + index} aria-label={t('Use ' + candidate.bpm.toFixed(1) + ' BPM grid ' + id)}
            title={t('Use this beat estimate (' + Math.round(candidate.confidence * 100) + '% confidence)')} disabled={!loaded}
            onClick={() => runForTrack(() => engine.setBeatGrid(id, { bpm: candidate.bpm, firstBeatSeconds: candidate.firstBeatSeconds }))}>{t(candidate.bpm.toFixed(1))}</button>)}
        </div>
        {deck.beatGrid && <LinearControl className="grid-offset" label={t('Beat grid offset ' + id)} value={deck.beatGrid.firstBeatSeconds} min={0} max={Math.max(0.01, deck.durationSeconds)} step={0.001} disabled={!loaded}
          valueText={number => formatMediaTime(number)} onChange={setGridOffset} />}
      </div>
    </section>

    <section id={'deck-tools-' + id + '-panel-fx'} className="deck-tools__panel deck-tools__panel--fx" role="tabpanel" aria-labelledby={'deck-tools-' + id + '-tab-fx'} tabIndex={0} hidden={tab !== 'fx'}>
      <FxControls key={trackRevision ?? -1} variant="details" id={id} value={fx} loaded={loaded} onChange={writeFx} />
    </section>

    <section id={'deck-tools-' + id + '-panel-waveform'} className="deck-tools__panel deck-tools__panel--waveform" role="tabpanel" aria-labelledby={'deck-tools-' + id + '-tab-waveform'} tabIndex={0} hidden={tab !== 'waveform'}>
      <div className="waveform-tools" role="group" aria-label={t('Waveform zoom ' + id)}>
        <h3>{t("Waveform zoom")}</h3>
        {([1, 2, 4] as const).map(value => <ToggleButton key={value} aria-label={t(value + '× · Waveform zoom ' + value + 'x ' + id)} pressed={zoomLevel === value} disabled={!loaded}
          onClick={() => onZoomChange(value)}>{t(value)}×</ToggleButton>)}
      </div>
    </section>

    <section id={'deck-tools-' + id + '-panel-track'} className="deck-tools__panel deck-tools__panel--track" role="tabpanel" aria-labelledby={'deck-tools-' + id + '-tab-track'} tabIndex={0} hidden={tab !== 'track'}>
      <div className="track-tools">
        <div><h3>{t("Track")}</h3><p>{deck.track?.name ?? t('No track loaded')}</p>
          {deck.track && <p>{t(deck.track.format.toUpperCase())} · {t(formatMediaTime(deck.durationSeconds))}</p>}
        </div>
        <div className="track-tools__tempo" role="group" aria-label={t('Tempo adjustment ' + id)}>
          <span>{t("Tempo")}{t(deck.tempoPercent > 0 ? '+' : '')}{t(deck.tempoPercent.toFixed(1))}%</span>
          <button type="button" aria-label={t('Open track BPM ' + id)} disabled={!loaded} onClick={() => onOpenBpm(id)}>{t("Track BPM")}</button>
        </div>
        {loaded && <button type="button" className="deck-unload" aria-label={t('Unload track ' + id)} onClick={() => runForTrack(() => onUnloadDeck(id))}>{t("Unload track")}</button>}
      </div>
    </section>
  </div>;
}

export function DeckTools(props: DeckToolsProps) {
  const { id, deck, run, onNotify, onUnloadDeck, onOpenBpm, tab, onTabChange, zoomLevel, onZoomChange } = props;
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const revision = deck.track?.revision ?? -1;
  const [selectedViews,setSelectedViews]=useState<Record<DeckToolTab,string>>({loop:'Beat',cues:'Perform',grid:'Tempo',fx:'Echo',waveform:'Zoom',track:'Adjust'});
  function selectTab(next: DeckToolTab, focus = false): void {
    if (tab === next) return;
    cancelAllGestures();
    onTabChange(next);
    if (focus) {
      const index = tabs.findIndex(item => item.id === next);
      requestAnimationFrame(() => tabButtons.current[index]?.focus());
    }
  }
  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const index = tabs.findIndex(item => item.id === tab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      selectTab(tabs[nextIndex].id, true);
    }
  }

  return <section className="deck-tools" aria-label={t('Tools ' + id)} data-view={selectedViews[tab].toLowerCase()}>
    <div className="deck-tools__tabs" role="tablist" aria-label={t('Deck ' + id + ' tools')}>
      {tabs.map((item, index) => <button ref={element => { tabButtons.current[index] = element; }} key={item.id} type="button" role="tab"
        id={'deck-tools-' + id + '-tab-' + item.id} aria-controls={'deck-tools-' + id + '-panel-' + item.id} aria-selected={tab === item.id}
        tabIndex={tab === item.id ? 0 : -1} className={'deck-tools__tab' + (tab === item.id ? ' is-active' : '')}
        onClick={() => selectTab(item.id)} onKeyDown={handleTabKeyDown}>{t(item.label)}</button>)}
    </div>
    {tab==='loop'?<div className="tool-view-selector loop-view-switch" role="group" aria-label={t('Loop controls '+id)}>{views.loop.map(view=><button type="button" key={view} aria-label={t(view+' loop view '+id)} aria-pressed={selectedViews.loop===view} onClick={()=>{cancelAllGestures();setSelectedViews(current=>({...current,loop:view}));}}>{t(view==='Beat'?'Loop length':view==='Jump'?'Beat jump':'Custom loop')}</button>)}</div>:views[tab].length>1?<label className="tool-view-selector"><span className="visually-hidden">{t(tab)} {t("view")}{t(id)}</span>
      <select aria-label={t(tab+' view '+id)} value={selectedViews[tab]} onChange={event=>{const next=event.currentTarget.value;cancelAllGestures();setSelectedViews(current=>({...current,[tab]:next}));}}>
        {views[tab].map(view=><option key={view} value={view}>{t(view)}</option>)}
      </select>
    </label>:null}
    <DeckToolsContent key={revision} id={id} deck={deck} run={run} onNotify={onNotify} onUnloadDeck={onUnloadDeck} onOpenBpm={onOpenBpm} tab={tab} view={selectedViews[tab]} zoomLevel={zoomLevel} onZoomChange={onZoomChange} />
  </section>;
}
