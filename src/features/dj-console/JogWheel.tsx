import { t } from '../../i18n';
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { DeckId } from '../../audio/types';
import { engine, getSnapshot } from '../../state/engine';
import { registerGesture } from '../../ui/gesture-registry';
import { formatMediaTime } from '../../ui/time';
import { registerVisualTask } from '../../ui/visual-loop';
import { createScratchAnchor, sampleScratchMotion, smoothScratchVelocity, type ScratchAnchor } from '../../ui/ScratchMotion';

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type ScratchGesture = {
  pointerId: number;
  centerX: number;
  centerY: number;
  anchor: ScratchAnchor;
  radius: number;
  linear: boolean;
  dragAxis: 'x' | 'y' | null;
  lastX: number;
  lastY: number;
  lastAt: number;
  lastActivity: number;
  position: number;
  velocity: number;
  ready: boolean;
  ended: boolean;
  beginPromise: Promise<boolean>;
  revision: number;
  unregister: (() => void) | null;
};

export interface JogWheelProps {
  readonly id: DeckId;
  readonly durationSeconds: number;
  readonly revision: number;
  readonly disabled?: boolean;
  readonly onError: (cause: unknown) => void;
  readonly artworkUrl?: string | null;
}

export function JogWheel({ id, durationSeconds, revision, disabled = false, onError, artworkUrl }: JogWheelProps) {
  const node = useRef<HTMLDivElement>(null);
  const disc = useRef<HTMLDivElement>(null);
  const gesture = useRef<ScratchGesture | null>(null);
  const stopRef = useRef<(pointerId: number) => void>(() => undefined);
  const disabledRef = useRef(disabled);
  const durationRef = useRef(durationSeconds);
  const onErrorRef = useRef(onError);

  function report(action: Promise<unknown>): void { void action.catch(cause => onErrorRef.current(cause)); }
  function stillOwnsTrack(trackRevision: number): boolean {
    const deck = getSnapshot().decks[id];
    return deck.track !== null && deck.track.revision === trackRevision && deck.revision === trackRevision;
  }
  function finish(pointerId: number): void {
    const current = gesture.current;
    if (!current || current.pointerId !== pointerId) return;
    gesture.current = null;
    current.unregister?.();
    node.current?.classList.remove('is-scratching');
    if (node.current?.hasPointerCapture(pointerId)) {
      try { node.current.releasePointerCapture(pointerId); } catch { /* Capture may already have been released. */ }
    }
    current.ended = true;
    const trackRevision = current.revision;
    if (!stillOwnsTrack(trackRevision)) return;
    if (current.ready) report(engine.endScratch(id));
    else void current.beginPromise.then(ready => { if (ready && stillOwnsTrack(trackRevision)) report(engine.endScratch(id)); });
  }
  useLayoutEffect(() => {
    disabledRef.current = disabled;
    durationRef.current = durationSeconds;
    onErrorRef.current = onError;
    stopRef.current = finish;
  });
  useEffect(() => () => {
    const current = gesture.current;
    if (current) stopRef.current(current.pointerId);
  }, []);
  useEffect(() => {
    const current = gesture.current;
    if (current && (disabled || current.revision !== revision)) { stopRef.current(current.pointerId); return; }
    if (current && current.position > durationSeconds) {
      current.position = durationSeconds;
      current.velocity = 0;
      if (current.ready) engine.updateScratch(id, durationSeconds, 0);
    }
  }, [disabled, durationSeconds, id, revision]);

  useEffect(() => {
    const animate = (now: number) => {
      const position = disabledRef.current ? 0 : engine.readPosition(id).positionSeconds;
      const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
      const rotation = safePosition / 1.8 * 360;
      // Position feedback follows user-controlled playback/scratch, including reduced-motion mode.
      if (disc.current) disc.current.style.transform = 'rotate(' + rotation + 'deg)';
      const element = node.current;
      if (element && durationRef.current > 0) {
        element.setAttribute('aria-valuenow', String(Math.max(0, Math.min(durationRef.current, safePosition))));
        element.setAttribute('aria-valuetext', formatMediaTime(safePosition));
      }
      const current = gesture.current;
      if (current && current.ready && current.velocity !== 0 && now - current.lastActivity > 48) {
        current.velocity = 0;
        engine.updateScratch(id, current.position, 0);
      }
    };
    const unregister = registerVisualTask(animate);
    return unregister;
  }, [id]);

  function begin(event: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled || event.button !== 0 || gesture.current || durationSeconds <= 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const bounds = event.currentTarget.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const position = clamp(engine.readPosition(id).positionSeconds, 0, durationSeconds);
    const pointerId = event.pointerId;
    const current: ScratchGesture = {
      pointerId, centerX, centerY, anchor: createScratchAnchor(event.clientX-centerX,event.clientY-centerY,bounds.width/2), radius: bounds.width/2,
      linear: Math.hypot(event.clientX-centerX,event.clientY-centerY)<bounds.width*.1,dragAxis:null,lastX:event.clientX,lastY:event.clientY,
      lastAt: event.timeStamp, lastActivity: event.timeStamp, position, velocity: 0,
      ready: false, ended: false, beginPromise: Promise.resolve(false), revision, unregister: null,
    };
    gesture.current = current;
    event.currentTarget.classList.add('is-scratching');
    try { event.currentTarget.setPointerCapture(pointerId); } catch { /* App-level blur cleanup still ends the gesture. */ }
    current.unregister = registerGesture(() => finish(pointerId));
    current.beginPromise = engine.beginScratch(id).then(() => true, cause => { onErrorRef.current(cause); return false; });
    void current.beginPromise.then(ready => {
      if (!ready) { if (gesture.current === current) finish(pointerId); return; }
      if (gesture.current === current && !current.ended) {
        current.ready = true;
        engine.updateScratch(id, current.position, current.velocity);
      }
    });
  }
  function processSample(sample: PointerEvent, current: ScratchGesture): void {
    let radians: number;
    if (current.linear) {
      const dx=sample.clientX-current.lastX,dy=sample.clientY-current.lastY;
      if (!current.dragAxis && Math.hypot(dx,dy)>2) current.dragAxis=Math.abs(dx)>=Math.abs(dy)?'x':'y';
      radians=current.dragAxis?(current.dragAxis==='x'?dx:-dy)/current.radius:0;
      if(current.dragAxis){current.lastX=sample.clientX;current.lastY=sample.clientY;}
    } else radians=sampleScratchMotion(current.anchor,sample.clientX-current.centerX,sample.clientY-current.centerY,current.radius);
    const seconds = radians / TAU * 1.8;
    const elapsed = Math.max(1, sample.timeStamp - current.lastAt) / 1000;
    const nextPosition = clamp(current.position + seconds, 0, durationRef.current);
    const appliedDelta = nextPosition - current.position;
    current.position = nextPosition;
    current.lastAt = sample.timeStamp;
    current.lastActivity = sample.timeStamp;
    current.velocity = smoothScratchVelocity(current.velocity,appliedDelta,elapsed);
    if (current.ready) engine.updateScratch(id, current.position, current.velocity);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (disabled) { finish(event.pointerId); return; }
    event.preventDefault();
    const samples = typeof event.nativeEvent.getCoalescedEvents === 'function' ? event.nativeEvent.getCoalescedEvents() : [];
    for (const sample of samples.length ? samples : [event.nativeEvent]) processSample(sample, current);
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (disabled) return;
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -0.1
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 0.1
        : event.key === 'PageDown' ? -2
          : event.key === 'PageUp' ? 2
            : event.key === 'Home' ? -durationSeconds
              : event.key === 'End' ? durationSeconds : null;
    if (delta === null) return;
    event.preventDefault();
    const position = engine.readPosition(id).positionSeconds;
    report(engine.seekDeck(id, clamp(position + delta, 0, durationSeconds)));
  }

  const currentPosition = disabled ? 0 : engine.readPosition(id).positionSeconds;
  const safePosition = Number.isFinite(currentPosition) ? clamp(currentPosition, 0, Math.max(0, durationSeconds)) : 0;
  return <div className="jog-unit">
    <span id={'jog-help-' + id} className="jog-unit__label">{t("Turn the rim or drag the centre horizontally or vertically to scratch. Use arrow keys to seek.")}</span>
    <div ref={node} className={'jog-wheel' + (disabled ? ' is-disabled' : '')} role="slider" tabIndex={disabled ? -1 : 0}
      aria-label={t('Jog ' + id)} aria-describedby={'jog-help-' + id} aria-valuemin={0} aria-valuemax={Math.max(0.01, durationSeconds)} aria-valuenow={safePosition} aria-valuetext={formatMediaTime(safePosition)}
      aria-orientation="vertical" aria-disabled={disabled} onPointerDown={begin} onPointerMove={move}
      onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)} onLostPointerCapture={event => finish(event.pointerId)}
      onKeyDown={onKeyDown}>
      <div ref={disc} className={'jog-wheel__disc jog-wheel__disc-' + id} aria-hidden="true">
        <span className="jog-wheel__center" />
        {artworkUrl && <img className="jog-wheel__label-art" src={artworkUrl} alt="" onError={event=>{event.currentTarget.style.display='none';}} />}
        <span className="jog-wheel__marker" />
      </div>
    </div>
  </div>;
}
