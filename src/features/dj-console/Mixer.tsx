import { t } from '../../i18n';
import type { AudioSnapshot, DeckId, EqBand } from '../../audio/types';
import { useLayoutEffect, useRef, useState } from 'react';
import { cancelAllGestures } from '../../ui/gesture-registry';
import { engine } from '../../state/engine';
import { Knob, LinearControl, ToggleButton } from '../../ui/ControlPrimitives';
import { TransitionCanvas } from './TransitionCanvas';
import { Icon } from '../../ui/Icon';

export interface MixerProps {
  readonly snapshot: AudioSnapshot;
  readonly run: (action: () => void | Promise<unknown>) => void;
  readonly onOpenTools: () => void;
  readonly onLearn: () => void;
  readonly onTransitionComplete: () => void;
}

interface MixerToolsProps {
  readonly snapshot: AudioSnapshot;
  readonly run: MixerProps['run'];
}

interface MixerAdjustmentProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly valueText: string;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}

const EQ_BANDS: readonly { readonly band: EqBand; readonly label: string }[] = [
  { band: 'high', label: 'High' },
  { band: 'mid', label: 'Mid' },
  { band: 'low', label: 'Low' },
];

function MixerAdjustment({ label, value, min, max, step, defaultValue, valueText, disabled, onChange }: MixerAdjustmentProps) {
  const setStep = (direction: -1 | 1) => {
    const precision = Math.min(5, (String(step).split('.')[1] || '').length);
    const next = Math.min(max, Math.max(min, value + direction * step));
    onChange(Number(next.toFixed(precision)));
  };

  return <div className="mixer-adjustment" role="group" aria-label={t(label)}>
    <div className="mixer-adjustment__readout"><span>{t(label)}</span><output>{t(valueText)}</output></div>
    <div className="mixer-adjustment__actions">
      <button type="button" aria-label={t('Decrease ' + label)} title={t('Decrease ' + label)} disabled={disabled || value <= min} onClick={() => setStep(-1)}>−</button>
      <button type="button" aria-label={t('Increase ' + label)} title={t('Increase ' + label)} disabled={disabled || value >= max} onClick={() => setStep(1)}>+</button>
      <button type="button" aria-label={t('Reset ' + label)} title={t('Reset ' + label)} disabled={disabled || value === defaultValue} onClick={() => onChange(defaultValue)}>{t("Reset")}</button>
    </div>
  </div>;
}

function filterText(value: number): string {
  return value < -0.04 ? t('Low-pass') + ' ' + Math.round(Math.abs(value) * 100) + '%'
    : value > 0.04 ? t('High-pass') + ' ' + Math.round(value * 100) + '%'
      : t('Bypass');
}

export function Mixer({ snapshot, run, onOpenTools, onLearn, onTransitionComplete }: MixerProps) {
  const [fullControls, setFullControls] = useState(false);
  const [canvasOpen,setCanvasOpen] = useState(true);
  const mixerSection = useRef<HTMLElement>(null);
  const fullButton = useRef<HTMLButtonElement>(null);
  const returnToCanvas = useRef(true);
  const ready=Boolean(snapshot.decks.A.track&&snapshot.decks.B.track)&&!['closed','disposed','faulted'].includes(snapshot.contextState);
  const bothPlaying=snapshot.contextState==='running'&&snapshot.decks.A.status==='playing'&&snapshot.decks.B.status==='playing';
  const closeFull = () => {
    cancelAllGestures();
    setFullControls(false);
    setCanvasOpen(returnToCanvas.current);
    fullButton.current?.focus({preventScroll:true});
  };
  const changeEq = (id: DeckId, band: EqBand, value: number) => run(() => engine.setEqDb(id, band, value));
  useLayoutEffect(() => {
    if (!fullControls) return;
    const focusOverlay = () => {
      const section = mixerSection.current;
      if (!section || document.querySelector('dialog[open]') || getComputedStyle(section).position !== 'fixed') return;
      if (!section.contains(document.activeElement)) {
        section.querySelector<HTMLButtonElement>('.mixer-close')?.focus({ preventScroll: true });
      }
    };
    const section = mixerSection.current;
    if (section && getComputedStyle(section).position === 'fixed') {
      section.querySelector<HTMLButtonElement>('.mixer-close')?.focus({ preventScroll: true });
    }
    window.addEventListener('resize', focusOverlay);
    return () => window.removeEventListener('resize', focusOverlay);
  }, [fullControls]);

  return <section ref={mixerSection} className={'mixer-console' + (!fullControls ? ' is-simple' : '')} aria-label={t("Mixer")} onKeyDown={event=>{
    if(event.key==='Escape'&&fullControls){event.preventDefault();event.stopPropagation();closeFull();}
    if (event.key === 'Tab' && fullControls && getComputedStyle(event.currentTarget).position === 'fixed') {
      // Full is an overlay only on compact screens. Preserve ordinary tabbing
      // through the desktop inline mixer and avoid making native dialogs inert.
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])',
      )].filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus({ preventScroll: true });
      }
    }
  }}>
    <div className="mixer-console__heading">
      <h2 className="visually-hidden">{t("Mixer")}</h2>
      <ToggleButton className="mixer-mode" aria-label={t("Transition canvas")} pressed={canvasOpen} onClick={()=>{cancelAllGestures();setFullControls(false);setCanvasOpen(current=>!current);}}>{t("Canvas")}</ToggleButton>
      <ToggleButton ref={fullButton} className="mixer-mode mixer-view-toggle" aria-label={t("Full mixer controls")} aria-expanded={fullControls} aria-controls="mixer-core" title={t("Show all mixer controls")} pressed={fullControls} onClick={() => {
        if(fullControls){closeFull();return;}
        cancelAllGestures();returnToCanvas.current=canvasOpen;setCanvasOpen(false);setFullControls(true);
      }}>{t("Full")}</ToggleButton>
      {fullControls && <button type="button" className="mixer-close" aria-label={t("Close full mixer controls")} title={t("Close full mixer controls · Esc")} onClick={closeFull}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
      <div className="mixer-console__deck-headings" aria-hidden="true">
        <span className="deck-a-text">{t("A")}</span><span className="deck-b-text">{t("B")}</span>
      </div>
      <button type="button" className="mixer-console__tools-entry" aria-label={t("Mixer settings")} title={t("Mixer settings")} onClick={onOpenTools}>•••</button>
    </div>

    <div id="mixer-core" className={'mixer-console__core'+(canvasOpen?' has-transition-canvas':'')}>
    {canvasOpen ? <TransitionCanvas snapshot={snapshot} run={run} onLearn={onLearn} onComplete={onTransitionComplete}/> : <>
    <span className="mixer-volume-caption" aria-hidden="true">{t("Volume")}</span>
    <div className="mixer-labels" aria-hidden="true">{['Gain','High','Mid','Low','Filter'].map(label=><span key={label}>{t(label)}</span>)}</div>
    <div className="mixer-console__channels" aria-label={t("Tone controls")}>
      {(['A', 'B'] as const).map(id => {
        const deck = snapshot.decks[id];
        return <section className={'channel-strip channel-strip-' + id} aria-label={t('Tone controls for Deck ' + id)} key={id}>
          <Knob className="channel-strip__tone-control" label={t('Gain '+id)} displayLabel={t("Gain")} value={deck.gainDb} min={-24} max={12} step={0.5} defaultValue={-3} disabled={!deck.track}
            valueText={n=>n.toFixed(1)+' dB'} onChange={n=>run(()=>engine.setGainDb(id,n))} />
          {EQ_BANDS.map(({ band, label }) => <Knob key={band} className="channel-strip__tone-control" label={t(label + ' ' + id)} displayLabel={t(band === 'high' ? 'Treble' : band === 'low' ? 'Bass' : 'Mid')}
            value={deck.eqDb[band]} min={-24} max={6} step={0.5} defaultValue={0} unit=" dB" disabled={!deck.track}
            valueText={number => number.toFixed(1) + ' dB'} onChange={value => changeEq(id, band, value)} />)}
          <Knob className="channel-strip__tone-control" label={t('Filter ' + id)} displayLabel={t("Filter")} value={deck.filterValue} min={-1} max={1} step={0.01} defaultValue={0} disabled={!deck.track}
            valueText={filterText}
            onChange={value => run(() => engine.setFilter(id, value))} />
        </section>;
      })}
    </div>

    <div className="mixer-console__volumes" aria-label={t("Channel volumes")}>
      {(['A', 'B'] as const).map(id => <LinearControl key={id} className={'channel-strip__fader channel-strip__fader-' + id}
        label={t('Volume ' + id)} value={snapshot.decks[id].volume} min={0} max={1} step={0.01} defaultValue={1} orientation="vertical"
        disabled={!snapshot.decks[id].track} valueText={value => Math.round(value * 100) + '%'}
        onChange={value => run(() => engine.setVolume(id, value))} />)}
    </div>

    </>}
    </div>
    <button className="mixer-shared-transport" type="button" disabled={!ready} aria-label={t(bothPlaying?'Pause both decks':'Play both decks')} onClick={()=>{cancelAllGestures();run(()=>bothPlaying?engine.pauseDecks():engine.playDecks());}}><Icon name={bothPlaying?'pause':'play'}/>{t(bothPlaying?'Pause both':'Play both')}</button>
    <div className="mixer-console__crossfader">
      <span className="blend-caption" aria-hidden="true" data-direction={snapshot.mixer.crossfader < 0.45 ? 'A' : snapshot.mixer.crossfader > 0.55 ? 'B' : 'centre'}>{t(snapshot.mixer.crossfader < 0.45 ? '← More A' : snapshot.mixer.crossfader > 0.55 ? 'More B →' : 'Blend the tracks')}</span>
      <div className="mixer-console__crossfader-summary"><span>{t("Curve")}</span><strong>{t(snapshot.mixer.crossfaderCurve === 'mix' ? 'Mix' : 'Cut')}</strong></div>
      <LinearControl className="crossfader-control" label={t("Crossfader")} value={snapshot.mixer.crossfader} min={0} max={1} step={0.005} defaultValue={0.5}
        lowLabel={t("A")} highLabel={t("B")} valueText={value => value === 0.5 ? 'Centre' : Math.round(value * 100) + '%'}
        onChange={value => run(() => engine.setCrossfader(value))} />
    </div>

    <LinearControl className="master-control" label={t("Master")} value={snapshot.mixer.masterVolume} min={0} max={1} step={0.01} defaultValue={1}
      valueText={value => Math.round(value * 100) + '%'} onChange={value => run(() => engine.setMasterVolume(value))} />
  </section>;
}

export function MixerTools({ snapshot, run }: MixerToolsProps) {
  const [channel,setChannel]=useState<DeckId>('A');
  const [parameter,setParameter]=useState('Low');
  const [view,setView]=useState('Adjust');
  return <section className="mixer-tools" aria-label={t("Mixer settings")}>
    <div className="mixer-tools__navigation"><select aria-label={t("Mixer view")} value={view} onChange={event=>setView(event.currentTarget.value)}><option value={"Adjust"}>{t("Adjust")}</option><option value={"Curve"}>{t("Curve")}</option></select>
      <select hidden={view!=='Adjust'} aria-label={t("Adjustment channel")} value={channel} onChange={event=>setChannel(event.currentTarget.value as DeckId)}><option value={"A"}>{t("A")}</option><option value={"B"}>{t("B")}</option></select>
      <select hidden={view!=='Adjust'} aria-label={t("Adjustment parameter")} value={parameter} onChange={event=>setParameter(event.currentTarget.value)}>{['Gain','High','Mid','Low','Filter'].map(name=><option key={name} value={name}>{t(name)}</option>)}</select>
    </div>
    <div className="mixer-tools__channels" hidden={view!=='Adjust'}>
      {(['A', 'B'] as const).map(id => {
        const deck = snapshot.decks[id];
        const adjustments: MixerAdjustmentProps[] = [
          { label: 'Gain ' + id, value: deck.gainDb, min: -24, max: 12, step: 0.5, defaultValue: -3, valueText: deck.gainDb.toFixed(1) + ' dB', disabled: !deck.track, onChange: value => run(() => engine.setGainDb(id, value)) },
          ...EQ_BANDS.map(({ band, label }) => ({ label: label + ' ' + id, value: deck.eqDb[band], min: -24, max: 6, step: 0.5, defaultValue: 0, valueText: deck.eqDb[band].toFixed(1) + ' dB', disabled: !deck.track, onChange: (value: number) => run(() => engine.setEqDb(id, band, value)) })),
          { label: 'Filter ' + id, value: deck.filterValue, min: -1, max: 1, step: 0.01, defaultValue: 0, valueText: filterText(deck.filterValue), disabled: !deck.track, onChange: value => run(() => engine.setFilter(id, value)) },
        ];

        return <section className={'mixer-tools__channel mixer-tools__channel-' + id} hidden={channel!==id} key={id} aria-label={t('Deck ' + id + ' adjustments')}>
          <div className="mixer-tools__channel-heading"><h3>{t("Deck ")}{t(id)}</h3>
          </div>
          <div className="mixer-tools__adjustments">
            {adjustments.map(adjustment => <div key={adjustment.label} hidden={adjustment.label!==parameter+' '+channel}><MixerAdjustment {...adjustment} /></div>)}
          </div>
        </section>;
      })}
    </div>

    <div className="mixer-tools__curve" hidden={view!=='Curve'}>
      <div className="mixer-tools__section-heading"><h3>{t("Crossfader curve")}</h3><span>{t("Choose how the blend changes across the rail.")}</span></div>
      <div className="curve-select" role="group" aria-label={t("Crossfader curve")}>
        <ToggleButton aria-label={t("Crossfade mix curve")} pressed={snapshot.mixer.crossfaderCurve === 'mix'} onClick={() => run(() => engine.setCrossfaderCurve('mix'))}>{t("Mix")}</ToggleButton>
        <ToggleButton aria-label={t("Crossfade cut curve")} pressed={snapshot.mixer.crossfaderCurve === 'cut'} onClick={() => run(() => engine.setCrossfaderCurve('cut'))}>{t("Cut")}</ToggleButton>
      </div>
    </div>
  </section>;
}
