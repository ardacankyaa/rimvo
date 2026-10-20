import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ initializeFromGesture: vi.fn(async () => ({})), loadDeck: vi.fn<(deck: string, file: File, options?: {signal: AbortSignal}) => Promise<{durationSeconds: number}>>(async () => ({ durationSeconds: 8 })), setBeatGrid: vi.fn() }));
const analysisMocks=vi.hoisted(()=>({analyzeFile:vi.fn(async(file:File,signal?:AbortSignal)=>{void file;void signal;return {durationSeconds:8,bpmAnalysis:{status:'complete' as const,confidence:.65,candidates:[{bpm:126,confidence:.65,firstBeatSeconds:.1}]}};}),getDiagnostics:vi.fn(()=>({pendingDecodeCount:0})),subscribe:vi.fn<(notify:()=>void)=>()=>void>(()=>()=>undefined),getSnapshot:vi.fn(()=>({decks:{A:{bpmAnalysis:{status:'unavailable',candidates:[]}},B:{bpmAnalysis:{status:'unavailable',candidates:[]}}}}))}));
vi.mock('../../src/state/engine', () => ({ engine: {...mocks,...analysisMocks} }));
const modules = import.meta.glob('../../src/library/library.ts');
type Api = {
    getLibrarySnapshot(): readonly {
        id: string;
        title: string;
        source: string;
        file: File | null;
        durationSeconds: number | null;
        bpm: number | null;
        bpmStatus?:string;
    }[];
    addLocalFiles(files: readonly File[]): Promise<void>;
    findLibraryTrackForFile(file: Blob, name: string, lastModified: number): Promise<{ id: string } | undefined>;
    removeLibraryTrack(id: string): void;
    loadLibraryTrack(id: string, deck: 'A' | 'B'): Promise<void>;
    ensureDemoTracks(): void;
    updateLibraryTrack(id:string,values:{bpm?:number|null;bpmStatus?:'complete'|'unavailable';bpmEstimated?:boolean}):void;
    disposeLibrary(): void;
    subscribeLibrary(fn: () => void): () => void;
};
async function api() { const load = Object.values(modules)[0]; expect(load, 'local library module exists').toBeTypeOf('function'); return await load() as Api; }
beforeEach(() => { vi.clearAllMocks();analysisMocks.getDiagnostics.mockReturnValue({pendingDecodeCount:0});analysisMocks.subscribe.mockImplementation(()=>()=>undefined); });
describe('local-first session library', () => {
    it('clears manually published BPM without retaining a false analyzed number',async()=>{
        const a=await api();a.disposeLibrary();a.ensureDemoTracks();const id=a.getLibrarySnapshot()[0].id;
        a.updateLibraryTrack(id,{bpm:120,bpmStatus:'complete',bpmEstimated:false});expect(a.getLibrarySnapshot()[0]).toMatchObject({bpm:120,bpmStatus:'complete'});
        a.updateLibraryTrack(id,{bpm:null,bpmStatus:'unavailable'});expect(a.getLibrarySnapshot()[0]).toMatchObject({bpm:null,bpmStatus:'unavailable',bpmEstimated:false});
        a.updateLibraryTrack(id,{bpm:NaN});expect(a.getLibrarySnapshot()[0].bpm).toBeNull();a.disposeLibrary();
    });
    it('waits for foreground loads with one stable subscription and never loops inside live notifications',async()=>{
        const a=await api();a.disposeLibrary();const listeners=new Set<()=>void>();let busy=true;
        analysisMocks.getDiagnostics.mockImplementation(()=>({pendingDecodeCount:busy?1:0}));analysisMocks.subscribe.mockImplementation(notify=>{listeners.add(notify);return()=>{listeners.delete(notify);};});
        await a.addLocalFiles([new File(['RIFF'],'queued.wav')]);expect(analysisMocks.analyzeFile).not.toHaveBeenCalled();
        for(let update=0;update<3;update++){let calls=0;for(const notify of listeners){if(++calls>2)throw new Error('Notification subscription loop');notify();}}
        expect(analysisMocks.subscribe).toHaveBeenCalledOnce();busy=false;for(const notify of listeners)notify();await vi.waitFor(()=>expect(a.getLibrarySnapshot()[0].bpm).toBe(126));expect(listeners.size).toBe(0);a.disposeLibrary();
    });
    it('still analyzes accepted files if a later file in the batch is rejected',async()=>{const a=await api();a.disposeLibrary();await expect(a.addLocalFiles([new File(['RIFF'],'accepted.wav'),new File(['bad'],'wrong.txt')])).rejects.toThrow('Choose local MP3');await vi.waitFor(()=>expect(a.getLibrarySnapshot()[0].bpm).toBe(126));expect(a.getLibrarySnapshot()).toHaveLength(1);a.disposeLibrary();});
    it('finds BPM after adding a file without installing either deck',async()=>{const a=await api();a.disposeLibrary();await a.addLocalFiles([new File(['RIFF'],'library-only.wav')]);await vi.waitFor(()=>expect(a.getLibrarySnapshot()[0].bpm).toBe(126));expect(a.getLibrarySnapshot()[0].bpmStatus).toBe('complete');expect(mocks.loadDeck).not.toHaveBeenCalled();a.disposeLibrary();});
    it('aborts a removed file analysis and never resurrects its entry',async()=>{const a=await api();a.disposeLibrary();let finish!:(value:Awaited<ReturnType<typeof analysisMocks.analyzeFile>>)=>void;analysisMocks.analyzeFile.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await a.addLocalFiles([new File(['RIFF'],'removed.wav')]);await vi.waitFor(()=>expect(analysisMocks.analyzeFile).toHaveBeenCalledOnce());const signal=analysisMocks.analyzeFile.mock.calls[0][1]!;a.removeLibraryTrack(a.getLibrarySnapshot()[0].id);expect(signal.aborted).toBe(true);finish({durationSeconds:8,bpmAnalysis:{status:'complete',confidence:.65,candidates:[{bpm:126,confidence:.65,firstBeatSeconds:0}]}});await Promise.resolve();await Promise.resolve();expect(a.getLibrarySnapshot()).toHaveLength(0);a.disposeLibrary();});
    it('deduplicates local files, publishes cached snapshots, and removes session references', async () => { const a = await api(); a.disposeLibrary(); const notify = vi.fn(); const off = a.subscribeLibrary(notify); const file = new File(['RIFF'], 'session.wav', { lastModified: 1 }); await a.addLocalFiles([file, file]); expect(a.getLibrarySnapshot()).toHaveLength(1); expect(a.getLibrarySnapshot()).toBe(a.getLibrarySnapshot()); expect(notify).toHaveBeenCalled(); a.removeLibraryTrack(a.getLibrarySnapshot()[0].id); expect(a.getLibrarySnapshot()).toHaveLength(0); off(); a.disposeLibrary(); });
    it('serializes concurrent additions of the same local file', async () => { const a = await api(); a.disposeLibrary(); const file = new File(['RIFF'], 'same.wav', { lastModified: 1 }); await Promise.all([a.addLocalFiles([file]), a.addLocalFiles([file])]); expect(a.getLibrarySnapshot()).toHaveLength(1); a.disposeLibrary(); });
    it('keeps same-metadata files with different bytes separate and loads the chosen file into each deck', async () => {
        const a = await api(); a.disposeLibrary();
        const firstBytes = new Uint8Array(20_000).fill(65);
        const secondBytes = new Uint8Array(firstBytes);
        secondBytes[7000] = 66;
        const first = new File([firstBytes], 'same.wav', { lastModified: 1 });
        const second = new File([secondBytes], 'same.wav', { lastModified: 1 });
        await a.addLocalFiles([first, second]);
        const tracks = a.getLibrarySnapshot();
        expect(tracks).toHaveLength(2);
        const restored = await a.findLibraryTrackForFile(new Blob([secondBytes]), 'same.wav', 1);
        expect(restored?.id).toBe(tracks[1].id);
        await a.loadLibraryTrack(tracks[0].id, 'A');
        await a.loadLibraryTrack(tracks[1].id, 'B');
        expect(mocks.loadDeck.mock.calls.map(([deck, file]) => [deck, file])).toEqual([['A', first], ['B', second]]);
        await a.addLocalFiles([new File([firstBytes], 'same.wav', { lastModified: 1 })]);
        expect(a.getLibrarySnapshot()).toHaveLength(2);
        a.disposeLibrary();
    });
    it('loads through the public engine API and updates known duration', async () => { const a = await api(); a.disposeLibrary(); await a.addLocalFiles([new File(['RIFF'], 'session.wav')]); const id = a.getLibrarySnapshot()[0].id; await a.loadLibraryTrack(id, 'B'); expect(mocks.initializeFromGesture).toHaveBeenCalledOnce(); expect(mocks.loadDeck).toHaveBeenCalledWith('B', expect.any(File), { signal: expect.any(AbortSignal) }); expect(a.getLibrarySnapshot()[0].durationSeconds).toBe(8); a.disposeLibrary(); });
    it('prevents an earlier slow demo fetch from replacing a newer local selection', async () => {
        const a = await api();
        a.disposeLibrary();
        a.ensureDemoTracks();
        await a.addLocalFiles([new File(['RIFF'], 'new.wav')]);
        let resolveFetch!: (response: Response) => void;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));
        const earlier = a.loadLibraryTrack('demo-after-hours', 'A').catch(error => error);
        await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
        const local = a.getLibrarySnapshot().find(t => t.source === 'local')!;
        await a.loadLibraryTrack(local.id, 'A');
        resolveFetch(new Response(new Uint8Array([82, 73, 70, 70])));
        expect((await earlier).name).toBe('AbortError');
        expect(mocks.loadDeck).toHaveBeenCalledTimes(1);
        expect(mocks.setBeatGrid).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
        a.disposeLibrary();
    });
    it.each(['remove', 'dispose'] as const)('cancels a pending demo on %s without decoding its response', async (action) => {
        const a = await api();
        a.disposeLibrary();
        a.ensureDemoTracks();
        let resolveFetch!: (response: Response) => void;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));
        const pending = a.loadLibraryTrack('demo-after-hours', 'A').catch(error => error);
        await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
        if (action === 'remove')
            a.removeLibraryTrack('demo-after-hours');
        else
            a.disposeLibrary();
        resolveFetch(new Response(new Uint8Array([82, 73, 70, 70])));
        expect((await pending).name).toBe('AbortError');
        expect(mocks.loadDeck).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
        a.disposeLibrary();
    });
    it('keeps pending load intents independent between decks', async () => {
        const a = await api();
        a.disposeLibrary();
        a.ensureDemoTracks();
        await a.addLocalFiles([new File(['RIFF'], 'other.wav')]);
        let resolveFetch!: (response: Response) => void;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));
        const pending = a.loadLibraryTrack('demo-after-hours', 'A');
        await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
        await a.loadLibraryTrack(a.getLibrarySnapshot().find(t => t.source === 'local')!.id, 'B');
        resolveFetch(new Response(new Uint8Array([82, 73, 70, 70])));
        await pending;
        expect(mocks.loadDeck.mock.calls.map(call => call[0])).toEqual(['B', 'A']);
        expect(mocks.setBeatGrid).toHaveBeenCalledWith('A', { bpm: 118, firstBeatSeconds: 0 });
        fetchSpy.mockRestore();
        a.disposeLibrary();
    });
    it('revokes embedded artwork URLs on remove and disposal', async () => { const a = await api(); a.disposeLibrary(); const created = vi.spyOn(URL, 'createObjectURL'); const revoked = vi.spyOn(URL, 'revokeObjectURL'); const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0], data = [0, ...Array.from('image/png', c => c.charCodeAt(0)), 0, 3, 0, ...png], frame = [65, 80, 73, 67, 0, 0, 0, data.length, 0, 0, ...data], bytes = new Uint8Array([73, 68, 51, 3, 0, 0, 0, 0, 0, frame.length, ...frame]); await a.addLocalFiles([new File([bytes], 'cover.mp3')]); expect(created).toHaveBeenCalledTimes(1); a.removeLibraryTrack(a.getLibrarySnapshot()[0].id); expect(revoked).toHaveBeenCalledWith(created.mock.results[0].value); await a.addLocalFiles([new File([bytes], 'cover-again.mp3')]); a.disposeLibrary(); expect(revoked).toHaveBeenCalledTimes(2); created.mockRestore(); revoked.mockRestore(); });
    it('registers lazy local demo metadata once with no media fetch', async () => { const a = await api(); a.disposeLibrary(); const fetchSpy = vi.spyOn(globalThis, 'fetch'); a.ensureDemoTracks(); a.ensureDemoTracks(); expect(a.getLibrarySnapshot()).toHaveLength(2); expect(a.getLibrarySnapshot().every(t => t.source === 'demo' && t.bpm !== null && t.durationSeconds !== null)).toBe(true); expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); a.disposeLibrary(); });
});
