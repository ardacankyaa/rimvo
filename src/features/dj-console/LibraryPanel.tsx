import { t } from '../../i18n';
import { useMemo, useState, useSyncExternalStore, type ChangeEvent, type DragEvent } from 'react';
import type { DeckId } from '../../audio/types';
import type { LibraryTrack } from '../../library/library';
import { formatMediaTime } from '../../ui/time';
import { ToggleButton } from '../../ui/ControlPrimitives';
import { Icon } from '../../ui/Icon';
import {retryLibraryAnalysis} from '../../library/library';

export interface LibraryPanelProps {
  readonly tracks: readonly LibraryTrack[];
  readonly query: string;
  readonly loadingByDeck: Readonly<Record<DeckId, string | null>>;
  readonly loadedByDeck: Readonly<Record<DeckId,string|null>>;
  readonly occupiedByDeck: Readonly<Record<DeckId,boolean>>;
  readonly onAdd: (files: readonly File[]) => void | Promise<unknown>;
  readonly onLoad: (trackId: string, deckId: DeckId) => void | Promise<unknown>;
  readonly onRemove: (trackId: string) => void;
  readonly onError: (cause: unknown) => void;
}

function metaDuration(track: LibraryTrack): string {
  return track.durationSeconds && Number.isFinite(track.durationSeconds) ? formatMediaTime(track.durationSeconds) : 'Duration pending';
}

function matchingTrack(track: LibraryTrack, query: string): boolean {
  const value = query.trim().toLocaleLowerCase();
  return !value || (track.title + ' ' + track.artist + ' ' + track.file?.name).toLocaleLowerCase().includes(value);
}

function subscribeSize(notify:()=>void){window.addEventListener('resize',notify);return ()=>window.removeEventListener('resize',notify);}
function pageSize(){return window.innerWidth<900||window.innerHeight<640?6:window.innerHeight>=1080?3:window.innerHeight>=900?2:1;}

export function LibraryPanel({ tracks, query, loadingByDeck, loadedByDeck, occupiedByDeck, onAdd, onLoad, onRemove, onError }: LibraryPanelProps) {
  const [scrollable, setScrollable] = useState(true);
  const filtered = useMemo(() => tracks.filter(track => matchingTrack(track, query)), [tracks, query]);
  const size=useSyncExternalStore(subscribeSize,pageSize,()=>1);
  const [selection,setSelection]=useState({query,page:0});
  const pages=Math.max(1,Math.ceil(filtered.length/size));
  const page=selection.query===query?Math.min(selection.page,pages-1):0;
  const visible=scrollable?filtered:filtered.slice(page*size,(page+1)*size);

  function addFiles(files: readonly File[]): void {
    if (!files.length) return;
    try { void Promise.resolve(onAdd(files)).catch(onError); }
    catch (cause) { onError(cause); }
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>): void {
    addFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = '';
  }

  function dropFiles(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    event.currentTarget.classList.remove('is-drop-target');
    addFiles(Array.from(event.dataTransfer.files));
  }

  function loading(trackId: string, id: DeckId): boolean {
    return loadingByDeck[id] === trackId;
  }

  return <section className="library-panel" aria-label={t("Local library")}
    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; event.currentTarget.classList.add('is-drop-target'); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.classList.remove('is-drop-target'); }}
    onDrop={dropFiles}>
    <header className="library-panel__head">
      <div className="library-panel__title">
        <h2>{t("Library")}<span className="library-panel__count">{t(tracks.length)}</span>
          <a className="library-panel__credits-compact" href={import.meta.env.BASE_URL + 'demo-tracks/README.md'} target="_blank" rel="noopener noreferrer">{t("CC0 credits")}</a>
        </h2>
        <p className="visually-hidden">{t("Session only; drop MP3, WAV or FLAC files here")}</p>
      </div>
      <div className="library-panel__actions">
        <input hidden aria-label={t("Add local files")} type="file" accept=".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/flac" multiple onChange={chooseFiles} />
        <details className="library-display-menu"><summary aria-label={t("Library display options")}>{t("View")}</summary><div><button type="button" className="library-mode" aria-label={t("Scrollable library")} aria-pressed={scrollable} onClick={event=>{setScrollable(current=>!current);event.currentTarget.closest('details')!.open=false;}}>{t(scrollable?'Use pages':'Use scroll list')}</button></div></details><nav hidden={scrollable} className="library-pagination" aria-label={t("Library pages")}>
          <button type="button" aria-label={t("Previous library page")} disabled={page===0} onClick={()=>setSelection({query,page:page-1})}><Icon name="left" /></button>
          <output aria-live="polite">{t(page+1)} / {t(pages)}</output>
          <button type="button" aria-label={t("Next library page")} disabled={page===pages-1} onClick={()=>setSelection({query,page:page+1})}><Icon name="right" /></button>
        </nav>
      </div>
    </header>

    {filtered.length ? <><div className="library-columns" aria-hidden="true"><span /><span className="library-columns__names"><span>{t("Title")}</span><span>{t("Artist")}</span></span><span className="library-columns__metadata"><span>{t("Duration")}</span><span>{t("BPM")}</span></span><span>{t("Load")}</span><span /></div><ul className={"library-track-list"+(scrollable?" is-scrollable":"")} aria-label={t("Library tracks")}>
      {visible.map(track => <li className={'library-track library-track-' + track.source} key={track.id}>
        <div className="library-track__cover" aria-hidden="true">
          <span>{track.source === 'demo' ? 'RV' : track.title.slice(0, 1).toUpperCase()}</span>
          {track.artworkUrl && <img src={track.artworkUrl} alt="" width="96" height="96" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} />}
        </div>
        <div className="library-track__main">
          <div className="library-track__title-row">
            <strong title={track.file?.name ?? track.title}>{track.title}</strong>
          </div>
          <span className={'library-track__artist'+(track.source==='demo'||['Local audio file','Local track','Unknown artist'].includes(track.artist)?' is-secondary-credit':'')} title={track.artist}>{track.artist}</span>
        </div>
        <div className="library-track__metadata"><span>{t(metaDuration(track))}</span><span className={'library-bpm is-'+(track.bpmStatus??'complete')} aria-label={t('BPM for '+track.title)} aria-live="polite">{t(track.bpmStatus==='queued'?'BPM queued':track.bpmStatus==='analyzing'?'Finding BPM…':track.bpm?(track.bpmEstimated?'~':'')+track.bpm.toFixed(1)+' BPM':track.bpmStatus==='unavailable'?'No steady beat':track.bpmStatus==='error'?'Analysis failed':'Load to find BPM')}{(track.bpmStatus==='error'||track.bpmStatus==='unavailable')&&<button type="button" aria-label={t('Retry BPM '+track.title)} title={t("Analyze this track again")} onClick={()=>{void retryLibraryAnalysis(track.id).catch(onError);}}>↻</button>}</span></div>
        <div className="library-track__loaders">
          {(['A', 'B'] as const).map(id => <ToggleButton key={id} className="library-load-button" tone={id === 'A' ? 'a' : 'b'} pressed={loading(track.id, id)} disabled={loading(track.id, id)}
            aria-label={t((loadedByDeck[id]===track.id?'Reload ':occupiedByDeck[id]?'Replace ':'Load ') + id + ': ' + track.title)}
            title={t(loadedByDeck[id]===track.id?'Loaded in '+id:occupiedByDeck[id]?'Replace '+id+' with '+track.title:'Load into '+id)}
            data-loaded={loadedByDeck[id]===track.id}
            onClick={() => { try { void Promise.resolve(onLoad(track.id, id)).catch(onError); } catch (cause) { onError(cause); } }}>
            {loading(track.id, id) ? '…' : <>{t(id)}{loadedByDeck[id]===track.id&&<span className="library-loaded-mark" aria-label={t('Loaded in '+id)}>✓</span>}</>}
          </ToggleButton>)}
        </div>
        {track.source === 'local' && <button className="library-track__remove" type="button" aria-label={t('Remove ' + track.title)} title={t("Remove from Library; loaded audio keeps playing")} onClick={() => onRemove(track.id)}>{t("Remove")}</button>}
      </li>)}
    </ul></> : <div className="library-empty" role="status">
      <strong>{t(query.trim() ? 'No matching tracks' : 'The library is empty')}</strong>
      <span>{t(query.trim() ? 'Try a shorter title or artist name.' : 'Add local tracks or start with two RIMVO originals.')}</span>
    </div>}

  </section>;
}
