import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { DeckId, LoopRegion, WaveformData, WaveformLevel } from '../../audio/types';
import { engine, getSnapshot } from '../../state/engine';
import { formatMediaTime } from '../../ui/time';
import { registerGesture } from '../../ui/gesture-registry';
import { registerVisualTask } from '../../ui/visual-loop';

const cueColors = ['#E6C77A', '#79BDB4', '#D28A71', '#B69ACB', '#E7A7A0', '#A4C886', '#7EA4D0', '#D4A66F'];
function chooseLevel(levels: readonly WaveformLevel[], width: number): WaveformLevel | null {
  if (!levels.length) return null;
  let best = levels[0];
  let error = Math.abs(best.left.length - width);
  for (let i = 1; i < levels.length; i++) {
    const currentError = Math.abs(levels[i].left.length - width);
    if (currentError < error) { best = levels[i]; error = currentError; }
  }
  return best;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface WaveformProps {
  readonly id: DeckId;
  readonly revision: number;
  readonly waveform: WaveformData | null;
  readonly durationSeconds: number;
  readonly accent: string;
  readonly disabled?: boolean;
  readonly grid: { readonly bpm: number; readonly firstBeatSeconds: number } | null;
  readonly loop: LoopRegion | null;
  readonly hotCues: readonly ({ readonly positionSeconds: number } | null)[];
  readonly onSeek: (seconds: number) => void | Promise<unknown>;
  readonly onError: (cause: unknown) => void;
  readonly zoomLevel?: 1 | 2 | 4;
  readonly onZoomChange?: (zoom: 1 | 2 | 4) => void;
  readonly showZoom?: boolean;
  readonly effectiveBpm?: number | null;
}

type VisualModel = { grid: WaveformProps['grid']; loop: LoopRegion | null; hotCues: WaveformProps['hotCues'] };

export function Waveform({ id, revision, waveform, durationSeconds, accent, disabled = false, grid, loop, hotCues, onSeek, onError,
  zoomLevel: controlledZoomLevel, onZoomChange, showZoom = true, effectiveBpm }: WaveformProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const seek = useRef<HTMLInputElement>(null);
  const clock = useRef<HTMLOutputElement>(null);
  const seeking = useRef(false);
  const seekWindow = useRef<{ start: number; end: number } | null>(null);
  const seekPointer = useRef<number | null>(null);
  const seekRevision = useRef<number | null>(null);
  const unregisterSeek = useRef<(() => void) | null>(null);
  const [internalZoomLevel, setInternalZoomLevel] = useState<1 | 2 | 4>(1);
  const zoomLevel = controlledZoomLevel ?? internalZoomLevel;
  const zoomRef = useRef(zoomLevel);
  const disabledRef = useRef(disabled);
  const revisionRef = useRef(revision);
  const modelRef = useRef<VisualModel>({ grid, loop, hotCues });
  const sizeRef = useRef({ width: 0, height: 0, ratio: 1 });
  const peaks = useRef<HTMLCanvasElement | null>(null);
  const peakRevision = useRef(0);
  useLayoutEffect(() => {
    zoomRef.current = zoomLevel;
    disabledRef.current = disabled;
    revisionRef.current = revision;
    modelRef.current = { grid, loop, hotCues };
  }, [zoomLevel, disabled, revision, grid, loop, hotCues]);

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const resize = () => {
      const rect = surface.getBoundingClientRect();
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      // Reassigning unchanged canvas dimensions clears a paused waveform.
      if (surface.width !== pixelWidth || surface.height !== pixelHeight) {
        surface.width = pixelWidth;
        surface.height = pixelHeight;
      }
      sizeRef.current = { width, height, ratio };
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [id]);

  useEffect(() => {
    if (!waveform) { peaks.current = null; peakRevision.current++; return; }
    const pixelWidth = canvas.current?.getBoundingClientRect().width ?? 512;
    const targetPeaks = Math.min(16384, Math.max(512, Math.ceil(pixelWidth * zoomLevel)));
    const level = chooseLevel(waveform.levels, targetPeaks);
    if (!level || !level.left.length) { peaks.current = null; peakRevision.current++; return; }
    const surface = document.createElement('canvas');
    const width = level.left.length;
    const height = 100;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    surface.width = Math.round(width * ratio);
    surface.height = Math.round(height * ratio);
    const context = surface.getContext('2d');
    if (!context) { peaks.current = null; peakRevision.current++; return; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.strokeStyle = accent;
    context.lineWidth = 1;
    context.beginPath();
    const lane = height / 2;
    const leftCenter = height / 2;
    for (let x = 0; x < width; x++) {
      const index = Math.min(level.left.length - 1, Math.floor(x * level.left.length / width));
      const peak = level.left[index];
      const right = level.right?.[index];
      context.moveTo(x + 0.5, leftCenter - lane * Math.max(0, peak.max, right?.max ?? 0) * 0.88);
      context.lineTo(x + 0.5, leftCenter - lane * Math.min(0, peak.min, right?.min ?? 0) * 0.88);
    }
    context.stroke();
    peaks.current = surface;
    peakRevision.current++;
  }, [waveform, accent, zoomLevel]);

  useEffect(() => {
    let lastPaintKey = '';
    let lastClockText = '';
    const drawPosition = () => {
      const position = disabledRef.current ? 0 : engine.readPosition(id).positionSeconds;
      const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
      const scale = zoomRef.current;
      const span = Math.min(durationSeconds || 0.01, durationSeconds / scale || 0.01);
      const centeredStart = clamp(safePosition - span / 2, 0, Math.max(0, durationSeconds - span));
      const start = seeking.current && seekWindow.current ? seekWindow.current.start : centeredStart;
      const end = seeking.current && seekWindow.current ? seekWindow.current.end : centeredStart + span;
      const visibleSpan = Math.max(0.001, end - start);
      const view = seek.current;
      if (view) {
        const minText = String(start);
        const maxText = String(Math.max(start + 0.001, end));
        const stepText = String(Math.max(0.001, visibleSpan / 10000));
        if (view.min !== minText) view.min = minText;
        if (view.max !== maxText) view.max = maxText;
        if (view.step !== stepText) view.step = stepText;
        const nextValue = clamp(safePosition, start, end);
        if (!seeking.current && Math.abs(Number(view.value) - nextValue) > 0.0005) view.value = String(nextValue);
        const rangeText = formatMediaTime(safePosition) + ' of ' + formatMediaTime(durationSeconds) + ', ' + scale + ' times zoom';
        if (view.getAttribute('aria-valuetext') !== rangeText) view.setAttribute('aria-valuetext', rangeText);
      }
      const clockText = '-' + formatMediaTime(Math.max(0, durationSeconds - safePosition)).replace(/\.\d+$/, '');
      if (clock.current && clockText !== lastClockText) { clock.current.textContent = clockText; lastClockText = clockText; }
      const currentModel = modelRef.current;
      const size = sizeRef.current;
      const loopKey = currentModel.loop ? currentModel.loop.startSeconds + ',' + currentModel.loop.endSeconds : '';
      const gridKey = currentModel.grid ? currentModel.grid.bpm + ',' + currentModel.grid.firstBeatSeconds : '';
      const cueKey = currentModel.hotCues.map(cue => cue ? cue.positionSeconds : '').join(',');
      const dark = document.body.dataset.theme === 'dark';
      const paintKey = [dark, size.width, size.height, size.ratio, durationSeconds, peakRevision.current, zoomRef.current, start.toFixed(4), visibleSpan.toFixed(4), safePosition.toFixed(4), loopKey, gridKey, cueKey].join('|');
      if (paintKey === lastPaintKey) return;
      lastPaintKey = paintKey;
      const surface = canvas.current;
      const context = surface?.getContext('2d');
      if (surface && context && size.width > 0 && size.height > 0) {
        context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
        context.clearRect(0, 0, size.width, size.height);
        context.fillStyle = dark ? '#323431' : '#F4F2EF';
        context.fillRect(0, 0, size.width, size.height);
        context.strokeStyle = dark ? 'rgba(193,207,177,0.12)' : 'rgba(80,73,64,0.08)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, size.height / 2 + 0.5);
        context.lineTo(size.width, size.height / 2 + 0.5);
        context.stroke();
        const buffer = peaks.current;
        if (buffer && durationSeconds > 0) {
          const sourceX = start / durationSeconds * buffer.width;
          const sourceWidth = Math.max(1, visibleSpan / durationSeconds * buffer.width);
          context.drawImage(buffer, sourceX, 0, sourceWidth, buffer.height, 0, 0, size.width, size.height);
        }
        const currentModel = modelRef.current;
        const xFor = (seconds: number) => (seconds - start) / visibleSpan * size.width;
        if (currentModel.loop && currentModel.loop.endSeconds > start && currentModel.loop.startSeconds < end) {
          const left = clamp(xFor(currentModel.loop.startSeconds), 0, size.width);
          const right = clamp(xFor(currentModel.loop.endSeconds), 0, size.width);
          context.fillStyle = 'rgba(230,199,122,0.10)';
          context.fillRect(left, 0, Math.max(0, right - left), size.height);
          context.strokeStyle = '#E6C77A';
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(left + 0.5, 0); context.lineTo(left + 0.5, size.height);
          context.moveTo(right + 0.5, 0); context.lineTo(right + 0.5, size.height);
          context.stroke();
        }
        if (currentModel.grid && Number.isFinite(currentModel.grid.bpm) && currentModel.grid.bpm > 0) {
          const beatSeconds = 60 / currentModel.grid.bpm;
          const pixelsPerBeat = beatSeconds / visibleSpan * size.width;
          const stride = Math.max(1, Math.ceil(18 / Math.max(0.01, pixelsPerBeat)));
          const firstBeatIndex = Math.ceil((start - currentModel.grid.firstBeatSeconds) / beatSeconds);
          const lastBeatIndex = Math.floor((end - currentModel.grid.firstBeatSeconds) / beatSeconds);
          context.lineWidth = 1;
          for (let beat = firstBeatIndex; beat <= lastBeatIndex; beat += stride) {
            const x = xFor(currentModel.grid.firstBeatSeconds + beat * beatSeconds);
            context.strokeStyle = Math.abs(beat % 4) === 0 ? 'rgba(230,199,122,0.62)' : 'rgba(239,231,217,0.16)';
            context.beginPath(); context.moveTo(x + 0.5, 0); context.lineTo(x + 0.5, size.height); context.stroke();
          }
        }
        currentModel.hotCues.forEach((cue, index) => {
          if (!cue || cue.positionSeconds < start || cue.positionSeconds > end) return;
          const x = xFor(cue.positionSeconds);
          context.fillStyle = cueColors[index % cueColors.length];
          context.fillRect(x - 1, 0, 2, Math.min(10, size.height));
          context.beginPath(); context.moveTo(x, 8); context.lineTo(x - 4, 14); context.lineTo(x + 4, 14); context.closePath(); context.fill();
          context.font = '600 10px Segoe UI, sans-serif';
          context.fillText(String(index + 1), x + 5, 12);
        });
        const playX = clamp(xFor(safePosition), 0, size.width);
        context.fillStyle = '#F8F0E1';
        context.fillRect(playX - 1, 0, 2, size.height);
      }
    };
    return registerVisualTask(drawPosition);
  }, [id, durationSeconds]);

  function commitSeek(event: ChangeEvent<HTMLInputElement>): void {
    const trackRevision = seekRevision.current;
    const current = getSnapshot().decks[id];
    if (trackRevision === null || trackRevision !== revisionRef.current || current.track?.revision !== trackRevision || current.revision !== trackRevision) return;
    const next = Number(event.currentTarget.value);
    try {
      const result = onSeek(next);
      void Promise.resolve(result).catch(onError);
    } catch (cause) { onError(cause); }
  }
  function beginPointerSeek(event: ReactPointerEvent<HTMLInputElement>): void {
    if (disabledRef.current || seekPointer.current !== null) return;
    unregisterSeek.current?.();
    seeking.current = true;
    seekWindow.current = { start: Number(event.currentTarget.min), end: Number(event.currentTarget.max) };
    seekPointer.current = event.pointerId;
    seekRevision.current = revisionRef.current;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Blur cleanup still releases the seek window. */ }
    unregisterSeek.current = registerGesture(() => finishSeeking(event.pointerId));
  }
  function beginKeyboardSeek(): void {
    if (seeking.current) return;
    seeking.current = true;
    seekWindow.current = { start: Number(seek.current?.min ?? 0), end: Number(seek.current?.max ?? durationSeconds) };
    seekRevision.current = revisionRef.current;
    unregisterSeek.current = registerGesture(() => finishSeeking());
  }
  function finishSeeking(pointerId?: number): void {
    if (pointerId !== undefined && seekPointer.current !== null && seekPointer.current !== pointerId) return;
    const active = seekPointer.current;
    seeking.current = false;
    seekWindow.current = null;
    seekPointer.current = null;
    seekRevision.current = null;
    unregisterSeek.current?.();
    unregisterSeek.current = null;
    const input = seek.current;
    if (active !== null && input?.hasPointerCapture(active)) {
      try { input.releasePointerCapture(active); } catch { /* Capture may already be gone. */ }
    }
  }
  useEffect(() => {
    seeking.current = false;
    seekWindow.current = null;
    const active = seekPointer.current;
    seekPointer.current = null;
    seekRevision.current = null;
    unregisterSeek.current?.();
    unregisterSeek.current = null;
    if (active !== null && seek.current?.hasPointerCapture(active)) {
      try { seek.current.releasePointerCapture(active); } catch { /* Capture may already be gone. */ }
    }
  }, [revision]);
  function setZoomValue(value: 1 | 2 | 4): void {
    if (onZoomChange) onZoomChange(value);
    else setInternalZoomLevel(value);
  }

  return <div className={'waveform waveform-' + id}>
    <span className="waveform__identity" aria-hidden="true">{id}</span>
    <div className="waveform__surface">
      <canvas ref={canvas} aria-hidden="true" />
      <input ref={seek} className="waveform__seek" type="range" min="0" max={Math.max(0.01, durationSeconds)} step="0.001" defaultValue="0" disabled={disabled}
        aria-label={'Seek ' + id} onChange={commitSeek} onPointerDown={beginPointerSeek}
        onPointerUp={event => finishSeeking(event.pointerId)} onPointerCancel={event => finishSeeking(event.pointerId)} onLostPointerCapture={event => finishSeeking(event.pointerId)}
        onKeyDown={event => { if (event.key.startsWith('Arrow') || event.key.startsWith('Page') || event.key === 'Home' || event.key === 'End') beginKeyboardSeek(); }}
        onKeyUp={() => finishSeeking()} onBlur={() => { if (seekPointer.current === null) finishSeeking(); }} />
    </div>
    <div className="waveform__readout"><span className="visually-hidden">Position {id}</span><span className="waveform__time"><output ref={clock} aria-live="off">-{formatMediaTime(durationSeconds).replace(/\.\d+$/, '')}</output><small>{formatMediaTime(durationSeconds).replace(/\.\d+$/, '')}</small></span>
      <span className="waveform__bpm">{effectiveBpm ? effectiveBpm.toFixed(1) : '—'}<small>BPM</small></span>
      {showZoom && <div className="waveform__zoom" role="group" aria-label={'Waveform zoom ' + id}>
        {([1, 2, 4] as const).map(value => <button key={value} type="button" aria-label={value + '× · Waveform zoom ' + value + 'x ' + id} aria-pressed={zoomLevel === value} disabled={!waveform}
          onClick={() => setZoomValue(value)}>{value}×</button>)}
      </div>}
    </div>
  </div>;
}
