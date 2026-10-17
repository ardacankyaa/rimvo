import { createPerformanceFx } from './performance-fx';
import transportWorkletUrl from './transport-processor.ts?worker&url';
import limiterWorkletUrl from './limiter-processor.ts?worker&url';
import pitchWorkletUrl from './pitch-processor.ts?worker&url';
import { clampFinite, dbToGain, equalPowerCrossfaderGains, crossfaderGains, filterCutoffForValue } from '../dsp/curves';
import type { AudioEngine, CrossfaderCurve, DeckId, EqBand } from './types';
export type DeckFxSetting = Parameters<AudioEngine['setFx']>[1];
export interface DeckAudioStrip {
    readonly id: DeckId;
    readonly input: GainNode;
    readonly output: GainNode;
    readonly nodeCount: number;
    setGainDb(value: number): void;
    setEqDb(band: EqBand, value: number): void;
    setFilter(value: number): void;
    setVolume(value: number): void;
    setFx(setting: DeckFxSetting): void;
    setEffectiveBpm(bpm: number): void;
    resetFx(): Promise<void>;
    dispose(): void;
}
export interface AudioMixerGraph {
    readonly input: GainNode;
    readonly output: AudioNode;
    setCrossfader(value: number): void;
    setCrossfaderCurve(curve: CrossfaderCurve): void;
    setMasterVolume(value: number): void;
}
export interface AudioGraph {
    readonly pitch: Readonly<Record<DeckId, {
        node: AudioWorkletNode;
        set(semitones: number, sourceRate: number, independent: boolean): void;
        reset(): void;
        readonly underruns: number;
    }>>;
    readonly decks: Readonly<Record<DeckId, DeckAudioStrip>>;
    readonly transport: AudioWorkletNode;
    readonly limiter: AudioWorkletNode;
    readonly mixer: AudioMixerGraph;
    readonly output: AudioWorkletNode;
    readonly diagnostics: Readonly<{
        nodeCount: number;
        activePortCount: number;
        connectedNodeCount: number;
    }>;
    dispose(): void;
}
function smooth(param: AudioParam, value: number, context: BaseAudioContext, seconds = 0.008): void {
    const now = context.currentTime;
    const held = param.value;
    try {
        param.cancelAndHoldAtTime(now);
    }
    catch {
        param.cancelScheduledValues(now);
    }
    param.setValueAtTime(held, now);
    param.linearRampToValueAtTime(value, now + seconds);
}
function bounded(value: number, min: number, max: number, label: string): number {
    if (!Number.isFinite(value) || value < min || value > max)
        throw new RangeError(label + ' is outside its supported range.');
    return value;
}
/** Generated once per strip; no remote impulse response or worklet-side allocation. */
function createRoomImpulse(context: BaseAudioContext, id: DeckId): AudioBuffer {
    const length = Math.max(1, Math.round(context.sampleRate * 1.2));
    const impulse = context.createBuffer(2, length, context.sampleRate);
    let seed = id === 'A' ? 173 : 431;
    for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let frame = 0; frame < length; frame++) {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            const noise = (seed >>> 0) / 4294967296 * 2 - 1;
            const time = frame / context.sampleRate;
            data[frame] = time < .012 ? 0 : noise * Math.exp(-time * 7.5) * .025;
        }
        for (const [time, amplitude] of [[.018, .12], [.041, .09], [.073, .06], [.11, .035]]) {
            const frame = Math.round((time + channel * .0017) * context.sampleRate);
            if (frame < length)
                data[frame] += amplitude;
        }
    }
    return impulse;
}
export function createDeckGraph(context: BaseAudioContext, id: DeckId): DeckAudioStrip {
    const nodes = new Set<AudioNode>();
    const own = <T extends AudioNode>(node: T): T => { nodes.add(node); return node; };
    const gain = (): GainNode => own(context.createGain());
    const biquad = (): BiquadFilterNode => own(context.createBiquadFilter());
    let impulse: AudioBuffer | null = null;
    let disposed = false;
    let pendingReset: Promise<void> | null = null;
    let finishReset: (() => void) | null = null;
    const ensureActive = (): void => { if (disposed)
        throw new Error('Deck graph is disposed.'); };
    try {
        const input = gain(), dcSafety = biquad(), trim = gain();
        const low = biquad(), mid = biquad(), high = biquad();
        const dry = gain(), lowPass = biquad(), highPass = biquad();
        const lowPassMix = gain(), highPassMix = gain(), wetSum = gain(), volume = gain(), output = gain();
        dcSafety.type = 'highpass';
        dcSafety.frequency.value = 20;
        dcSafety.Q.value = .707;
        low.type = 'lowshelf';
        low.frequency.value = 200;
        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.Q.value = .707;
        high.type = 'highshelf';
        high.frequency.value = 4000;
        lowPass.type = 'lowpass';
        lowPass.Q.value = .707;
        highPass.type = 'highpass';
        highPass.Q.value = .707;
        lowPass.frequency.value = filterCutoffForValue(-1, context.sampleRate);
        highPass.frequency.value = filterCutoffForValue(1, context.sampleRate);
        dry.gain.value = 1;
        lowPassMix.gain.value = 0;
        highPassMix.gain.value = 0;
        trim.gain.value = dbToGain(-3);
        volume.gain.value = 1;
        input.connect(dcSafety);
        dcSafety.connect(trim);
        trim.connect(low);
        low.connect(mid);
        mid.connect(high);
        high.connect(dry);
        high.connect(lowPass);
        high.connect(highPass);
        dry.connect(wetSum);
        lowPass.connect(lowPassMix);
        highPass.connect(highPassMix);
        lowPassMix.connect(wetSum);
        highPassMix.connect(wetSum);

        volume.connect(output);
        impulse = createRoomImpulse(context, id);
        let bpm = 120;
        let delaySettings = { enabled: false, wet: .22, feedback: .35, division: .5 as .25 | .5 | 1 };
        type Branch = {
            input: GainNode;
            output: GainNode;
            delaySend: GainNode;
            delay: DelayNode;
            feedback: GainNode;
            delayWet: GainNode;
            reverbSend: GainNode;
            reverb: ConvolverNode;
            reverbWet: GainNode;
            performance: ReturnType<typeof createPerformanceFx>;
            nodes: AudioNode[];
        };
        const delaySeconds = () => Math.max(1 / context.sampleRate, Math.min(2, 60 / bpm * delaySettings.division));
        function createBranch(): Branch {
            const branchNodes: AudioNode[] = [];
            const branchOwn = <T extends AudioNode>(node: T): T => { own(node); branchNodes.push(node); return node; };
            const g = () => branchOwn(context.createGain());
            let branchInput: GainNode | null = null, branchOutput: GainNode | null = null;
            let performance: ReturnType<typeof createPerformanceFx> | null = null;
            try {
                branchInput = g();
                branchOutput = g();
                const delaySend = g(), delay = branchOwn(context.createDelay(2)), feedback = g(), delayWet = g();
                const reverbSend = g(), reverb = branchOwn(context.createConvolver()), reverbWet = g();
                branchInput.gain.value = 1;
                branchOutput.gain.value = 1;
                delaySend.gain.value = 0;
                feedback.gain.value = 0;
                delayWet.gain.value = 0;
                reverbSend.gain.value = 0;
                reverbWet.gain.value = 0;
                delay.delayTime.value = delaySeconds();
                reverb.normalize = true;
                reverb.buffer = impulse;
                performance = createPerformanceFx(context, branchOwn);
                branchInput.connect(performance.input);
                performance.output.connect(branchOutput);
                branchInput.connect(delaySend);
                delaySend.connect(delay);
                delay.connect(feedback);
                feedback.connect(delay);
                delay.connect(delayWet);
                delayWet.connect(performance.input);
                branchInput.connect(reverbSend);
                reverbSend.connect(reverb);
                reverb.connect(reverbWet);
                reverbWet.connect(performance.input);
                wetSum.connect(branchInput);
                branchOutput.connect(volume);
                return { input: branchInput, output: branchOutput, delaySend, delay, feedback, delayWet, reverbSend, reverb, reverbWet, performance, nodes: branchNodes };
            }
            catch (cause) {
                performance?.dispose();
                if (branchInput) {
                    try {
                        wetSum.disconnect(branchInput);
                    }
                    catch { /* Connection may not have been established. */ }
                }
                if (branchOutput) {
                    try {
                        branchOutput.disconnect(volume);
                    }
                    catch { /* Connection may not have been established. */ }
                }
                for (const node of branchNodes) {
                    try {
                        node.disconnect();
                    }
                    catch { /* Native creation rollback. */ }
                    nodes.delete(node);
                }
                throw cause;
            }
        }
        function releaseBranch(branch: Branch): void {
            branch.performance.dispose();
            try {
                wetSum.disconnect(branch.input);
            }
            catch { /* Context may already be closed. */ }
            try {
                branch.output.disconnect(volume);
            }
            catch { /* Context may already be closed. */ }
            try {
                branch.reverb.buffer = null;
            }
            catch { /* Best-effort release during native context teardown. */ }
            for (const node of branch.nodes) {
                try {
                    node.disconnect();
                }
                catch { /* Context may already be closed. */ }
                nodes.delete(node);
            }
        }
        let branch = createBranch();
        return {
            id, input, output,
            get nodeCount() { return disposed ? 0 : nodes.size; },
            setGainDb(value): void { ensureActive(); smooth(trim.gain, dbToGain(clampFinite(value, -24, 12, 'Deck gain')), context); },
            setEqDb(band, value): void { ensureActive(); const db = clampFinite(value, -24, 6, 'EQ gain'); smooth((band === 'low' ? low : band === 'mid' ? mid : high).gain, db, context); },
            setFilter(value): void {
                ensureActive();
                const filterValue = clampFinite(value, -1, 1, 'Filter value');
                const magnitude = Math.abs(filterValue), cutoff = filterCutoffForValue(filterValue, context.sampleRate);
                smooth(lowPass.frequency, cutoff, context);
                smooth(highPass.frequency, cutoff, context);
                smooth(dry.gain, 1 - magnitude, context);
                smooth(lowPassMix.gain, filterValue < 0 ? magnitude : 0, context);
                smooth(highPassMix.gain, filterValue > 0 ? magnitude : 0, context);
            },
            setVolume(value): void { ensureActive(); smooth(volume.gain, clampFinite(value, 0, 1, 'Deck channel volume'), context); },
            setEffectiveBpm(value): void { ensureActive(); bpm = bounded(value, 20, 400, 'Effective BPM'); smooth(branch.delay.delayTime, delaySeconds(), context, .01); },
            setFx(setting): void {
                ensureActive();
                if (typeof setting.enabled !== 'boolean')
                    throw new RangeError('Effect enabled state must be boolean.');
                if (setting.type === 'delay') {
                    const wet = bounded(setting.wet, 0, .5, 'Delay wet'), feedback = bounded(setting.feedback, 0, .6, 'Delay feedback');
                    if (![.25, .5, 1].includes(setting.division))
                        throw new RangeError('Delay division must be 1/4, 1/2 or 1 beat.');
                    delaySettings = { ...setting, wet, feedback };
                    smooth(branch.delay.delayTime, delaySeconds(), context, .01);
                    smooth(branch.delaySend.gain, setting.enabled ? 1 : 0, context);
                    smooth(branch.feedback.gain, setting.enabled ? feedback : 0, context);
                    smooth(branch.delayWet.gain, setting.enabled ? wet : 0, context);
                }
                else if (setting.type === 'reverb') {
                    const wet = bounded(setting.wet, 0, .4, 'Reverb wet');
                    smooth(branch.reverbSend.gain, setting.enabled ? 1 : 0, context);
                    smooth(branch.reverbWet.gain, setting.enabled ? wet : 0, context);
                }
                else branch.performance.set(setting);
            },
            resetFx(): Promise<void> {
                ensureActive();
                if (pendingReset)
                    return pendingReset;
                const previous = branch, fresh = createBranch();
                branch = fresh;
                delaySettings = { ...delaySettings, enabled: false };
                smooth(previous.output.gain, 0, context);
                if (context.state !== 'running') {
                    releaseBranch(previous);
                    return Promise.resolve();
                }
                pendingReset = new Promise<void>(resolve => {
                    let done = false;
                    const finish = () => { if (done)
                        return; done = true; clearTimeout(timer); releaseBranch(previous); finishReset = null; pendingReset = null; resolve(); };
                    const timer = setTimeout(finish, 20);
                    finishReset = finish;
                });
                return pendingReset;
            },
            dispose(): void {
                if (disposed)
                    return;
                disposed = true;
                finishReset?.();
                branch.performance.dispose();
                try {
                    branch.reverb.buffer = null;
                }
                catch { /* Best-effort release during native context teardown. */ }
                impulse = null;
                for (const node of nodes) {
                    try {
                        node.disconnect();
                    }
                    catch { /* Context teardown may have disconnected it. */ }
                }
                nodes.clear();
            },
        };
    }
    catch (cause) {
        impulse = null;
        for (const node of nodes) {
            try {
                node.disconnect();
            }
            catch { /* Partial native graph rollback. */ }
        }
        nodes.clear();
        throw cause;
    }
}
export async function createAudioGraph(context: AudioContext | OfflineAudioContext): Promise<AudioGraph> {
    let deckA: DeckAudioStrip | null = null;
    let deckB: DeckAudioStrip | null = null;
    const createdNodes: AudioNode[] = [];
    let transport: AudioWorkletNode | null = null;
    let limiter: AudioWorkletNode | null = null;
    try {
        if (!context.audioWorklet)
            throw new Error('AudioWorklet is unavailable in this browser.');
        await context.audioWorklet.addModule(transportWorkletUrl);
        await context.audioWorklet.addModule(limiterWorkletUrl);
        await context.audioWorklet.addModule(pitchWorkletUrl);
        if (context.state === 'closed')
            throw new Error('Audio context closed during worklet initialization.');
        deckA = createDeckGraph(context, 'A');
        deckB = createDeckGraph(context, 'B');
        transport = new AudioWorkletNode(context, 'rimvo-dual-transport', {
            numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 2], channelCount: 2,
            channelCountMode: 'explicit', channelInterpretation: 'speakers',
        });
        createdNodes.push(transport);
        const createGain = (): GainNode => { const node = context.createGain(); createdNodes.push(node); return node; };
        const crossA = createGain();
        const crossB = createGain();
        const headroom = createGain();
        const master = createGain();
        const mixerInput = createGain();
        const sum = createGain();
        limiter = new AudioWorkletNode(context, 'rimvo-master-limiter', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
            channelCountMode: 'explicit', channelInterpretation: 'speakers',
        });
        createdNodes.push(limiter);
        const createPitch = (id: DeckId) => {
            const node = new AudioWorkletNode(context, 'rimvo-pitch', {numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
            createdNodes.push(node);
            const ratio=node.parameters.get('pitchRatio')!, enabled=node.parameters.get('independent')!;
            let lastRatio=1,lastIndependent=false,underruns=0;
            node.port.onmessage=(event:MessageEvent<{type:string;underruns?:number}>)=>{
                if(event.data.type==='metrics')underruns=event.data.underruns??0;
                if(event.data.type==='fault')node.dispatchEvent(new Event('processorerror'));
            };
            node.connect(id==='A'?deckA!.input:deckB!.input);
            return {node,
                set(semitones:number,sourceRate:number,independent:boolean){
                    const next=independent?2**(semitones/12)/sourceRate:1;
                    if(next!==lastRatio){smooth(ratio,next,context);lastRatio=next;}
                    if(independent!==lastIndependent){enabled.setValueAtTime(independent?1:0,context.currentTime);lastIndependent=independent;}
                },
                reset(){node.port.postMessage({type:'reset'});},
                get underruns(){return underruns;},
            };
        };
        const pitch={A:createPitch('A'),B:createPitch('B')};
        transport.connect(pitch.A.node, 0, 0);
        transport.connect(pitch.B.node, 1, 0);
        deckA.output.connect(crossA);
        deckB.output.connect(crossB);
        crossA.connect(mixerInput);
        crossB.connect(mixerInput);
        mixerInput.connect(sum);
        sum.connect(headroom);
        headroom.connect(master);
        master.connect(limiter);
        limiter.connect(context.destination);
        const center = equalPowerCrossfaderGains(0.5);
        crossA.gain.value = center.a;
        crossB.gain.value = center.b;
        headroom.gain.value = dbToGain(-6);
        master.gain.value = 1;
        let disposed = false;
        let crossfader = 0.5, curve: CrossfaderCurve = 'mix';
        const applyCrossfader = () => { const gains = crossfaderGains(crossfader, curve); smooth(crossA.gain, gains.a, context, .01); smooth(crossB.gain, gains.b, context, .01); };
        const mixer: AudioMixerGraph = {
            input: mixerInput,
            output: sum,
            setCrossfader(value: number): void {
                if (disposed)
                    throw new Error('Audio graph is disposed.');
                crossfader = clampFinite(value, 0, 1, 'Crossfader');
                applyCrossfader();
            },
            setCrossfaderCurve(value): void { if (disposed)
                throw new Error('Audio graph is disposed.'); if (value !== 'mix' && value !== 'cut')
                throw new RangeError('Unsupported crossfader curve.'); curve = value; applyCrossfader(); },
            setMasterVolume(value: number): void {
                if (disposed)
                    throw new Error('Audio graph is disposed.');
                smooth(master.gain, clampFinite(value, 0, 1, 'Master volume'), context, 0.01);
            },
        };
        const audioGraph: AudioGraph = {
            decks: { A: deckA, B: deckB }, transport, limiter, mixer, output: limiter, pitch,
            get diagnostics() {
                const count = disposed ? 0 : createdNodes.length + deckA!.nodeCount + deckB!.nodeCount;
                return { nodeCount: count, activePortCount: disposed ? 0 : 4, connectedNodeCount: count };
            },
            dispose(): void {
                if (disposed)
                    return;
                disposed = true;
                for(const id of ['A','B'] as const){try{pitch[id].node.port.postMessage({type:'dispose'});}catch{/* Already closed. */}pitch[id].node.port.close();}
                try {
                    transport!.port.postMessage({ type: 'dispose' });
                }
                catch { /* Port may already be closed. */ }
                try {
                    limiter!.port.postMessage({ type: 'dispose' });
                }
                catch { /* Port may already be closed. */ }
                for (const node of createdNodes) {
                    try {
                        node.disconnect();
                    }
                    catch { /* Context teardown may already have disconnected it. */ }
                }
                deckA!.dispose();
                deckB!.dispose();
                transport!.port.close();
                limiter!.port.close();
            },
        };
        return audioGraph;
    }
    catch (cause) {
        for (const node of createdNodes) {
            try {
                node.disconnect();
            }
            catch { /* Best-effort rollback for partial graph creation. */ }
            if (node instanceof AudioWorkletNode) {
                try {
                    node.port.postMessage({type:'dispose'});
                    node.port.close();
                }
                catch { /* Best-effort port cleanup. */ }
            }
        }
        deckA?.dispose();
        deckB?.dispose();
        throw cause;
    }
}
