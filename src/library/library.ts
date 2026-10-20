import demoManifest from './demo-catalog.json';
import type { DeckId } from '../audio/types';
import { engine } from '../state/engine';
import { readTrackMetadata } from './metadata';
export interface LibraryTrack {
    readonly id: string;
    readonly title: string;
    readonly artist: string;
    readonly file: File | null;
    readonly source: 'local' | 'demo';
    readonly artworkUrl: string | null;
    readonly durationSeconds: number | null;
    readonly bpm: number | null;
    readonly bpmStatus?:'queued'|'analyzing'|'complete'|'unavailable'|'error';
    readonly bpmEstimated?:boolean;
    readonly demoUrl?: string;
}
const demos = demoManifest;
let addTail: Promise<void> = Promise.resolve();
const analysisQueue:string[]=[];
let analysisJob:{id:string;controller:AbortController}|null=null;
let idleSubscription:(()=>void)|null=null;
let snapshot: readonly LibraryTrack[] = Object.freeze([]), sequence = 0, epoch = 0;
const listeners = new Set<() => void>(), urls = new Set<string>(), requests = new Set<AbortController>();
const contentSamples = new WeakMap<Blob, Promise<readonly Uint8Array[]>>();
const deckLoads = new Map<DeckId, {
    entryId: string;
    controller: AbortController;
}>();
const base = import.meta.env.BASE_URL;
const publish = (next: readonly LibraryTrack[]) => {
    snapshot = Object.freeze([...next]);
    for (const listener of listeners)
        listener();
};
const sampleRanges = (size: number): readonly (readonly [number, number])[] => {
    const length = Math.min(size, 4096);
    const starts = new Set([0, Math.max(0, Math.floor((size - length) / 2)), Math.max(0, size - length)]);
    return [...starts].map(start => [start, start + length] as const);
};
function getContentSamples(file: Blob): Promise<readonly Uint8Array[]> {
    let samples = contentSamples.get(file);
    if (!samples) {
        samples = Promise.all(sampleRanges(file.size).map(async ([start, end]) => new Uint8Array(await file.slice(start, end).arrayBuffer())));
        contentSamples.set(file, samples);
    }
    return samples;
}
function equalSamples(a: readonly Uint8Array[], b: readonly Uint8Array[]): boolean {
    return a.length === b.length && a.every((sample, index) => {
        const other = b[index];
        if (!other || sample.length !== other.length)
            return false;
        for (let offset = 0; offset < sample.length; offset++)
            if (sample[offset] !== other[offset])
                return false;
        return true;
    });
}
async function sameFileContents(a: Blob, b: Blob): Promise<boolean> {
    if (a === b)
        return true;
    if (a.size !== b.size)
        return false;
    const [aSamples, bSamples] = await Promise.all([getContentSamples(a), getContentSamples(b)]);
    if (!equalSamples(aSamples, bSamples))
        return false;
    const chunkSize = 64 * 1024;
    for (let start = 0; start < a.size; start += chunkSize) {
        const end = Math.min(a.size, start + chunkSize);
        const [left, right] = await Promise.all([a.slice(start, end).arrayBuffer(), b.slice(start, end).arrayBuffer()]);
        const leftBytes = new Uint8Array(left), rightBytes = new Uint8Array(right);
        for (let offset = 0; offset < leftBytes.length; offset++)
            if (leftBytes[offset] !== rightBytes[offset])
                return false;
    }
    return true;
}
async function findMatchingFile(file: Blob, name: string, lastModified: number): Promise<LibraryTrack | undefined> {
    const candidates = snapshot.filter(track => track.file?.name === name && track.file.size === file.size && track.file.lastModified === lastModified);
    for (const track of candidates)
        if (track.file && await sameFileContents(track.file, file))
            return track;
    return undefined;
}
export const getLibrarySnapshot = () => snapshot;
export function findLibraryTrackForFile(file: Blob, name: string, lastModified: number): Promise<LibraryTrack | undefined> {
    return findMatchingFile(file, name, lastModified);
}
export function subscribeLibrary(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function ensureDemoTracks(): void {
    const missing = demos.filter(d => !snapshot.some(t => t.id === d.id)).map(d => Object.freeze({ id: d.id, title: d.title, artist: d.artist, bpm: d.bpm, durationSeconds: d.durationSeconds, file: null, source: 'demo' as const, artworkUrl: base + 'demo-tracks/' + d.artwork, demoUrl: base + 'demo-tracks/' + d.asset }));
    if (missing.length)
        publish([...snapshot, ...missing]);
}
export function updateLibraryTrack(id: string, values: {
    durationSeconds?: number;
    bpm?: number | null;
    bpmStatus?: LibraryTrack['bpmStatus'];
    bpmEstimated?: boolean;
}): void {
    const i = snapshot.findIndex(t => t.id === id);
    if (i < 0)
        return;
    const entry = snapshot[i];
    const durationSeconds = values.durationSeconds !== undefined && Number.isFinite(values.durationSeconds) && values.durationSeconds > 0 ? values.durationSeconds : entry.durationSeconds;
    const bpm = values.bpm === null ? null : values.bpm !== undefined && Number.isFinite(values.bpm) && values.bpm > 0 ? values.bpm : entry.bpm;
    const bpmStatus=values.bpmStatus??entry.bpmStatus;
    const bpmEstimated=values.bpmEstimated??(bpm===null?false:entry.bpmEstimated);
    if (durationSeconds === entry.durationSeconds && bpm === entry.bpm && bpmStatus===entry.bpmStatus && bpmEstimated===entry.bpmEstimated)
        return;
    const next = [...snapshot];
    next[i] = Object.freeze({ ...entry, durationSeconds, bpm, bpmStatus, bpmEstimated });
    publish(next);
}
function setAnalysis(id:string,values:Partial<Pick<LibraryTrack,'bpm'|'bpmStatus'|'bpmEstimated'|'durationSeconds'>>):void {
    publish(snapshot.map(track=>track.id===id?Object.freeze({...track,...values}):track));
}
function analyzeNext():void {
    if(analysisJob)return;
    if(!analysisQueue.length){idleSubscription?.();idleSubscription=null;return;}
    if(engine.getDiagnostics().pendingDecodeCount){if(!idleSubscription)idleSubscription=engine.subscribe(()=>analyzeNext());return;}
    idleSubscription?.();idleSubscription=null;
    const id=analysisQueue.shift()!,entry=snapshot.find(track=>track.id===id);
    if(!entry?.file){analyzeNext();return;}
    const job={id,controller:new AbortController()};analysisJob=job;
    setAnalysis(id,{bpmStatus:'analyzing'});
    void engine.analyzeFile(entry.file,job.controller.signal).then(result=>{
        if(job.controller.signal.aborted||analysisJob!==job)return;
        const candidate=result.bpmAnalysis.candidates[0];
        setAnalysis(id,{durationSeconds:result.durationSeconds,bpm:candidate?.bpm??entry.bpm,bpmStatus:candidate||entry.bpm?'complete':'unavailable',bpmEstimated:!!candidate&&candidate.confidence<.75});
    }).catch(()=>{if(!job.controller.signal.aborted&&analysisJob===job)setAnalysis(id,{bpmStatus:'error'});}).finally(()=>{if(analysisJob===job){analysisJob=null;analyzeNext();}});
}
export async function retryLibraryAnalysis(id:string):Promise<void>{
    await engine.initializeFromGesture();
    if(!snapshot.some(track=>track.id===id&&track.file)||analysisJob?.id===id||analysisQueue.includes(id))return;
    setAnalysis(id,{bpmStatus:'queued'});analysisQueue.push(id);analyzeNext();
}
async function addBatch(files: readonly File[], generation: number, analyze:boolean): Promise<void> {
    if (generation !== epoch)
        return;
    if (files.length > 32)
        throw new Error('Add up to 32 tracks at a time.');
    for (const file of files) {
        if (!/\.(mp3|wav|flac)$/i.test(file.name) && !['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/x-flac'].includes(file.type))
            throw new Error('Choose local MP3, WAV or FLAC tracks.');
        if (file.size === 0 || file.size > 128 * 1024 * 1024)
            throw new Error('Choose a non-empty track below 128 MiB.');
        if (await findMatchingFile(file, file.name, file.lastModified))
            continue;
        if (snapshot.length >= 200)
            throw new Error('This session holds up to 200 tracks.');
        const id = 'local-' + ++sequence;
        const metadata = await readTrackMetadata(file);
        if (generation !== epoch)
            return;
        let artworkUrl: string | null = null;
        if (metadata.artwork) {
            artworkUrl = URL.createObjectURL(metadata.artwork);
            urls.add(artworkUrl);
        }
        publish([...snapshot, Object.freeze({ id, title: metadata.title, artist: metadata.artist, file, source: 'local' as const, artworkUrl, durationSeconds: metadata.durationSeconds ?? null, bpm: metadata.bpm ?? null,bpmStatus:analyze?'queued' as const:undefined })]);
        if(analyze)analysisQueue.push(id);
    }
}
export function addLocalFiles(files: readonly File[],options:{analyze?:boolean}={}): Promise<void> { const generation = epoch; const operation = addTail.then(() => addBatch(files, generation,options.analyze!==false)).finally(()=>{if(options.analyze!==false)analyzeNext();}); addTail = operation.then(() => undefined, () => undefined); return operation; }
export function removeLibraryTrack(id: string): void {
    const queued=analysisQueue.indexOf(id);if(queued>=0)analysisQueue.splice(queued,1);
    if(analysisJob?.id===id)analysisJob.controller.abort();
    for (const load of deckLoads.values())
        if (load.entryId === id)
            load.controller.abort();
    const t = snapshot.find(entry => entry.id === id);
    if (t?.artworkUrl && urls.delete(t.artworkUrl))
        URL.revokeObjectURL(t.artworkUrl);
    publish(snapshot.filter(entry => entry.id !== id));
    analyzeNext();
}
export async function loadLibraryTrack(id: string, deckId: DeckId): Promise<void> {
    const entry = snapshot.find(t => t.id === id);
    if (!entry)
        throw new Error('Choose a track from this session.');
    const queued=analysisQueue.indexOf(id);if(queued>=0)analysisQueue.splice(queued,1);
    if(analysisJob?.id===id)analysisJob.controller.abort();
    deckLoads.get(deckId)?.controller.abort();
    if(entry.source==='local')setAnalysis(id,{bpmStatus:'analyzing'});
    const controller = new AbortController(), generation = epoch;
    deckLoads.set(deckId, { entryId: id, controller });
    requests.add(controller);
    const assertCurrent = () => {
        if (controller.signal.aborted || generation !== epoch || deckLoads.get(deckId)?.controller !== controller)
            throw new DOMException('This library load was superseded or cancelled.', 'AbortError');
    };
    try {
        await engine.initializeFromGesture();
        assertCurrent();
        let file = entry.file;
        if (!file) {
            const response = await fetch(entry.demoUrl!, { signal: controller.signal });
            assertCurrent();
            if (!response.ok)
                throw new Error('The local demo could not be loaded.');
            const blob = await response.blob();
            assertCurrent();
            file = new File([blob], entry.demoUrl!.split('/').at(-1)!, { type: 'audio/wav' });
        }
        const track = await engine.loadDeck(deckId, file, { signal: controller.signal });
        assertCurrent();
        updateLibraryTrack(id, { durationSeconds: track.durationSeconds });
        const result=engine.getSnapshot().decks[deckId].bpmAnalysis,candidate=result.candidates[0];
        if(entry.source==='local')setAnalysis(id,{bpm:candidate?.bpm??entry.bpm,bpmStatus:candidate||entry.bpm?'complete':'unavailable',bpmEstimated:!!candidate&&candidate.confidence<.75});
        if (entry.source === 'demo' && entry.bpm)
            engine.setBeatGrid(deckId, { bpm: entry.bpm, firstBeatSeconds: 0 });
    }
    catch(cause){
        if(entry.source==='local'&&snapshot.some(track=>track.id===id)&&snapshot.find(track=>track.id===id)?.bpmStatus==='analyzing'){
            if(controller.signal.aborted){setAnalysis(id,{bpmStatus:'queued'});if(!analysisQueue.includes(id))analysisQueue.push(id);analyzeNext();}
            else setAnalysis(id,{bpmStatus:'error'});
        }
        throw cause;
    }
    finally {
        requests.delete(controller);
        if (deckLoads.get(deckId)?.controller === controller)
            deckLoads.delete(deckId);
    }
}
export function disposeLibrary(): void {
    epoch++;
    analysisQueue.length=0;analysisJob?.controller.abort();analysisJob=null;idleSubscription?.();idleSubscription=null;
    for (const r of requests)
        r.abort();
    requests.clear();
    deckLoads.clear();
    for (const url of urls)
        URL.revokeObjectURL(url);
    urls.clear();
    publish([]);
    listeners.clear();
}
const onPageHide = (event: PageTransitionEvent) => {
    if (!event.persisted)
        disposeLibrary();
};
if (typeof window !== 'undefined')
    window.addEventListener('pagehide', onPageHide);
if (import.meta.hot)
    import.meta.hot.dispose(() => { window.removeEventListener('pagehide', onPageHide); disposeLibrary(); });
