import { useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { registerGesture } from './gesture-registry';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function snap(value: number, min: number, max: number, step: number): number {
  const safeStep = Math.max(0.00001, step);
  const decimals = Math.min(5, (String(safeStep).split('.')[1] || '').length);
  return Number(clamp(min + Math.round((value - min) / safeStep) * safeStep, min, max).toFixed(decimals));
}
function percent(value: number, min: number, max: number): number {
  return max === min ? 0 : clamp((value - min) / (max - min), 0, 1);
}
function keyValue(event: ReactKeyboardEvent<HTMLElement>, value: number, min: number, max: number, step: number): number | null {
  const unit = step * (event.shiftKey ? 0.1 : 1);
  switch (event.key) {
    case 'ArrowDown': case 'ArrowLeft': return snap(value - unit, min, max, unit);
    case 'ArrowUp': case 'ArrowRight': return snap(value + unit, min, max, unit);
    case 'PageDown': return snap(value - step * 10, min, max, step);
    case 'PageUp': return snap(value + step * 10, min, max, step);
    case 'Home': return min;
    case 'End': return max;
    default: return null;
  }
}

export interface KnobProps {
  readonly label: string;
  readonly displayLabel?: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit?: string;
  readonly defaultValue?: number;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly valueText?: (value: number) => string;
  readonly onChange: (value: number) => void;
}

type PointerGesture = { pointerId: number; lastY: number; value: number; unregister: (() => void) | null };

export function Knob({ label, displayLabel, value, min, max, step = 0.1, unit = '', defaultValue, disabled = false, className = '', valueText, onChange }: KnobProps) {
  const node = useRef<HTMLDivElement>(null);
  const gesture = useRef<PointerGesture | null>(null);
  const stopRef = useRef<(pointerId: number) => void>(() => undefined);
  const angle = -135 + percent(value, min, max) * 270;
  const formatted = valueText ? valueText(value) : value.toFixed(step >= 1 ? 0 : step < 0.1 ? 2 : 1) + unit;

  function finish(pointerId: number): void {
    const activeGesture = gesture.current;
    if (!activeGesture || activeGesture.pointerId !== pointerId) return;
    gesture.current = null;
    activeGesture.unregister?.();
    const element = node.current;
    element?.classList.remove('is-dragging');
    if (element?.hasPointerCapture(pointerId)) {
      try { element.releasePointerCapture(pointerId); } catch { /* Capture may already have been released. */ }
    }
  }
  useLayoutEffect(() => { stopRef.current = finish; });
  useLayoutEffect(() => { if (disabled && gesture.current) stopRef.current(gesture.current.pointerId); }, [disabled]);
  useEffect(() => () => {
    const activeGesture = gesture.current;
    if (activeGesture) stopRef.current(activeGesture.pointerId);
  }, []);

  function begin(event: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const pointerId = event.pointerId;
    gesture.current = { pointerId, lastY: event.clientY, value, unregister: null };
    event.currentTarget.classList.add('is-dragging');
    try { event.currentTarget.setPointerCapture(pointerId); } catch { /* Window blur cleanup still ends the gesture. */ }
    gesture.current.unregister = registerGesture(() => finish(pointerId));
  }
  function move(event: ReactPointerEvent<HTMLDivElement>): void {
    const activeGesture = gesture.current;
    if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
    if (disabled) { finish(event.pointerId); return; }
    event.preventDefault();
    const delta = activeGesture.lastY - event.clientY;
    activeGesture.lastY = event.clientY;
    const sensitivity = (max - min) / 176;
    activeGesture.value = clamp(activeGesture.value + delta * sensitivity * (event.shiftKey ? 0.1 : 1), min, max);
    onChange(snap(activeGesture.value, min, max, step * (event.shiftKey ? 0.1 : 1)));
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const next = keyValue(event, value, min, max, step);
    if (next === null || disabled) return;
    event.preventDefault();
    onChange(next);
  }
  const style = { '--dial-angle': angle + 'deg' } as CSSProperties;

  return <div className={'control control-knob ' + className}>
    <span className="control__label">{displayLabel ?? label}<output>{formatted}</output></span>
    <div ref={node} className={'knob' + (disabled ? ' is-disabled' : '')} style={style} role="slider" tabIndex={disabled ? -1 : 0}
      aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={formatted} aria-orientation="vertical" aria-disabled={disabled}
      onPointerDown={begin} onPointerMove={move} onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)}
      onLostPointerCapture={event => finish(event.pointerId)} onKeyDown={onKeyDown}
      onDoubleClick={defaultValue === undefined || disabled ? undefined : () => onChange(defaultValue)}>
      <span className="knob__rim" aria-hidden="true"><span className="knob__cap"><span className="knob__indicator" /></span></span>
    </div>
  </div>;
}

export interface LinearControlProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit?: string;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly defaultValue?: number;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly lowLabel?: string;
  readonly highLabel?: string;
  readonly valueText?: (value: number) => string;
  readonly onChange: (value: number) => void;
}

type LinearGesture = { pointerId: number; rect: DOMRect; relative: boolean; lastCoordinate: number; value: number; unregister: (() => void) | null };

export function LinearControl({ label, value, min, max, step = 0.01, unit = '', orientation = 'horizontal', defaultValue, disabled = false, className = '', lowLabel, highLabel, valueText, onChange }: LinearControlProps) {
  const node = useRef<HTMLDivElement>(null);
  const gesture = useRef<LinearGesture | null>(null);
  const stopRef = useRef<(pointerId: number) => void>(() => undefined);
  const ratio = percent(value, min, max);
  const formatted = valueText ? valueText(value) : value.toFixed(step >= 1 ? 0 : step < 0.1 ? 2 : 1) + unit;

  function coordinate(clientX: number, clientY: number): number {
    return orientation === 'horizontal' ? clientX : clientY;
  }
  function valueAt(clientX: number, clientY: number, rect: DOMRect): number {
    const position = orientation === 'horizontal'
      ? (clientX - rect.left) / Math.max(1, rect.width)
      : 1 - (clientY - rect.top) / Math.max(1, rect.height);
    return clamp(min + clamp(position, 0, 1) * (max - min), min, max);
  }
  function finish(pointerId: number): void {
    const activeGesture = gesture.current;
    if (!activeGesture || activeGesture.pointerId !== pointerId) return;
    gesture.current = null;
    activeGesture.unregister?.();
    const element = node.current;
    element?.classList.remove('is-dragging');
    if (element?.hasPointerCapture(pointerId)) {
      try { element.releasePointerCapture(pointerId); } catch { /* Capture may already have been released. */ }
    }
  }
  useLayoutEffect(() => { stopRef.current = finish; });
  useLayoutEffect(() => { if (disabled && gesture.current) stopRef.current(gesture.current.pointerId); }, [disabled]);
  useEffect(() => () => {
    const activeGesture = gesture.current;
    if (activeGesture) stopRef.current(activeGesture.pointerId);
  }, []);

  function begin(event: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const rect = event.currentTarget.querySelector('.linear-slider__track')?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    const thumb = event.currentTarget.querySelector('.linear-slider__thumb')?.getBoundingClientRect();
    const grabbedThumb = !!thumb && event.clientX >= thumb.left - 4 && event.clientX <= thumb.right + 4
      && event.clientY >= thumb.top - 4 && event.clientY <= thumb.bottom + 4;
    const relative = event.shiftKey || grabbedThumb;
    const pointerId = event.pointerId;
    const gestureValue = relative ? value : snap(valueAt(event.clientX, event.clientY, rect), min, max, step);
    gesture.current = { pointerId, rect, relative, lastCoordinate: coordinate(event.clientX, event.clientY), value: gestureValue, unregister: null };
    event.currentTarget.classList.add('is-dragging');
    try { event.currentTarget.setPointerCapture(pointerId); } catch { /* Window blur cleanup still ends the gesture. */ }
    gesture.current.unregister = registerGesture(() => finish(pointerId));
    if (!relative) onChange(gestureValue);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>): void {
    const activeGesture = gesture.current;
    if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
    if (disabled) { finish(event.pointerId); return; }
    event.preventDefault();
    const nextCoordinate = coordinate(event.clientX, event.clientY);
    if (event.shiftKey) activeGesture.relative = true;
    if (event.shiftKey || activeGesture.relative) {
      const direction = orientation === 'horizontal' ? 1 : -1;
      const extent = orientation === 'horizontal' ? activeGesture.rect.width : activeGesture.rect.height;
      const fine = event.shiftKey ? 0.1 : 1;
      activeGesture.value = clamp(activeGesture.value + direction * (nextCoordinate - activeGesture.lastCoordinate) / Math.max(1, extent) * (max - min) * fine, min, max);
      onChange(snap(activeGesture.value, min, max, step * fine));
    } else {
      activeGesture.value = valueAt(event.clientX, event.clientY, activeGesture.rect);
      onChange(snap(activeGesture.value, min, max, step));
    }
    activeGesture.lastCoordinate = nextCoordinate;
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const next = keyValue(event, value, min, max, step);
    if (next === null || disabled) return;
    event.preventDefault();
    onChange(next);
  }
  const style = { '--slider-progress': (ratio * 100) + '%', '--slider-ratio': ratio } as CSSProperties;
  const orientationClass = orientation === 'vertical' ? ' is-vertical' : ' is-horizontal';

  return <div className={'control control-linear ' + className}>
    <span className="control__label">{label}<output>{formatted}</output></span>
    <div ref={node} className={'linear-slider' + orientationClass + (disabled ? ' is-disabled' : '')} style={style} role="slider" tabIndex={disabled ? -1 : 0}
      aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={formatted} aria-orientation={orientation} aria-disabled={disabled}
      onPointerDown={begin} onPointerMove={move} onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)}
      onLostPointerCapture={event => finish(event.pointerId)} onKeyDown={onKeyDown}
      onDoubleClick={defaultValue === undefined || disabled ? undefined : () => onChange(defaultValue)}>
      <span className="linear-slider__track" aria-hidden="true" />
      <span className="linear-slider__thumb" aria-hidden="true" />
    </div>
    {(lowLabel || highLabel) && <span className="linear-slider__ends"><span>{lowLabel}</span><span>{highLabel}</span></span>}
  </div>;
}

export interface ToggleButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  readonly pressed?: boolean;
  readonly tone?: 'neutral' | 'a' | 'b' | 'cue' | 'danger';
  readonly ref?: Ref<HTMLButtonElement>;
}

export function ToggleButton({ pressed = false, tone = 'neutral', className = '', type = 'button', ref, ...props }: ToggleButtonProps) {
  return <button ref={ref} type={type} className={'action-button tone-' + tone + (pressed ? ' is-pressed' : '') + (className ? ' ' + className : '')}
    aria-pressed={pressed} {...props} />;
}
