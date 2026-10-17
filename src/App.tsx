import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type SyntheticEvent } from 'react';
import type { DeckId, HotCueIndex } from './audio/types';
import { engine, getSnapshot, subscribe } from './state/engine';
import { createUiSnapshotReader } from './state/ui-snapshot';
import { addLocalFiles, ensureDemoTracks, getLibrarySnapshot, loadLibraryTrack, removeLibraryTrack, subscribeLibrary, updateLibraryTrack } from './library/library';
import { DeckPanel, DeckTools, type DeckToolTab } from './features/dj-console/DeckPanel';
import { LibraryPanel } from './features/dj-console/LibraryPanel';
import { Mixer, MixerTools } from './features/dj-console/Mixer';
import { cancelAllGestures, useGestureBlurCleanup } from './ui/gesture-registry';
import { Waveform } from './features/dj-console/Waveform';
import { Icon } from './ui/Icon';
import { BrandMark } from './ui/BrandMark';
import { GuidedMixMissions } from './features/dj-console/GuidedMixMissions';
import { positionDisclosure } from './ui/disclosure-position';
import { RecordingControls } from './features/recording/RecordingControls';
import { LegalPanel } from './legal/LegalPanel';
import type { LegalPage } from './legal/policies';
import { readThemePreference, writeThemePreference } from './legal/preference-storage';

type ErrorOwner = DeckId | 'library' | 'general';
type UiError = { readonly message: string; readonly owner: ErrorOwner; readonly retry?: {readonly trackId:string;readonly deckId:DeckId} };
type DockContext = 'library' | DeckId | 'mixer';
const dockContexts: readonly DockContext[] = ['library', 'A', 'B', 'mixer'];
const dockLabels: Record<DockContext, string> = { library: 'Library', A: 'Tools A', B: 'Tools B', mixer: 'Mixer settings' };
const getUiSnapshot = createUiSnapshotReader(getSnapshot);

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
function isObsoleteLoad(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const value = cause as { name?: string; code?: string };
  return value.name === 'AbortError' || value.code === 'stale-load' || value.code === 'aborted';
}
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest('input, textarea, select, button, a[href], [role="textbox"], [role="slider"], summary');
}

function dialogTab(event: ReactKeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href], area[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
  )).filter(element => !element.hidden && element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true'
    && !element.closest('[inert]') && element.getClientRects().length > 0);
  if (controls.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const active = dialog.ownerDocument.activeElement;
  const activeIndex = controls.findIndex(control => control === active);
  if (activeIndex < 0) {
    event.preventDefault();
    (event.shiftKey ? controls[controls.length - 1] : controls[0]).focus();
  } else if (event.shiftKey && activeIndex === 0) {
    event.preventDefault();
    controls[controls.length - 1].focus();
  } else if (!event.shiftKey && activeIndex === controls.length - 1) {
    event.preventDefault();
    controls[0].focus();
  }
}

export default function App() {
  const [theme,setTheme] = useState(readThemePreference);
  const [legalPage, setLegalPage] = useState<LegalPage | null>(null);
  const legalOpener = useRef<HTMLButtonElement>(null);
  const [dockSignal,setDockSignal] = useState(0);
  useEffect(()=>{document.body.dataset.theme=theme;writeThemePreference(theme);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#111214':'#edebe8');},[theme]);
  useEffect(()=>{
    const selector='.deck-quick-effects,.bpm-control,.session-menu,.library-display-menu';
    const reposition=()=>document.querySelectorAll<HTMLDetailsElement>(selector).forEach(positionDisclosure);
    const observer=new ResizeObserver(reposition);
    const close=(detail:HTMLDetailsElement,cancel=true)=>{if(cancel)cancelAllGestures();detail.open=false;};
    const outside=(event:PointerEvent)=>{if(event.pointerType==='touch'&&!event.isPrimary)return;for(const detail of document.querySelectorAll<HTMLDetailsElement>(selector))if(detail.open&&!detail.contains(event.target as Node))close(detail,event.pointerType!=='touch');};
    const exclusive=(event:Event)=>{
      const target=event.target;
      if(!(target instanceof HTMLDetailsElement)||!target.matches(selector))return;
      const menu=target.querySelector<HTMLElement>('.session-menu__content,.deck-effects-menu,.library-display-menu>div');
      if(target.open){
        for(const detail of document.querySelectorAll<HTMLDetailsElement>(selector))if(detail!==target&&detail.open)close(detail,false);
        positionDisclosure(target);
        if(menu)observer.observe(menu);
      }else if(menu)observer.unobserve(menu);
    };
    const escape=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;const detail=[...document.querySelectorAll<HTMLDetailsElement>(selector)].find(item=>item.open);if(detail){event.preventDefault();close(detail);detail.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});}};
    document.addEventListener('pointerdown',outside);document.addEventListener('toggle',exclusive,true);document.addEventListener('keydown',escape);
    window.addEventListener('resize',reposition);document.addEventListener('scroll',reposition,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',reposition);document.removeEventListener('scroll',reposition,true);document.removeEventListener('pointerdown',outside);document.removeEventListener('toggle',exclusive,true);document.removeEventListener('keydown',escape);};
  },[]);
  const snapshot = useSyncExternalStore(subscribe, getUiSnapshot);
  const tracks = useSyncExternalStore(subscribeLibrary, getLibrarySnapshot);
  const trackById = useMemo(() => new Map(tracks.map(track => [track.id, track] as const)), [tracks]);
  const [error, setError] = useState<UiError | null>(null);
  const [message, setMessage] = useState('Try a mix with the demo tracks, or add your own.');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const libraryPopup = useRef<HTMLDivElement>(null);
  const closeSearch = useCallback((restoreFocus = false) => {
    setSearchOpen(false);
    if (restoreFocus) searchInput.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    if (!searchOpen) return;
    const popupNode = libraryPopup.current;
    const place = () => {
      const input = searchInput.current, panel = libraryPopup.current;
      if (!input || !panel) return;
      const anchor = input.closest('label')!.getBoundingClientRect();
      const width = Math.min(560, window.innerWidth - 24);
      const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
      const top = anchor.bottom + 8;
      Object.assign(panel.style, { left: left + 'px', top: top + 'px', width: width + 'px', maxHeight: Math.max(0, window.innerHeight - top - 12) + 'px' });
    };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if(event.type==='focusin'&&(target===document.body||target===document.documentElement))return;
      if (!libraryPopup.current?.contains(target) && !searchInput.current?.closest('label')?.contains(target)) closeSearch();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setQuery(''); closeSearch(true); }
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      popupNode?.removeAttribute('style');
    };
  }, [searchOpen, closeSearch]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPage, setHelpPage] = useState('First mix');
  const mixPair=snapshot.decks.A.revision+':'+snapshot.decks.B.revision;
  const [transitionProgress,setTransitionProgress]=useState({pair:'',count:0});
  const completedTransitions=transitionProgress.pair===mixPair?transitionProgress.count:0;
  const [bpmRequests,setBpmRequests]=useState<Record<DeckId,number>>({A:0,B:0});
  const [dockContext, setDockContext] = useState<DockContext>('library');
  const [toolTabs, setToolTabs] = useState<Record<DeckId, DeckToolTab>>({ A: 'loop', B: 'loop' });
  const [zoomByDeck, setZoomByDeck] = useState<Record<DeckId, 1 | 2 | 4>>({ A: 1, B: 1 });
  const importFiles = useRef<HTMLInputElement>(null);
  const [loadingByDeck, setLoadingByDeck] = useState<Record<DeckId, string | null>>({ A: null, B: null });
  const [trackAssignment, setTrackAssignment] = useState<Record<DeckId, { readonly trackId: string; readonly revision: number } | null>>({ A: null, B: null });
  const loadIntent = useRef<Record<DeckId, number>>({ A: 0, B: 0 });
  const statusIntent = useRef(0);
  const activeDeck = useRef<DeckId>('A');
  const [activeDeckId, setActiveDeckId] = useState<DeckId>('A');
  const selectDeck = useCallback((id: DeckId) => { activeDeck.current = id; setActiveDeckId(id); }, []);
  const selectWaveformDeck = useCallback((event: SyntheticEvent<HTMLDivElement>) => {
    selectDeck(event.currentTarget.dataset.deck as DeckId);
  }, [selectDeck]);
  const publishedAnalysis = useRef(new Map<string, string>());
  const closeHelpButton = useRef<HTMLButtonElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const helpOpener = useRef<HTMLButtonElement>(null);
  const helpReturnTarget = useRef<HTMLElement>(null);
  const helpFocusRedirect = useRef(false);
  const reportError = useCallback((cause: unknown, owner: ErrorOwner = 'general', retry?:UiError['retry']) => {
    setError({ message: causeMessage(cause), owner, retry });
  }, []);
  const clearError = useCallback((owner: ErrorOwner) => {
    setError(current => current?.owner === owner ? null : current);
  }, []);
  const run = useCallback((action: () => void | Promise<unknown>) => {
    clearError('general');
    try {
      void Promise.resolve(action()).catch(cause => { if (!isObsoleteLoad(cause)) reportError(cause); });
    } catch (cause) { reportError(cause); }
  }, [clearError, reportError]);

  useGestureBlurCleanup();
  useEffect(() => { ensureDemoTracks(); }, []);
  useEffect(() => {
    const dialog = helpDialog.current;
    const opener = helpReturnTarget.current ?? helpOpener.current;
    if (!dialog) return;
    if (helpOpen) {
      cancelAllGestures();
      if (!dialog.open) dialog.showModal();
      closeHelpButton.current?.focus();
      return () => {
        if (dialog.open) dialog.close();
        if(!helpFocusRedirect.current)opener?.focus();
        helpFocusRedirect.current=false;
      };
    }
    if (dialog.open) dialog.close();
  }, [helpOpen]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (helpOpen || document.querySelector('dialog[open]')) return;
      if (isTypingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === '?' && !event.repeat) { event.preventDefault(); setHelpOpen(true); return; }
      const focusedDeck = activeDeck.current;
      if (event.code === 'Space') {
        if (event.repeat) return;
        event.preventDefault();
        const deck = getSnapshot().decks[focusedDeck];
        if (!deck.track) return;
        run(() => deck.status === 'playing' ? engine.pauseDeck(focusedDeck) : engine.playDeck(focusedDeck));
        return;
      }
      if (/^[1-8]$/.test(event.key)) {
        if (event.repeat) return;
        event.preventDefault();
        const index = (Number(event.key) - 1) as HotCueIndex;
        const deck = getSnapshot().decks[focusedDeck];
        if (!deck.track) return;
        run(() => deck.hotCues[index] ? engine.triggerHotCue(focusedDeck, index) : engine.setHotCue(focusedDeck, index, engine.readPosition(focusedDeck).positionSeconds));
        return;
      }
      if (event.key.toLowerCase() === 'q') {
        if (event.repeat) return;
        event.preventDefault();
        if (getSnapshot().decks[focusedDeck].track) run(() => engine.cueDeck(focusedDeck));
        return;
      }
      if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        if (getSnapshot().decks[focusedDeck].track) run(() => engine.nudgeDeck(focusedDeck, event.key === 'ArrowLeft' ? -4 : 4));
        return;
      }
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        const current = getSnapshot().mixer.crossfader;
        const next = Math.max(0, Math.min(1, current + (event.key === '[' ? -0.05 : 0.05)));
        run(() => engine.setCrossfader(next));
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [helpOpen, run]);

  const performLibraryLoad = useCallback(async (trackId: string, deckId: DeckId, request: number, statusRequest?: number): Promise<void> => {
    const statusIsCurrent = () => statusRequest === undefined || statusRequest === statusIntent.current;
    const entry = getLibrarySnapshot().find(track => track.id === trackId);
    if (!entry) {
      if (request === loadIntent.current[deckId]) {
        reportError('Choose a track from the local library.', deckId);
        if (statusIsCurrent()) setMessage('Could not load the selected track into Deck ' + deckId + '.');
      }
      return;
    }
    setLoadingByDeck(current => ({ ...current, [deckId]: trackId }));
    if (statusIsCurrent()) setMessage('Loading ' + entry.title + ' into Deck ' + deckId + '…');
    try {
      await loadLibraryTrack(trackId, deckId);
      if (request !== loadIntent.current[deckId]) return;
      const currentEntry = getLibrarySnapshot().find(track => track.id === trackId);
      const deck = getSnapshot().decks[deckId];
      if (!currentEntry) throw new Error('This track was removed before it finished loading.');
      const track = deck.track;
      if (!track) throw new Error('The audio engine did not install the selected track.');
      setTrackAssignment(current => ({ ...current, [deckId]: { trackId, revision: track.revision } }));
      updateLibraryTrack(trackId, { durationSeconds: deck.durationSeconds });
      if (statusIsCurrent()) setMessage('Loaded ' + currentEntry.title + ' into Deck ' + deckId + '.');
    } catch (cause) {
      if (request === loadIntent.current[deckId] && !isObsoleteLoad(cause)) {
        reportError(new Error('Could not load '+entry.title+' into Deck '+deckId+'. '+causeMessage(cause)), deckId, {trackId,deckId});
        if (statusIsCurrent()) setMessage('Could not load ' + entry.title + ' into Deck ' + deckId + '.');
      }
    } finally {
      if (request === loadIntent.current[deckId]) setLoadingByDeck(current => ({ ...current, [deckId]: null }));
    }
  }, [reportError]);

  const loadFromLibrary = useCallback((trackId: string, deckId: DeckId): Promise<void> => {
    const request = ++loadIntent.current[deckId];
    const statusRequest = ++statusIntent.current;
    clearError(deckId);
    return performLibraryLoad(trackId, deckId, request, statusRequest);
  }, [clearError, performLibraryLoad]);

  const loadDemoDecks = useCallback(async (): Promise<void> => {
    ensureDemoTracks();
    await Promise.all([loadFromLibrary('demo-after-hours', 'A'), loadFromLibrary('demo-open-circuit', 'B')]);
  }, [loadFromLibrary]);
  const loadEmptyDemoDecks = useCallback(async (): Promise<void> => {
    ensureDemoTracks();
    const current=getSnapshot();
    await Promise.all((['A','B'] as const).filter(id=>!current.decks[id].track&&!loadingByDeck[id]).map(id=>loadFromLibrary(id==='A'?'demo-after-hours':'demo-open-circuit',id)));
  },[loadFromLibrary,loadingByDeck]);

  const addFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    if (!files.length) return;
    const statusRequest = ++statusIntent.current;
    const count = files.length;
    clearError('library');
    setMessage('Adding ' + count + ' local track' + (count === 1 ? '' : 's') + '…');
    try {
      await engine.initializeFromGesture();
      await addLocalFiles(files);
      if (statusRequest === statusIntent.current) setMessage('Tracks added to Library.');
    } catch (cause) {
      if (!isObsoleteLoad(cause)) {
        if (statusRequest === statusIntent.current) setMessage('Local track import failed.');
        throw cause;
      }
    }
  }, [clearError]);
  const addFileAndLoad = useCallback(async (file: File, deckId: DeckId): Promise<void> => {
    const request = ++loadIntent.current[deckId];
    const statusRequest = ++statusIntent.current;
    const pendingLabel = 'pending-file:' + file.name;
    clearError(deckId);
    setLoadingByDeck(current => ({ ...current, [deckId]: pendingLabel }));
    setMessage('Adding 1 local track to Deck ' + deckId + '…');
    try {
      await engine.initializeFromGesture();
      if (request !== loadIntent.current[deckId]) return;
      await addLocalFiles([file],{analyze:false});
      if (request !== loadIntent.current[deckId]) return;
      const entry = getLibrarySnapshot().find(track => track.file === file || (track.file?.name === file.name && track.file.size === file.size && track.file.lastModified === file.lastModified));
      if (!entry) throw new Error('The selected file could not be added to the local library.');
      await performLibraryLoad(entry.id, deckId, request, statusRequest);
    } catch (cause) {
      if (request === loadIntent.current[deckId] && !isObsoleteLoad(cause)) {
        reportError(cause, deckId);
        if (statusRequest === statusIntent.current) setMessage('Could not load the selected file into Deck ' + deckId + '.');
      }
    } finally {
      if (request === loadIntent.current[deckId]) {
        setLoadingByDeck(current => current[deckId] === pendingLabel ? { ...current, [deckId]: null } : current);
      }
    }
  }, [clearError, performLibraryLoad, reportError]);
  const unloadDeck = useCallback(async (deckId: DeckId): Promise<void> => {
    const request = ++loadIntent.current[deckId];
    const statusRequest = ++statusIntent.current;
    await engine.unloadDeck(deckId);
    if (request !== loadIntent.current[deckId]) return;
    setTrackAssignment(current => ({ ...current, [deckId]: null }));
    setLoadingByDeck(current => ({ ...current, [deckId]: null }));
    if (statusRequest === statusIntent.current) setMessage('Unloaded Deck ' + deckId + '.');
  }, []);
  const removeTrack = useCallback((trackId: string) => {
    const statusRequest = ++statusIntent.current;
    const entry = getLibrarySnapshot().find(track => track.id === trackId);
    const loading: Record<DeckId, string | null> = { ...loadingByDeck };
    for (const id of ['A', 'B'] as const) {
      const assignment = trackAssignment[id];
      if (assignment?.trackId === trackId || loading[id] === trackId) {
        loadIntent.current[id]++;
        if (assignment?.trackId === trackId) setTrackAssignment(current => ({ ...current, [id]: null }));
        if (loading[id] === trackId) loading[id] = null;
      }
    }
    removeLibraryTrack(trackId);
    setLoadingByDeck(loading);
    if (statusRequest === statusIntent.current) setMessage(entry ? 'Removed ' + entry.title + ' from the library. Loaded audio keeps playing.' : 'Removed track from the library.');
  }, [loadingByDeck, trackAssignment]);

  useEffect(() => {
    const ids = ['A', 'B'] as const;
    for (const id of ids) {
      const assignment = trackAssignment[id];
      const deck = snapshot.decks[id];
      if (!assignment || !deck.track || deck.track.revision !== assignment.revision || deck.revision !== assignment.revision || !trackById.has(assignment.trackId)) continue;
      let bpm: number | undefined;
      if (deck.beatGrid && deck.beatGrid.source !== 'auto') bpm = deck.beatGrid.bpm;
      else if (deck.bpmAnalysis.status === 'complete') bpm = deck.bpmAnalysis.candidates[0]?.bpm;
      if (bpm === undefined) {
        const previous=publishedAnalysis.current.get(id);
        if(!deck.beatGrid&&previous?.startsWith(assignment.trackId+':'+assignment.revision+':')&&deck.bpmAnalysis.status==='unavailable'){
          publishedAnalysis.current.delete(id);
          updateLibraryTrack(assignment.trackId,{bpm:null,bpmStatus:'unavailable'});
        }
        continue;
      }
      const estimated=deck.beatGrid?.source==='auto'?deck.beatGrid.confidence<.75:!deck.beatGrid&&(deck.bpmAnalysis.candidates[0]?.confidence??0)<.75;
      const key = assignment.trackId + ':' + assignment.revision + ':' + bpm.toFixed(2)+':'+(deck.beatGrid?.source??'auto')+':'+estimated;
      if (publishedAnalysis.current.get(id) === key) continue;
      publishedAnalysis.current.set(id, key);
      updateLibraryTrack(assignment.trackId, { durationSeconds: deck.durationSeconds, bpm, bpmStatus:'complete',bpmEstimated:estimated });
    }
  }, [snapshot, trackById, trackAssignment]);

  const entryForDeck = (id: DeckId) => {
    const assignment = trackAssignment[id];
    const deck = snapshot.decks[id];
    if (!assignment || !deck.track || deck.track.revision !== assignment.revision || deck.revision !== assignment.revision) return null;
    return trackById.get(assignment.trackId) ?? null;
  };
  const entryA = entryForDeck('A');
  const entryB = entryForDeck('B');
  const requiresReload = snapshot.contextState === 'closed' || snapshot.contextState === 'faulted';
  const audioLabel = snapshot.contextState === 'running' ? 'Audio ready' : snapshot.contextState === 'suspended' || snapshot.contextState === 'interrupted' ? 'Audio paused' : requiresReload ? 'Audio needs restart' : 'Audio not started';
  const showResume = snapshot.contextState === 'suspended' || snapshot.contextState === 'interrupted';

  function openDock(context: DockContext): void {
    cancelAllGestures();
    if (context === 'A' || context === 'B') selectDeck(context);
    setDockContext(context);
    setDockSignal(current=>current+1);
  }
  function openDeckTools(id: DeckId, tab?: DeckToolTab): void {
    selectDeck(id);
    if (tab) setToolTabs(current => ({ ...current, [id]: tab }));
    openDock(id);
    requestAnimationFrame(() => document.getElementById('dock-tab-' + id)?.focus());
  }
  function openTrackBpm(id:DeckId):void {
    if(!getSnapshot().decks[id].track)return;
    cancelAllGestures();
    if(helpDialog.current?.open){helpFocusRedirect.current=true;helpDialog.current.close();}
    setHelpOpen(false);closeSearch();selectDeck(id);
    setBpmRequests(current=>({...current,[id]:current[id]+1}));
  }
  function dockKey(event: ReactKeyboardEvent<HTMLButtonElement>, context: DockContext): void {
    const index = dockContexts.indexOf(context);
    const next = event.key === 'ArrowRight' ? (index + 1) % dockContexts.length
      : event.key === 'ArrowLeft' ? (index + dockContexts.length - 1) % dockContexts.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? dockContexts.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const selected = dockContexts[next];
    openDock(selected);
    document.getElementById('dock-tab-' + selected)?.focus();
  }

  const errorNotice=error&&<div className="dock-error" role="alert"><span><strong>{error.owner==='A'||error.owner==='B'?'Deck '+error.owner:error.owner==='library'?'Library':'Audio'} · </strong>{error.message}</span>
    {error.retry&&trackById.has(error.retry.trackId)&&<button type="button" onClick={()=>{const retry=error.retry!;run(()=>loadFromLibrary(retry.trackId,retry.deckId));}}>Retry load</button>}
    {!error.retry&&error.owner!=='general'&&<button type="button" onClick={()=>importFiles.current?.click()}>Choose files</button>}
    <button type="button" aria-label="Dismiss error" onClick={()=>setError(null)}>Dismiss</button></div>;
  return <>
    <a className="skip-link" href="#main-console">Skip to main content</a>
    <main id="main-console" tabIndex={-1} className="app-shell">
    <header className="topbar"><div className="brand-lockup"><BrandMark />
        <h1>RIMVO</h1></div>
      <label className="search-field workspace-search"><Icon name="search" /><input ref={searchInput} role="combobox" aria-label="Search library" aria-expanded={searchOpen} aria-haspopup="dialog" aria-controls="dock-panel-library" name="library-search" autoComplete="off" type="search" value={query}
        onClick={()=>setSearchOpen(true)} onChange={event=>{setQuery(event.currentTarget.value);setSearchOpen(true);}}
        onKeyDown={event=>{
          if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setQuery('');closeSearch();}
          if(event.key==='ArrowDown'||(event.key==='Tab'&&!event.shiftKey&&searchOpen)){
            event.preventDefault();setSearchOpen(true);requestAnimationFrame(()=>{
              const panel=libraryPopup.current;
              (panel?.querySelector<HTMLButtonElement>('.library-track__loaders button:not(:disabled)')??panel?.querySelector<HTMLButtonElement>('.track-search__close'))?.focus({preventScroll:true});
            });
          }
        }} placeholder="Search music" /></label>
      <div className="audio-session"><RecordingControls hasTracks={Boolean(snapshot.decks.A.track || snapshot.decks.B.track)} /><button type="button" className="theme-toggle" aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} onClick={()=>setTheme(current=>current==='dark'?'light':'dark')}><svg viewBox="0 0 24 24" aria-hidden="true">{theme==='dark'?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></>:<path d="M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z"/>}</svg></button><span className={'audio-session__state' + (snapshot.contextState === 'running' ? ' is-running' : '')}><i />{audioLabel}</span>
        {snapshot.sampleRate && <span className="audio-session__rate">{(snapshot.sampleRate / 1000).toFixed(1)} kHz</span>}
        {showResume&&<button type="button" className="audio-recovery" onClick={()=>run(()=>engine.resume())}>Resume audio</button>}
        {requiresReload&&<button type="button" className="audio-recovery" onClick={()=>{document.querySelector<HTMLDetailsElement>('.session-menu')!.open=true;document.querySelector<HTMLButtonElement>('.audio-session__recovery button')?.focus();}}>Restore audio</button>}
        <details className="session-menu"><summary aria-label="Audio session and demo tracks"><Icon name="power" /></summary><div className="session-menu__content">
        <button type="button" className="audio-start" aria-label="Start audio" disabled={requiresReload} onClick={() => run(() => engine.initializeFromGesture())}>Start audio</button>
        <button type="button" className="audio-start" aria-label="Load demo decks" disabled={Boolean(loadingByDeck.A || loadingByDeck.B)} onClick={() => run(loadDemoDecks)}>Replace both with demos</button>
        <button type="button" className="audio-secondary" aria-label="Suspend audio" disabled={snapshot.contextState !== 'running'} onClick={() => run(() => engine.suspend())}>Suspend</button>
        {requiresReload && <div className="audio-session__recovery"><p>Reload clears this session; add local files again.</p><button type="button" className="audio-secondary" onClick={() => window.location.reload()}>Reload app</button></div>}
        </div></details>
        <button type="button" className="audio-secondary audio-add" aria-label="Add your tracks" title="Add your tracks" onClick={() => { openDock('library'); importFiles.current?.click(); }}><Icon name="plus" /></button>
        <input ref={importFiles} type="file" accept=".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/flac" multiple hidden aria-label="Add your tracks files"
          onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addFiles(files).catch(cause => reportError(cause, 'library')); }} />
        <button ref={helpOpener} type="button" className="shortcut-open" aria-label="Help and keyboard shortcuts" aria-expanded={helpOpen} onClick={event => {helpReturnTarget.current=event.currentTarget;setHelpOpen(true);}}><Icon name="question" /><span>Help</span></button>
      </div>
    </header>
    <section className={'waveform-bank' + (!snapshot.decks.A.track && !snapshot.decks.B.track ? ' waveform-bank--welcome' : '')} aria-label="Deck waveforms">
      {!snapshot.decks.A.track && !snapshot.decks.B.track ? <div className="first-session" role="region" aria-label="Start your first mix">
        <div className="first-session__records" aria-hidden="true">{['demo-after-hours','demo-open-circuit'].map((trackId,index) => <span key={trackId}>{trackById.get(trackId)?.artworkUrl ? <img src={trackById.get(trackId)!.artworkUrl!} alt="" /> : <i>{index === 0 ? 'A' : 'B'}</i>}</span>)}</div>
        <div className="first-session__copy"><h2>Your first mix</h2><p className="visually-hidden">Play a track. Blend the records. Try an effect.</p></div>
        <div className="first-session__actions"><button type="button" className="demo-entry" disabled={requiresReload || Boolean(loadingByDeck.A || loadingByDeck.B)} title="Load two demo tracks, then press Play" onClick={() => run(async () => {
          const loading=loadDemoDecks();const focusIntent=statusIntent.current;await loading;
          if (statusIntent.current===focusIntent&&getSnapshot().decks.A.track && getSnapshot().decks.B.track && document.activeElement === document.body) {
            document.querySelector<HTMLButtonElement>('[aria-label="Play/Pause A"]')?.focus({ preventScroll: true });
          }
        })}><svg className="first-session__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="12" r="6"/><circle cx="16" cy="12" r="6"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/></svg>{loadingByDeck.A || loadingByDeck.B ? 'Loading…' : 'Try a mix'}</button>
        <button type="button" className="first-session__import" onClick={() => { openDock('library'); importFiles.current?.click(); }}><Icon name="folder" />Add music</button></div>
      </div> : (['A','B'] as const).map(id => {
        const deck=snapshot.decks[id];
        return <div key={id} data-deck={id} onFocusCapture={selectWaveformDeck} onPointerDownCapture={selectWaveformDeck}>
          <Waveform id={id} revision={deck.revision} waveform={deck.track?.waveform ?? null} durationSeconds={deck.durationSeconds}
            effectiveBpm={deck.effectiveBpm} accent={theme==='dark'?(id==='A'?'#C9B590':'#AAB7C7'):(id==='A'?'#B89C7A':'#9B9C99')} disabled={!deck.track}
            onSeek={seconds=>engine.seekDeck(id,seconds)} onError={cause=>reportError(cause,id)}
            grid={deck.beatGrid?{bpm:deck.beatGrid.bpm,firstBeatSeconds:deck.beatGrid.firstBeatSeconds}:null}
            loop={deck.loop} hotCues={deck.hotCues} zoomLevel={zoomByDeck[id]} showZoom={false} />
        </div>;
      })}
    </section>
    <div className="console-grid">
      <DeckPanel id="A" deck={snapshot.decks.A} trackEntry={entryA} bpmRequest={bpmRequests.A} run={run} onError={cause => reportError(cause, 'A')} onNotify={setMessage}
        onLoadFile={addFileAndLoad} onUnloadDeck={unloadDeck} onFocusDeck={selectDeck} isActive={activeDeckId === 'A'} activeTool={dockContext==='A'?toolTabs.A:null} zoomLevel={zoomByDeck.A} onOpenTools={openDeckTools} loading={loadingByDeck.A !== null} />
      <Mixer snapshot={snapshot} run={run} onLearn={()=>{helpReturnTarget.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setHelpPage('First mix');setHelpOpen(true);}} onTransitionComplete={()=>setTransitionProgress(current=>({pair:mixPair,count:current.pair===mixPair?current.count+1:1}))} onOpenTools={() => { openDock('mixer'); requestAnimationFrame(() => document.getElementById('dock-tab-mixer')?.focus()); }} />
      <DeckPanel id="B" deck={snapshot.decks.B} trackEntry={entryB} bpmRequest={bpmRequests.B} run={run} onError={cause => reportError(cause, 'B')} onNotify={setMessage}
        onLoadFile={addFileAndLoad} onUnloadDeck={unloadDeck} onFocusDeck={selectDeck} isActive={activeDeckId === 'B'} activeTool={dockContext==='B'?toolTabs.B:null} zoomLevel={zoomByDeck.B} onOpenTools={openDeckTools} loading={loadingByDeck.B !== null} />
    </div>
    <section className={'tools-dock'+(dockContext!=='library'?' tools-dock--engaged':'')} data-context={dockContext} aria-label="Library and tools">
      <div className="tools-dock__tabs" role="tablist" aria-label="Session tools">
        {dockContexts.map(context => <button key={context} id={'dock-tab-' + context} type="button" role="tab" aria-selected={dockContext === context}
          aria-controls={'dock-panel-' + context} tabIndex={dockContext === context ? 0 : -1} onClick={() => openDock(context)} onKeyDown={event => dockKey(event, context)}><Icon name={context==='library'?'folder':context==='mixer'?'power':'play'} />{dockLabels[context]}</button>)}
        <span className="tools-dock__hint">{dockContext === 'library' ? 'Load a track into A or B. Files stay on this device.' : 'Your main mixing controls stay above.'}</span>
      </div>
      <div className="tools-dock__body">{dockContext!=='library'&&<button type="button" className="mobile-dock-close" aria-label="Close tools" onClick={()=>openDock('library')}>×</button>}<i key={dockSignal} className="tool-reveal-signal" aria-hidden="true" />
        {!searchOpen&&errorNotice}
        <div ref={libraryPopup} className={'tools-panel'+(searchOpen?' track-search-popover':'')} id="dock-panel-library" role={searchOpen?'dialog':'tabpanel'} aria-label={searchOpen?'Track search results':undefined} aria-labelledby={searchOpen?undefined:'dock-tab-library'} hidden={!searchOpen && dockContext !== 'library'}>
          {searchOpen && <button type="button" className="track-search__close" aria-label="Close track search" onClick={()=>closeSearch(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
          <LibraryPanel tracks={tracks} query={query} loadingByDeck={loadingByDeck} loadedByDeck={{A:entryA?.id??null,B:entryB?.id??null}} occupiedByDeck={{A:Boolean(snapshot.decks.A.track),B:Boolean(snapshot.decks.B.track)}} onAdd={addFiles} onLoad={loadFromLibrary} onRemove={removeTrack}
            onError={cause => reportError(cause, 'library')} />
          {searchOpen&&errorNotice}
        </div>
        {(['A', 'B'] as const).map(id => <div className="tools-panel" key={id} id={'dock-panel-' + id} role="tabpanel" aria-labelledby={'dock-tab-' + id} hidden={dockContext !== id}>
          <DeckTools key={snapshot.decks[id].revision} id={id} deck={snapshot.decks[id]} onOpenBpm={openTrackBpm} run={run} onError={cause => reportError(cause, id)} onNotify={setMessage}
            onUnloadDeck={unloadDeck} tab={toolTabs[id]} onTabChange={tab => { cancelAllGestures(); setToolTabs(current => ({ ...current, [id]: tab })); }}
            zoomLevel={zoomByDeck[id]} onZoomChange={zoom => setZoomByDeck(current => ({ ...current, [id]: zoom }))} />
        </div>)}
        <div className="tools-panel" id="dock-panel-mixer" role="tabpanel" aria-labelledby="dock-tab-mixer" hidden={dockContext !== 'mixer'}><MixerTools snapshot={snapshot} run={run} /></div>
      </div>
    </section>
    <footer className="session-footer"><span className="local-mark" title="All processing is local to this browser"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="9" width="10" height="8" rx="2"/><path d="M7 9V6a3 3 0 0 1 6 0v3"/></svg><span className="visually-hidden">All processing is local to this browser</span></span>
      <nav className="legal-links" aria-label="Policies">{(['privacy','cookies','terms'] as const).map(page=><button key={page} type="button" onClick={event=>{cancelAllGestures();legalOpener.current=event.currentTarget;setLegalPage(page);}}>{page==='privacy'?'Privacy':page==='cookies'?'Cookies':'Terms'}</button>)}</nav>
      <div className="session-footer__right"><span className={(message.startsWith('Loaded ')&&!message.startsWith('Loaded “'))||message==='Tracks added to Library.'||message.startsWith('Unloaded ')||message==='Try a mix with the demo tracks, or add your own.'?'is-quiet-status':undefined} role="status" aria-live="polite" title={message}>{message}</span></div>
    </footer>
    {legalPage&&<LegalPanel key={legalPage} page={legalPage} onClose={()=>{setLegalPage(null);requestAnimationFrame(()=>legalOpener.current?.focus({preventScroll:true}));}} />}
    <dialog ref={helpDialog} className="help-dialog" aria-labelledby="shortcut-title" onCancel={event => { event.preventDefault(); setHelpOpen(false); }}
      onClose={() => { if (helpOpen) setHelpOpen(false); }} onClick={event => { if (event.target === event.currentTarget) setHelpOpen(false); }} onKeyDown={dialogTab}>
      <div className="help-dialog__head"><div><span className="library-panel__eyebrow">{helpPage==='First mix'?'Learn by doing':'Quick reference'}</span><h2 id="shortcut-title">{helpPage==='First mix'?'Your first mix':'Keyboard shortcuts'}</h2></div>
        <button ref={closeHelpButton} type="button" aria-label="Close help" onClick={() => setHelpOpen(false)}>Close</button></div>
      <nav className="help-pages" aria-label="Help topics">{['First mix','Controls','Shortcuts','Local audio'].map(topic=><button key={topic} type="button" aria-pressed={helpPage===topic} onClick={()=>setHelpPage(topic)}>{topic}</button>)}</nav>
      <div hidden={helpPage!=='Shortcuts'}><dl className="shortcut-list"><div><dt><kbd>Space</kbd></dt><dd>Play or pause the focused deck</dd></div>
        <div><dt><kbd>Q</kbd></dt><dd>Return to that deck’s cue point</dd></div>
        <div><dt><kbd>1</kbd>–<kbd>8</kbd></dt><dd>Set or trigger hot cues on the focused deck</dd></div>
        <div><dt><kbd>Shift</kbd> + <kbd>←</kbd>/<kbd>→</kbd></dt><dd>Nudge tempo briefly</dd></div>
        <div><dt><kbd>[</kbd>/<kbd>]</kbd></dt><dd>Move the crossfader toward Deck A or B</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>Open this shortcut reference</dd></div></dl>
      <p>Use Tab to focus a deck panel first. Shortcuts pause while you type or focus an interactive control.</p></div>
      <div hidden={helpPage!=='First mix'}><GuidedMixMissions key={mixPair} snapshot={snapshot} completedTransitions={completedTransitions} run={run} loadDemos={loadEmptyDemoDecks} onOpenBpm={openTrackBpm} onNewRound={()=>setTransitionProgress({pair:mixPair,count:0})} onOpenCanvas={()=>{setHelpOpen(false);requestAnimationFrame(()=>{const toggle=document.querySelector<HTMLButtonElement>('[aria-label="Transition canvas"]');if(toggle?.getAttribute('aria-pressed')==='false')toggle.click();document.querySelector<HTMLButtonElement>('[aria-label="Draw your transition"]')?.focus({preventScroll:true});});}}/></div>
      <div hidden={helpPage!=='Controls'}><p>Turn a record to scratch; release to return to its previous playback mode. Hold Cue to preview from a paused cue point.</p><p>Choose Echo, Room, Flanger, Tremolo or Drive in Effects. Hold and move on the pad to shape the sound. The pin keeps it on.</p><p>Drag knobs vertically. Hold Shift for fine adjustment; double-click a continuous control to restore its default. Tempo changes speed. Tone lets you lower or raise the pitch separately.</p></div>
      <div hidden={helpPage!=='Local audio'}><p>Tracks and analysis stay in this browser session. Add or drop MP3, WAV or FLAC files. Reloading clears the session.</p><p>Audio starts after your first interaction. Suspend pauses the audio context; Resume restores it. A closed context requires a reload.</p></div>
    </dialog>
    </main>
  </>;
}
