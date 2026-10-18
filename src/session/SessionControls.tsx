import { useEffect, useState } from 'react';
import type { DeckId, DeckSnapshot, HotCueIndex } from '../audio/types';
import { engine, getSnapshot } from '../state/engine';
import { addLocalFiles, ensureDemoTracks, getLibrarySnapshot, loadLibraryTrack } from '../library/library';
import { deleteSession, readSession, writeSession, type SavedSession, type SessionDeck } from './session-store';
import { t } from '../i18n';

type Assignments = Record<DeckId, string | null>;
function saveDeck(deck: DeckSnapshot, trackId: string | null): SessionDeck {
  const { gainDb, eqDb, filterValue, volume, tempoPercent, pitchMode, pitchSemitones, beatGrid, hotCues, cueSeconds, quantize, fx, loop, loopBeats } = deck;
  return { gainDb, eqDb, filterValue, volume, tempoPercent, pitchMode, pitchSemitones, beatGrid, hotCues, cueSeconds, quantize, fx, loop, loopBeats, trackId,
    positionSeconds: deck.track ? engine.readPosition(deck.id).positionSeconds : 0 };
}
export function SessionControls({ assignments, onRestored }: { assignments: Assignments; onRestored: (assignments: Assignments) => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<SavedSession | null>(null), [confirm, setConfirm] = useState<'restore' | 'delete' | null>(null);
  useEffect(() => { let mounted = true; void readSession().then(value => { if (mounted) setSaved(value); }).catch(() => undefined); return () => { mounted = false; }; }, []);
  const activeRecording = () => ['recording', 'preparing', 'stopping'].includes(engine.getRecordingSnapshot().status);
  async function action(task: () => Promise<void>) {
    setBusy(true); setNotice('');
    try { await task(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function save() {
    if (activeRecording()) throw new Error('Stop the recording before saving a session.');
    const snapshot = getSnapshot(), recording = engine.getRecordingSnapshot();
    for (const id of ['A', 'B'] as const) if (snapshot.decks[id].track && !assignments[id]) throw new Error('Re-add loaded tracks to the library before saving a session.');
    const value: SavedSession = {
      version: 1, savedAt: Date.now(),
      tracks: getLibrarySnapshot().map(track => ({ id: track.id, name: track.file?.name ?? track.title, lastModified: track.file?.lastModified ?? 0, file: track.file })),
      decks: { A: saveDeck(snapshot.decks.A, assignments.A), B: saveDeck(snapshot.decks.B, assignments.B) },
      mixer: snapshot.mixer,
      recording: recording.bytes > 0 && ['ready', 'error'].includes(recording.status) ? engine.exportRecording() : null,
    };
    await writeSession(value); setSaved(value); setNotice('Session saved on this device.');
  }
  async function restore() {
    if (!saved) throw new Error('No saved session is available.');
    if (activeRecording()) throw new Error('Stop the recording before restoring a session.');
    // Called from the explicit restore button; restoration never starts playback.
    await engine.initializeFromGesture();
    const snapshot = getSnapshot();
    for (const id of ['A', 'B'] as const) if (snapshot.decks[id].status === 'playing') await engine.pauseDeck(id);
    const local = saved.tracks.filter(track => track.file).map(track => new File([track.file!], track.name, { type: track.file!.type, lastModified: track.lastModified }));
    for (let offset = 0; offset < local.length; offset += 32) await addLocalFiles(local.slice(offset, offset + 32), { analyze: false });
    ensureDemoTracks();
    const mapped: Assignments = { A: null, B: null };
    try {
      for (const id of ['A', 'B'] as const) {
        const settings = saved.decks[id], original = saved.tracks.find(track => track.id === settings.trackId);
        if (!original) { if (getSnapshot().decks[id].track) await engine.unloadDeck(id); continue; }
        const track = original.file ? getLibrarySnapshot().find(entry => entry.file?.name === original.name && entry.file.size === original.file!.size && entry.file.lastModified === original.lastModified) : getLibrarySnapshot().find(entry => entry.id === original.id);
        if (!track) throw new Error('A saved track could not be restored.');
        await loadLibraryTrack(track.id, id); mapped[id] = track.id;
        engine.setGainDb(id, settings.gainDb); engine.setFilter(id, settings.filterValue); engine.setVolume(id, settings.volume);
        for (const band of ['low', 'mid', 'high'] as const) engine.setEqDb(id, band, settings.eqDb[band]);
        await engine.setTempo(id, settings.tempoPercent); engine.setPitchMode(id, settings.pitchMode); engine.setPitchSemitones(id, settings.pitchSemitones);
        if (settings.beatGrid) engine.setBeatGrid(id, settings.beatGrid, settings.beatGrid);
        engine.setQuantize(id, false);
        for (const [index, cue] of settings.hotCues.entries()) if (cue) engine.setHotCue(id, index as HotCueIndex, cue.positionSeconds);
        await engine.seekDeck(id, settings.cueSeconds); engine.setCuePoint(id);
        if (settings.loopBeats && settings.loop) { await engine.seekDeck(id, settings.loop.startSeconds); await engine.setBeatLoop(id, settings.loopBeats); }
        else await engine.setLoop(id, settings.loop);
        await engine.seekDeck(id, settings.positionSeconds); engine.setQuantize(id, settings.quantize);
        for (const type of ['delay', 'reverb', 'drive', 'flanger', 'tremolo'] as const) engine.setFx(id, { type, ...settings.fx[type] } as Parameters<typeof engine.setFx>[1]);
      }
      engine.setCrossfader(saved.mixer.crossfader); engine.setCrossfaderCurve(saved.mixer.crossfaderCurve); engine.setMasterVolume(saved.mixer.masterVolume);
      if (saved.recording) await engine.restoreRecording(saved.recording); else engine.clearRecording();
      setNotice('Session restored. Press Play when you are ready.'); setConfirm(null);
    } finally { onRestored(mapped); }
  }
  return <div className="workspace-control"><button type="button" aria-label={t('Session tools')} aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('Session')}</button>
    {open && <section className="workspace-popover" aria-label={t('Session tools')}>
      <h2>{t('Session')}</h2><p>{t('Save tracks, cues, effects, mixer settings and your stopped take on this device. Nothing is uploaded. Up to 256 MiB; device storage may be cleared by your browser.')}</p>
      <button type="button" disabled={busy} onClick={() => void action(save)}>{t('Save session on this device')}</button>
      <button type="button" disabled={busy || !saved} onClick={() => setConfirm('restore')}>{t('Restore saved session')}</button>
      <button type="button" disabled={busy || !saved} onClick={() => setConfirm('delete')}>{t('Delete saved session')}</button>
      {confirm === 'restore' && <div role="group" aria-label={t('Confirm session restore')}><p>{t('Restore replaces both decks and the current take. Save your current work first. Playback will stay paused.')}</p><button type="button" disabled={busy} onClick={() => void action(restore)}>{t('Restore session now')}</button><button type="button" disabled={busy} onClick={() => setConfirm(null)}>{t('Cancel')}</button></div>}
      {confirm === 'delete' && <div role="group" aria-label={t('Confirm saved session deletion')}><p>{t('Delete the saved session from this device?')}</p><button type="button" disabled={busy} onClick={() => void action(async () => { await deleteSession(); setSaved(null); setConfirm(null); setNotice('Saved session deleted.'); })}>{t('Delete permanently')}</button><button type="button" onClick={() => setConfirm(null)}>{t('Cancel')}</button></div>}
      {busy && <p role="status">{t('Working…')}</p>}
      <p role="status" aria-label={t('Session status')}>{t(notice)}</p>
      <button type="button" onClick={() => setOpen(false)}>{t('Close')}</button>
    </section>}
  </div>;
}
