import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeckGraph } from '../../src/audio/audio-graph';
class Param {
    value = 0;
    cancelAndHoldAtTime() { }
    cancelScheduledValues() { }
    setValueAtTime(value: number) { this.value = value; }
    linearRampToValueAtTime(value: number) { this.value = value; }
}
class Node {
    edges = new Set<Node>();
    gain = new Param();
    frequency = new Param();
    Q = new Param();
    delayTime = new Param();
    type = '';
    normalize = true;
    buffer: unknown = null;
    curve: unknown = null;
    oversample = 'none';
    started = false;
    stopped = false;
    start() { this.started = true; }
    stop() { this.stopped = true; }
    connect(target: Node) { this.edges.add(target); return target; }
    disconnect(target?: Node) {
        if (target)
            this.edges.delete(target);
        else
            this.edges.clear();
    }
}
function nativeStub() {
    const nodes: Node[] = [];
    let convolverFailure = false;
    const create = () => { const node = new Node(); nodes.push(node); return node; };
    const context = { sampleRate: 48000, currentTime: 0, state: 'running', createGain: create, createBiquadFilter: create, createDelay: create, createOscillator: create, createWaveShaper: create, createConvolver: () => {
            if (convolverFailure)
                throw Error('native convolver construction failed');
            return create();
        }, createBuffer: (channels: number, frames: number) => { const data = Array.from({ length: channels }, () => new Float32Array(frames)); return { getChannelData: (i: number) => data[i], numberOfChannels: channels, length: frames, sampleRate: 48000 }; } };
    return { context: context as unknown as BaseAudioContext, nodes, failConvolver: () => { convolverFailure = true; } };
}
afterEach(() => vi.useRealTimers());
describe('native FX ownership and failure cleanup', () => {
    it('keeps toggle/parameter updates on the same graph and retires native histories on reset', async () => {
        vi.useFakeTimers();
        const stub = nativeStub();
        const strip = createDeckGraph(stub.context, 'A');
        expect(strip.setFx).toBeTypeOf('function');
        expect(strip.resetFx).toBeTypeOf('function');
        const baseline = strip.nodeCount;
        const created = stub.nodes.length;
        for (let i = 0; i < 10; i++)
            strip.setFx({ type: 'delay', enabled: i % 2 === 0, wet: .22, feedback: .35, division: .5 });
        expect(stub.nodes.length).toBe(created);
        expect(strip.nodeCount).toBe(baseline);
        const old = stub.nodes.slice();
        const reset = strip.resetFx();
        expect(strip.resetFx()).toBe(reset);
        await vi.runAllTimersAsync();
        await reset;
        expect(strip.nodeCount).toBe(baseline);
        expect(old.filter(node => node.delayTime.value > 0).every(node => node.edges.size === 0)).toBe(true);
        strip.dispose();
        expect(strip.nodeCount).toBe(0);
        expect(stub.nodes.every(node => node.edges.size === 0)).toBe(true);
        expect(stub.nodes.filter(node => node.started).every(node => node.stopped)).toBe(true);
    });
    it('cleans partially created native nodes when initial FX construction fails', () => {
        const stub = nativeStub();
        stub.failConvolver();
        expect(() => createDeckGraph(stub.context, 'B')).toThrow(/convolver/);
        expect(stub.nodes.length).toBeGreaterThan(0);
        expect(stub.nodes.every(node => node.edges.size === 0)).toBe(true);
    });
    it('settles pending reset and removes nodes when disposed during the tail fade', async () => {
        vi.useFakeTimers();
        const stub = nativeStub();
        const strip = createDeckGraph(stub.context, 'A');
        const reset = strip.resetFx();
        strip.dispose();
        await reset;
        await vi.runAllTimersAsync();
        expect(strip.nodeCount).toBe(0);
        expect(stub.nodes.every(node => node.edges.size === 0)).toBe(true);
    });
    it('preserves the current graph when a replacement native FX node fails', () => {
        const stub = nativeStub();
        const strip = createDeckGraph(stub.context, 'A');
        strip.setFx({ type: 'delay', enabled: true, wet: .3, feedback: .4, division: 1 });
        const baseline = strip.nodeCount, old = stub.nodes.slice();
        const values = old.map(node => node.gain.value);
        stub.failConvolver();
        expect(() => strip.resetFx()).toThrow(/convolver/);
        expect(strip.nodeCount).toBe(baseline);
        expect(old.map(node => node.gain.value)).toEqual(values);
        expect(stub.nodes.slice(old.length).every(node => node.edges.size === 0)).toBe(true);
        strip.dispose();
        expect(stub.nodes.every(node => node.edges.size === 0)).toBe(true);
    });
    it('rejects unsafe FX values before changing an existing effect', () => {
        const stub = nativeStub(), strip = createDeckGraph(stub.context, 'A');
        strip.setFx({ type: 'delay', enabled: true, wet: .25, feedback: .35, division: .5 });
        const values = stub.nodes.map(node => [node.gain.value, node.delayTime.value]);
        expect(() => strip.setFx({ type: 'delay', enabled: true, wet: .51, feedback: .35, division: .5 })).toThrow();
        expect(() => strip.setFx({ type: 'delay', enabled: true, wet: .25, feedback: .61, division: .5 })).toThrow();
        expect(() => strip.setFx({ type: 'reverb', enabled: true, wet: NaN })).toThrow();
        expect(stub.nodes.map(node => [node.gain.value, node.delayTime.value])).toEqual(values);
        strip.dispose();
    });
    it('taps headphone cue after EQ, filter and FX but before the channel fader', async () => {
        vi.useFakeTimers();
        const stub = nativeStub(), strip = createDeckGraph(stub.context, 'A');
        const reaches = (from: Node, to: Node): boolean => { const seen = new Set<Node>(), queue = [from]; while (queue.length) { const node = queue.shift()!; if (node === to) return true; if (seen.has(node)) continue; seen.add(node); queue.push(...node.edges); } return false; };
        const input = strip.input as unknown as Node, preFader = strip.preFader as unknown as Node, output = strip.output as unknown as Node;
        expect(reaches(input, preFader)).toBe(true);
        expect([...preFader.edges]).toHaveLength(1);
        const volume = [...preFader.edges][0];
        expect([...volume.edges]).toEqual([output]);
        strip.setVolume(0);
        expect(volume.gain.value).toBe(0);
        expect(preFader.gain.value).toBe(1);
        const reset = strip.resetFx();
        await vi.advanceTimersByTimeAsync(25);
        await reset;
        expect(reaches(input, preFader)).toBe(true);
        strip.dispose();
    });
});
