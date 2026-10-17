import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { engine } from '../../state/engine';
import { cancelAllGestures } from '../../ui/gesture-registry';
import { downloadRecording, recordingFilename, releaseRecordingDownloads } from './export';
import './recording.css';
import { BrandMark } from '../../ui/BrandMark';
import { prepareRecordingMp3 } from '../../recording/mp3-client';
import type { RecordingFormat } from '../../recording/types';
const subscribeRecording = (listener: () => void) => engine.subscribeRecording(listener);
const getRecording = () => engine.getRecordingSnapshot();
function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}
function defaultName(): string {
  const date = new Date();
  return `RIMVO mix ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}`;
}
export function RecordingControls({ hasTracks }: { readonly hasTracks: boolean }) {
  const recording = useSyncExternalStore(subscribeRecording, getRecording);
  const [open, setOpen] = useState(false), [name, setName] = useState(defaultName), [version, setVersion] = useState(1);
  const [namedSave, setNamedSave] = useState(false), [requestedSave, setRequestedSave] = useState(false);
  const [replacePending, setReplacePending] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [format, setFormat] = useState<RecordingFormat>('wav');
  const [prepared, setPrepared] = useState<{ format: RecordingFormat; blob: Blob } | null>(null);
  const [exportError, setExportError] = useState('');
  const exportCache = useRef(new Map<RecordingFormat, Blob>());
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null), audio = useRef<HTMLAudioElement>(null), previewLease = useRef<string | null>(null);
  const busy = recording.status === 'preparing' || recording.status === 'stopping', active = recording.status === 'recording', ready = recording.status === 'ready' || (recording.status === 'error' && recording.bytes > 0);
  const exportBlob = ready && prepared?.format === format ? prepared.blob : null;
  useEffect(() => {
    const controller = new AbortController();
    if (!ready) exportCache.current.clear();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setPrepared(null); setExportError('');
      if (!ready) return;
      const cached = exportCache.current.get(format);
      if (cached) { setPrepared({ format, blob: cached }); return; }
      const wav = engine.exportRecording();
      exportCache.current.set('wav', wav);
      if (format === 'wav') setPrepared({ format, blob: wav });
      else {
        const blob = await prepareRecordingMp3(wav, controller.signal);
        if (controller.signal.aborted) return;
        exportCache.current.set('mp3', blob); setPrepared({ format, blob });
      }
    }).catch(cause => {
      if (!controller.signal.aborted) setExportError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [ready, format]);
  useEffect(() => {
    const panel = dialog.current, returnTarget = opener.current;
    if (!panel || !open) return;
    cancelAllGestures(); panel.showModal(); closeButton.current?.focus();
    return () => { panel.close(); returnTarget?.focus({ preventScroll: true }); };
  }, [open]);
  useEffect(() => () => { if (previewLease.current) URL.revokeObjectURL(previewLease.current); releaseRecordingDownloads(); }, []);
  // The in-memory take disappears on refresh. Remove the guard after the same
  // save request or discard that clears the replacement confirmation.
  const protectRecording = active || (ready && !requestedSave)
    || (recording.status === 'stopping' && recording.bytes > 0);
  useEffect(() => {
    if (!protectRecording) return;
    const protectTake = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectTake);
    return () => window.removeEventListener('beforeunload', protectTake);
  }, [protectRecording]);
  function dropPreview(): void {
    audio.current?.pause(); if (previewLease.current) URL.revokeObjectURL(previewLease.current);
    previewLease.current = null; setPreviewUrl(null);
  }
  function close(): void { dropPreview(); setOpen(false); }
  async function pauseForPreview(): Promise<void> {
    const decks=engine.getSnapshot().decks;
    const playing=(['A','B'] as const).filter(id=>decks[id].track&&decks[id].status==='playing');
    try { if(playing.length===2)await engine.pauseDecks();else for(const id of playing)await engine.pauseDeck(id); }
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  }
  async function start(): Promise<void> {
    dropPreview(); setPrepared(null); setError(''); setNotice(''); setReplacePending(false);
    try { await engine.startRecording(); setRequestedSave(false); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setOpen(true); }
  }
  async function stop(): Promise<void> {
    setError('');
    try { await engine.stopRecording(); setOpen(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setOpen(true); }
  }
  function resetTake(showRecorder: boolean): void {
    try {
      dropPreview(); engine.clearRecording(); setPrepared(null); setNamedSave(false); setRequestedSave(false);
      setReplacePending(false); setNotice(''); setError(''); setOpen(showRecorder);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function prepareNew(): void {
    if (ready && !requestedSave) { setReplacePending(true); setOpen(true); } else resetTake(true);
  }
  function requestStart(): void { void start(); }

  function listen(): void {
    try { dropPreview(); const url = URL.createObjectURL(engine.exportRecording()); previewLease.current = url; setPreviewUrl(url); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function save(): void {
    if (!exportBlob) return;
    try {
      const filename = recordingFilename(name, version, format); downloadRecording(exportBlob, filename);
      setVersion(current => current + 1); setRequestedSave(true); setNamedSave(false); setReplacePending(false);
      setNotice(`Download requested: ${filename}`); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function saveToFiles(): Promise<void> {
    if (!exportBlob) return;
    try {
      const filename = recordingFilename(name, version, format), file = new File([exportBlob], filename, { type: exportBlob.type });
      if (!navigator.canShare?.({ files: [file] })) { save(); return; }
      await navigator.share({ files: [file], title: name });
      setVersion(current => current + 1); setRequestedSave(true); setNotice('Device save or share completed.'); setError('');
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  function trapFocus(event: KeyboardEvent<HTMLDialogElement>): void {
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,audio')].filter(item => item.getClientRects().length > 0);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  const hasShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  return <>
    <div className="recording-header"><button ref={opener} type="button" className={'recording-toggle' + (active ? ' is-recording' : '')}
      aria-label={active ? 'Stop mix recording' : ready ? 'Open recorded mix' : 'Start mix recording'} aria-pressed={active}
      disabled={busy || (!hasTracks && !ready)} title={active ? 'Stop and save mix' : 'Record your mix'}
      onClick={() => { if (active) void stop(); else if (ready) setOpen(true); else requestStart(); }}>
      <span className="recording-dot" aria-hidden="true" /><span>{active ? clock(recording.durationSeconds) : busy ? '…' : ready ? 'Take' : 'Record'}</span></button></div>
    <dialog ref={dialog} className="recording-dialog" aria-labelledby="recording-title" onKeyDown={trapFocus}
      onCancel={event => { event.preventDefault(); close(); }} onClose={close}
      onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
      <header><div><span className="recording-eyebrow"><BrandMark />RIMVO · local recording</span><h2 id="recording-title">{ready ? 'Your mix' : 'Mix recorder'}</h2></div>
        <button ref={closeButton} type="button" className="recording-close" aria-label="Close mix recorder" onClick={close}>×</button></header>
      <div className={'recording-take' + (active ? ' is-recording' : '')}><span className="recording-dot" aria-hidden="true" /><strong>{clock(recording.durationSeconds)}</strong>
        <span>{ready ? 'Stereo recording' : active ? 'Recording master output' : busy ? 'Preparing…' : 'Ready to record'}</span></div>
      {recording.stopReason === 'limit' && <p className="recording-notice">Recording reached its {clock(recording.maxDurationSeconds)} limit. This take is ready to download.</p>}
      {recording.stopReason === 'interrupted' && <p className="recording-notice">Audio was interrupted. This take contains the sound captured before the interruption.</p>}
      {(error || exportError || recording.error) && <p className="recording-error" role="alert">{error || exportError || recording.error}</p>}
      {ready ? <>
        {previewUrl ? <audio ref={audio} aria-label="Recorded mix preview" controls autoPlay src={previewUrl}
          onPlay={() => { void pauseForPreview(); }} />
          : <button type="button" className="recording-listen" aria-label="Listen to take" onClick={listen}>▷ Listen to take</button>}
        <div className="recording-format"><label htmlFor="recording-format">Download format</label>
          <select id="recording-format" value={format} aria-describedby="recording-format-help" onChange={event => { setFormat(event.target.value as RecordingFormat); setNotice(''); setError(''); }}>
            <option value="wav">WAV · Lossless</option><option value="mp3">MP3 · 320 kbps</option>
          </select>
          <p id="recording-format-help">{format === 'wav' ? 'Full-quality stereo audio. Larger file.' : 'High-quality stereo audio. Smaller file.'}</p>
        </div>
        {(!exportBlob && !exportError) && <p className="recording-notice" role="status">Preparing {format.toUpperCase()}…</p>}
        <div className="recording-save-actions"><button type="button" className="recording-primary" aria-label="Save mix" disabled={!exportBlob} onClick={save}>↓ Save {format.toUpperCase()}</button>
          <button type="button" onClick={() => { setNamedSave(true); requestAnimationFrame(() => nameInput.current?.focus()); }}>Save as…</button>
          {hasShare && <button type="button" disabled={!exportBlob} onClick={() => { void saveToFiles(); }}>Save to Files / Share</button>}</div>
        {namedSave && <form className="recording-name" onSubmit={event => { event.preventDefault(); save(); }}><label htmlFor="recording-name">Version name</label>
          <input ref={nameInput} id="recording-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} autoComplete="off" />
          <span>{recordingFilename(name, version, format)}</span><button type="submit" disabled={!exportBlob}>Download version</button></form>}
        {replacePending ? <div className="recording-replace" role="group" aria-label="Keep or replace the unsaved take"><p>This take has not been saved.</p>
          <button type="button" disabled={!exportBlob} onClick={save}>Save this take</button><button type="button" onClick={() => resetTake(true)}>Discard & prepare new</button>
          <button type="button" onClick={() => setReplacePending(false)}>Keep take</button></div>
          : <div className="recording-take-actions"><button type="button" className="recording-new" aria-label="Record new version" disabled={!hasTracks} onClick={prepareNew}>＋ New recording</button><button type="button" className="recording-discard" aria-label="Discard recording" onClick={() => resetTake(false)}>Discard take</button></div>}
      </> : <button type="button" className="recording-primary" disabled={busy || !hasTracks} onClick={() => { if (active) void stop(); else requestStart(); }}>{active ? 'Stop recording' : 'Start recording'}</button>}
      <p className="recording-notice" role="status">{notice || 'Records the mix you hear. Original tracks stay unchanged.'}</p>
    </dialog>
  </>;
}
