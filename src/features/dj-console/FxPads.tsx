import { t } from '../../i18n';
import { FxPerformance } from './FxPerformance';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { DeckId, FxSnapshot, AudioEngine } from '../../audio/types';
import { ToggleButton } from '../../ui/ControlPrimitives';
import { cancelAllGestures, registerGesture } from '../../ui/gesture-registry';
import { Icon } from '../../ui/Icon';
import { engine } from '../../state/engine';
import { permanentFxEnabled } from './transition-gesture';

export type DelayFx = { readonly enabled: boolean; readonly wet: number; readonly feedback: number; readonly division: 0.25 | 0.5 | 1 };
export type ReverbFx = { readonly enabled: boolean; readonly wet: number };
export type DeckFx = FxSnapshot;
export type FxWrite = Parameters<AudioEngine['setFx']>[1];

export type FxType = 'delay' | 'reverb' | 'flanger' | 'tremolo' | 'drive';
export const fxLabels: Record<FxType,string> = {delay:'Echo',reverb:'Room',flanger:'Flanger',tremolo:'Tremolo',drive:'Drive'};
const formatPercent = (value: number) => (value * 100).toFixed(1) + '%';

interface FxHoldControlProps {
  readonly id: DeckId;
  readonly type: FxType;
  readonly enabled: boolean;
  readonly loaded: boolean;
  readonly latched: boolean;
  readonly onLatch: (latched: boolean) => void;
  readonly onHoldStart: () => void;
  readonly onHoldEnd: () => void;
}

export function FxHoldControl({ id, type, enabled, loaded, latched, onLatch, onHoldStart, onHoldEnd }: FxHoldControlProps) {
  const holdButton = useRef<HTMLButtonElement>(null);
  const activePointer = useRef<number | null>(null);
  const held = useRef(false);
  const activeKey = useRef<string | null>(null);
  const [pointerHeld, setPointerHeld] = useState(false);
  const latchedRef = useRef(latched);
  const onHoldEndRef = useRef(onHoldEnd);
  const unregister = useRef<(() => void) | null>(null);
  const label = fxLabels[type];

  useLayoutEffect(() => {
    latchedRef.current = latched;
    onHoldEndRef.current = onHoldEnd;
  }, [latched, onHoldEnd]);

  function finish(pointerId?: number): void {
    if (!held.current || (pointerId !== undefined && pointerId !== activePointer.current)) return;
    const activeId = activePointer.current;
    activePointer.current = null;
    activeKey.current = null;
    held.current = false;
    setPointerHeld(false);
    unregister.current?.();
    unregister.current = null;
    holdButton.current?.classList.remove('is-held');
    if (activeId !== null && holdButton.current?.hasPointerCapture(activeId)) {
      try { holdButton.current.releasePointerCapture(activeId); } catch { /* Capture may already be gone. */ }
    }
    onHoldEndRef.current();
  }
  useEffect(() => { if (!loaded) finish(); }, [loaded]);
  useEffect(() => () => finish(), []);

  function begin(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!loaded || event.button !== 0 || held.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    activePointer.current = event.pointerId;
    held.current = true;
    setPointerHeld(true);
    event.currentTarget.classList.add('is-held');
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Central blur cleanup still ends the hold. */ }
    unregister.current = registerGesture(() => finish(event.pointerId));
    onHoldStart();
  }
  function beginKey(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Escape') { event.preventDefault(); finish(); return; }
    if (event.code !== 'Space' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!loaded || event.repeat || held.current) return;
    cancelAllGestures();
    held.current = true;
    activeKey.current = event.code;
    setPointerHeld(true);
    unregister.current = registerGesture(() => finish());
    onHoldStart();
  }
  function toggleLatch(): void {
    const next = !latchedRef.current;
    latchedRef.current = next;
    onLatch(next);
  }

  return <div className={'fx-control__group fx-pad fx-pad-' + type}>
    <div className="fx-control__head"><h4>{t(label)}</h4><span className="fx-control__state">{t(latched ? 'On · kept' : pointerHeld ? 'Held' : enabled ? 'On' : 'Off')}</span></div>
    <div className="fx-control__actions">
      <ToggleButton ref={holdButton} className="fx-control__hold fx-pad__button" tone={id === 'A' ? 'a' : 'b'} aria-label={t('Hold ' + label + ' ' + id)}
        aria-describedby={'fx-hold-instructions-'+id+'-'+type}
        pressed={enabled || pointerHeld || latched} disabled={!loaded} onPointerDown={begin}
        onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)}
        onLostPointerCapture={event => finish(event.pointerId)} onKeyDown={beginKey}
        onKeyUp={event => { if (event.code === activeKey.current) { event.preventDefault(); finish(); } }} onBlur={()=>{if(activeKey.current!==null)finish();}}><span className="fx-hold-invitation">{t(pointerHeld ? 'Release to return' : latched ? 'Effect kept on' : 'Hold to try')}</span><span className="fx-hold-name">{t(label)}</span></ToggleButton>
      <ToggleButton className="fx-control__keep fx-pad__latch" tone="cue" aria-label={t('Keep ' + label + ' ' + id)} pressed={latched} disabled={!loaded} onClick={toggleLatch}>
        <span title={t('Keep '+label+' on')}><Icon name="pin" /><span className="fx-keep-label">{t("Keep")}</span></span>
      </ToggleButton>
    </div>
    <span id={'fx-hold-instructions-'+id+'-'+type} className="visually-hidden">{t("Hold the pointer, Space or Enter to try the effect. Release, Escape or leave focus to return. Keep toggles the effect permanently.")}</span>
  </div>;
}

interface FxRangeProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
  readonly formatValue: (value: number) => string;
}

function FxRange({ label, value, min, max, step, disabled, onChange, formatValue }: FxRangeProps) {
  const latestValue = useRef(value);
  useLayoutEffect(() => { latestValue.current = value; }, [value]);
  function handleArrow(event: ReactKeyboardEvent<HTMLInputElement>): void {
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const normalStep = Math.min(step, 0.01);
    const increment = event.shiftKey ? Math.min(normalStep / 10, 0.001) : normalStep;
    const next = Math.min(max, Math.max(min, latestValue.current + direction * increment));
    const rounded = Number(next.toFixed(3));
    latestValue.current = rounded;
    onChange(rounded);
  }
  function updateValue(next: number): void {
    latestValue.current = next;
    onChange(next);
  }
  return <label className="fx-control__amount">
    <span className="fx-control__amount-label">{t(label)}</span>
    <input className="fx-control__range" type="range" aria-label={t(label)} aria-valuetext={formatValue(value)} min={min} max={max} step="0.001" value={value}
      disabled={disabled} onChange={event => updateValue(Number(event.currentTarget.value))} onKeyDown={handleArrow} />
    <output className="fx-control__amount-value">{t(formatValue(value))}</output>
  </label>;
}

export interface FxControlsProps {
  readonly variant: 'quick' | 'details';
  readonly id: DeckId;
  readonly value: DeckFx;
  readonly loaded: boolean;
  readonly onChange: (setting: FxWrite) => void;
}

function FxDetailsControls({ id, value, loaded, onChange }: Omit<FxControlsProps, 'variant'>) {
  function write(setting: FxWrite): void {
    onChange(setting);
  }
  function writeDelay(changes: Partial<DelayFx>, enabled = permanentFxEnabled(engine, id, 'delay')): void {
    write({ type: 'delay', ...value.delay, ...changes, enabled });
  }
  function writeReverb(changes: Partial<ReverbFx>, enabled = permanentFxEnabled(engine, id, 'reverb')): void {
    write({ type: 'reverb', ...value.reverb, ...changes, enabled });
  }
  return <section className="fx-controls fx-controls--details" aria-label={t('FX details ' + id)}>
    <section className="fx-detail-group" data-effect="delay" aria-label={t('Echo details ' + id)}>
      <div className="fx-detail-heading"><h3>{t("Echo details")}</h3><ToggleButton aria-label={t('Enable Echo '+id)} pressed={permanentFxEnabled(engine,id,'delay')} disabled={!loaded} onClick={()=>writeDelay({},!permanentFxEnabled(engine,id,'delay'))}>{t("On")}</ToggleButton></div>
      <div className="fx-pad__settings">
        <FxRange label={t('Delay wet ' + id)} value={value.delay.wet} min={0} max={0.5} step={0.01} disabled={!loaded} formatValue={formatPercent} onChange={wet => writeDelay({ wet })} />
        <FxRange label={t('Feedback ' + id)} value={value.delay.feedback} min={0} max={0.6} step={0.01} disabled={!loaded} formatValue={formatPercent} onChange={feedback => writeDelay({ feedback })} />
      </div>
      <div className="fx-divisions" role="group" aria-label={t('Delay division ' + id)}>
        {([0.25, 0.5, 1] as const).map(division => <ToggleButton key={division} aria-label={t((division === 0.25 ? '¼ beat' : division === 0.5 ? '½ beat' : '1 beat') + ' · Delay division ' + (division === 0.25 ? '1/4' : division === 0.5 ? '1/2' : '1') + ' beat ' + id)}
          pressed={value.delay.division === division} disabled={!loaded} onClick={() => writeDelay({ division })}>{t(division === 0.25 ? '¼' : division === 0.5 ? '½' : '1')} {t("beat")}</ToggleButton>)}
      </div>
    </section>
    <section className="fx-detail-group" data-effect="reverb" aria-label={t('Room details ' + id)}>
      <div className="fx-detail-heading"><h3>{t("Room details")}</h3><ToggleButton aria-label={t('Enable Room '+id)} pressed={permanentFxEnabled(engine,id,'reverb')} disabled={!loaded} onClick={()=>writeReverb({},!permanentFxEnabled(engine,id,'reverb'))}>{t("On")}</ToggleButton></div>
      <div className="fx-pad__settings fx-pad__settings-single">
        <FxRange label={t('Reverb wet ' + id)} value={value.reverb.wet} min={0} max={0.4} step={0.01} disabled={!loaded} formatValue={formatPercent} onChange={wet => writeReverb({ wet })} />
      </div>
    </section>
    {(['flanger','tremolo','drive'] as const).map(type=><section key={type} className="fx-detail-group" data-effect={type} aria-label={t(fxLabels[type]+' details '+id)}>
      <h3>{t(fxLabels[type])} {t("details")}</h3><div className="fx-pad__settings">
      <FxRange label={t(fxLabels[type]+' amount '+id)} value={value[type].amount} min={0} max={1} step={.01} disabled={!loaded} formatValue={formatPercent} onChange={amount=>write({type,...value[type],amount,enabled:permanentFxEnabled(engine,id,type)} as FxWrite)} />
      {type!=='drive'&&<FxRange label={t(fxLabels[type]+' rate '+id)} value={value[type].rate} min={.1} max={8} step={.1} disabled={!loaded} formatValue={rate=>rate.toFixed(1)+' Hz'} onChange={rate=>write({type,...value[type],rate,enabled:permanentFxEnabled(engine,id,type)})} />}
      <ToggleButton aria-label={t('Enable '+fxLabels[type]+' '+id)} pressed={permanentFxEnabled(engine,id,type)} disabled={!loaded} onClick={()=>write({type,...value[type],enabled:!permanentFxEnabled(engine,id,type)} as FxWrite)}>{t("On")}</ToggleButton>
      </div></section>)}
  </section>;
}

export function FxControls(props: FxControlsProps) {
  if (props.variant === 'details') {
    return <FxDetailsControls id={props.id} value={props.value} loaded={props.loaded} onChange={props.onChange} />;
  }
  return <FxPerformance id={props.id} value={props.value} loaded={props.loaded} onChange={props.onChange} />;
}
