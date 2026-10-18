import { t } from '../../i18n';
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
  const [discardPending, setDiscardPending] = useState(false), [encodingProgress, setEncodingProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [format, setFormat] = useState<RecordingFormat>('wav');
  const [prepared, setPrepared] = useState<{ revision: number; format: RecordingFormat; blob: Blob } | null>(null);
  const [exportError, setExportError] = useState('');
  const exportCache = useRef(new Map<RecordingFormat, Blob>());
  const cachedRevision = useRef(recording.revision);
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null), audio = useRef<HTMLAudioElement>(null), previewLease = useRef<string | null>(null);
  const busy = recording.status === 'preparing' || recording.status === 'stopping', active = recording.status === 'recording', ready = recording.status === 'ready' || (recording.status === 'error' && recording.bytes > 0);
  const exportBlob = ready && prepared?.revision === recording.revision && prepared?.format === format ? prepared.blob : null;
  useEffect(() => {
    const controller = new AbortController();
    if (!ready) exportCache.current.clear();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      if (cachedRevision.current !== recording.revision) {
        cachedRevision.current = recording.revision; exportCache.current.clear();
        setRequestedSave(false); setDiscardPending(false); setReplacePending(false); setNotice('');
        audio.current?.pause();
        if (previewLease.current) URL.revokeObjectURL(previewLease.current);
        previewLease.current = null; setPreviewUrl(null);
      }
      setPrepared(null); setExportError(''); setEncodingProgress(0);
      if (!ready) return;
      const cached = exportCache.current.get(format);
      if (cached) { setPrepared({ revision: recording.revision, format, blob: cached }); return; }
      const wav = engine.exportRecording();
      exportCache.current.set('wav', wav);
      if (format === 'wav') setPrepared({ revision: recording.revision, format, blob: wav });
      else {
        const blob = await prepareRecordingMp3(wav, controller.signal, setEncodingProgress);
        if (controller.signal.aborted) return;
        exportCache.current.set('mp3', blob); setPrepared({ revision: recording.revision, format, blob });
      }
    }).catch(cause => {
      if (!controller.signal.aborted) setExportError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [ready, format, recording.revision]);
  useEffect(() => {
    if (ready && (recording.stopReason === 'limit' || recording.stopReason === 'interrupted')) void Promise.resolve().then(() => setOpen(true));
  }, [ready, recording.stopReason]);
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
      setReplacePending(false); setDiscardPending(false); setNotice(''); setError(''); setOpen(showRecorder);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function prepareNew(): void {
    if (ready && !requestedSave) { setReplacePending(true); setOpen(true); } else resetTake(true);
  }
  function requestStart(): void { void start(); }
  function requestDiscard(): void { if (ready && !requestedSave) setDiscardPending(true); else resetTake(false); }

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
      aria-label={t(active ? 'Stop mix recording' : ready ? 'Open recorded mix' : 'Start mix recording')} aria-pressed={active}
      disabled={busy || (!hasTracks && !ready)} title={t(active ? 'Stop and save mix' : 'Record your mix')}
      onClick={() => { if (active) void stop(); else if (ready) setOpen(true); else requestStart(); }}>
      <span className="recording-dot" aria-hidden="true" /><span>{t(active ? clock(recording.durationSeconds) : busy ? '…' : ready ? 'Take' : 'Record')}</span></button>
      {active && <span className={'recording-remaining' + (recording.maxDurationSeconds - recording.durationSeconds <= 60 ? ' is-warning' : '')} aria-label={t("Recording time remaining")} role={recording.maxDurationSeconds - recording.durationSeconds <= 60 ? 'alert' : undefined}>{t("Remaining ")}{t(clock(Math.max(0, recording.maxDurationSeconds - recording.durationSeconds)))}</span>}</div>
    <dialog ref={dialog} className="recording-dialog" aria-labelledby="recording-title" onKeyDown={trapFocus}
      onCancel={event => { event.preventDefault(); close(); }} onClose={close}
      onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
      <header><div><span className="recording-eyebrow"><BrandMark />{t("RIMVO · local recording")}</span><h2 id="recording-title">{t(ready ? 'Your mix' : 'Mix recorder')}</h2></div>
        <button ref={closeButton} type="button" className="recording-close" aria-label={t("Close mix recorder")} onClick={close}>×</button></header>
      <div className={'recording-take' + (active ? ' is-recording' : '')}><span className="recording-dot" aria-hidden="true" /><strong>{t(clock(recording.durationSeconds))}</strong>
        <span>{t(ready ? 'Stereo recording' : active ? 'Recording master output' : busy ? 'Preparing…' : 'Ready to record')}</span></div>
      {recording.stopReason === 'limit' && <p className="recording-notice">{t("Recording reached its ")}{t(clock(recording.maxDurationSeconds))} {t("limit. This take is ready to download.")}</p>}
      {recording.stopReason === 'interrupted' && <p className="recording-notice">{t("Audio was interrupted. This take contains the sound captured before the interruption.")}</p>}
      {(error || exportError || recording.error) && <p className="recording-error" role="alert">{t(error || exportError || recording.error)}</p>}
      {ready ? <>
        {previewUrl ? <audio ref={audio} aria-label={t("Recorded mix preview")} controls autoPlay src={previewUrl}
          onPlay={() => { void pauseForPreview(); }} />
          : <button type="button" className="recording-listen" aria-label={t("Listen to take")} onClick={listen}>{t("▷ Listen to take")}</button>}
        <div className="recording-format"><label htmlFor="recording-format">{t("Download format")}</label>
          <select id="recording-format" value={format} aria-describedby="recording-format-help" onChange={event => { setFormat(event.target.value as RecordingFormat); setNotice(''); setError(''); }}>
            <option value="wav">{t("WAV · Lossless")}</option><option value="mp3">{t("MP3 · 320 kbps")}</option>
          </select>
          <p id="recording-format-help">{t(format === 'wav' ? 'Full-quality stereo audio. Larger file.' : 'High-quality stereo audio. Smaller file.')}</p>
        </div>
        {(!exportBlob && !exportError) && <div className="recording-encoding" role="status"><p>{t("Preparing ")}{t(format.toUpperCase())}… {t(format === 'mp3' && `${encodingProgress}%`)}</p>{format === 'mp3' && <><progress aria-label={t("MP3 encoding progress")} max={100} value={encodingProgress} /><button type="button" onClick={() => setFormat('wav')}>{t("Cancel MP3 conversion")}</button></>}</div>}
        <div className="recording-save-actions"><button type="button" className="recording-primary" aria-label={t("Save mix")} disabled={!exportBlob} onClick={save}>{t("↓ Save ")}{t(format.toUpperCase())}</button>
          <button type="button" onClick={() => { setNamedSave(true); requestAnimationFrame(() => nameInput.current?.focus()); }}>{t("Save as…")}</button>
          {hasShare && <button type="button" disabled={!exportBlob} onClick={() => { void saveToFiles(); }}>{t("Save to Files / Share")}</button>}</div>
        {namedSave && <form className="recording-name" onSubmit={event => { event.preventDefault(); save(); }}><label htmlFor="recording-name">{t("Version name")}</label>
          <input ref={nameInput} id="recording-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} autoComplete="off" />
          <span>{recordingFilename(name, version, format)}</span><button type="submit" disabled={!exportBlob}>{t("Download version")}</button></form>}
        {discardPending ? <div className="recording-replace" role="group" aria-label={t("Confirm recording deletion")}><p>{t("Discard this unsaved recording?")}</p><p>{t("You cannot undo this. Save the take first if you want to keep it.")}</p><button type="button" onClick={() => resetTake(false)}>{t("Discard permanently")}</button><button type="button" autoFocus onClick={() => setDiscardPending(false)}>{t("Keep take")}</button></div> : replacePending ? <div className="recording-replace" role="group" aria-label={t("Keep or replace the unsaved take")}><p>{t("This take has not been saved.")}</p>
          <button type="button" disabled={!exportBlob} onClick={save}>{t("Save this take")}</button><button type="button" onClick={() => resetTake(true)}>{t("Discard & prepare new")}</button>
          <button type="button" onClick={() => setReplacePending(false)}>{t("Keep take")}</button></div>
          : <div className="recording-take-actions"><button type="button" className="recording-new" aria-label={t("Record new version")} disabled={!hasTracks} onClick={prepareNew}>{t("＋ New recording")}</button><button type="button" className="recording-discard" aria-label={t("Discard recording")} onClick={requestDiscard}>{t("Discard take")}</button></div>}
      </> : <button type="button" className="recording-primary" disabled={busy || !hasTracks} onClick={() => { if (active) void stop(); else requestStart(); }}>{t(active ? 'Stop recording' : 'Start recording')}</button>}
      <p className="recording-notice" role="status">{t(notice || 'Records the mix you hear. Original tracks stay unchanged.')}</p>
    </dialog>
  </>;
}
