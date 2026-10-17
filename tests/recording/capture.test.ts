import { describe, expect, it } from 'vitest';
import { StereoCaptureKernel } from '../../src/recording/capture-kernel';
import { encodeRecordingWav } from '../../src/recording/wav';
import type { CaptureMessage } from '../../src/recording/types';
import { DualDeckTransportKernel } from '../../src/dsp/transport-kernel';

describe('bounded stereo master capture', () => {
  it('flushes every stereo sample including the final partial chunk before stop', () => {
    const messages: CaptureMessage[] = [];
    const capture = new StereoCaptureKernel(10000, message => messages.push(message));
    const left = Float32Array.from({ length: 4207 }, (_, index) => index % 2 ? -.25 : .5);
    const right = Float32Array.from({ length: 4207 }, () => -.75);
    capture.process(left, right); capture.stop('manual'); capture.stop('manual');
    const chunks = messages.filter(message => message.type === 'chunk');
    expect(chunks.map(message => message.samples.length)).toEqual([8192, 222]);
    const samples = chunks.flatMap(message => [...message.samples]);
    expect(samples.length).toBe(left.length * 2);
    for (let frame = 0; frame < left.length; frame++) {
      expect(samples[frame * 2]).toBe(frame % 2 ? -8192 : 16384);
      expect(samples[frame * 2 + 1]).toBe(-24576);
    }
    expect(messages.at(-1)).toEqual({ type: 'stopped', reason: 'manual' });
    expect(messages.filter(message => message.type === 'stopped')).toHaveLength(1);
  });
  it('enforces the exact frame limit and sanitizes nonfinite/clipped samples', () => {
    const messages: CaptureMessage[] = [];
    const capture = new StereoCaptureKernel(3, message => messages.push(message));
    capture.process(new Float32Array([NaN, 2, -2, .8]));
    capture.process(new Float32Array([1]));
    expect(messages).toHaveLength(2);
    expect(messages[0].type === 'chunk' && [...messages[0].samples]).toEqual([0, 0, 32767, 32767, -32768, -32768]);
    expect(messages[1]).toEqual({ type: 'stopped', reason: 'limit' });
  });
  it('writes correctly sized little-endian PCM WAV and supports identical versioned exports', async () => {
    const chunks = [new Int16Array([32767, -32768, 1234, -5678]), new Int16Array([0, 42])];
    const first = encodeRecordingWav(chunks, 44100), second = encodeRecordingWav(chunks, 44100);
    expect(first.type).toBe('audio/wav'); expect(first.size).toBe(56);
    const data = await first.arrayBuffer(), view = new DataView(data);
    expect(new TextDecoder().decode(new Uint8Array(data, 0, 4))).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(48); expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100); expect(view.getUint32(28, true)).toBe(176400);
    expect(view.getUint16(34, true)).toBe(16); expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(44, true)).toBe(32767); expect(view.getInt16(46, true)).toBe(-32768);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array(data));
    expect([...chunks[0]]).toEqual([32767, -32768, 1234, -5678]);
    expect(() => encodeRecordingWav([], 48000)).toThrow();
  });
});

describe('play after track end', () => {
  const buffers = (frames: number) => ({ A: { left: new Float32Array(frames), right: new Float32Array(frames) }, B: { left: new Float32Array(frames), right: new Float32Array(frames) } });
  it('restarts each ended deck from zero while keeping paused/cue/loop semantics', () => {
    const kernel = new DualDeckTransportKernel(48000);
    const source = Float32Array.from({ length: 1024 }, (_, frame) => .2 * Math.sin(frame * .05));
    kernel.installDeck('A', [source], 1); kernel.installDeck('B', [source], 2);
    kernel.playDeck('A'); kernel.playDeck('B'); kernel.processInto(buffers(2048), 0);
    expect(kernel.readPosition('A').playing).toBe(false); expect(kernel.readPosition('A').frame).toBe(1024);
    kernel.playDeck('A'); kernel.playDeck('B');
    expect(kernel.readPosition('A').frame).toBe(0); expect(kernel.readPosition('B').frame).toBe(0);
    const replay = buffers(512); kernel.processInto(replay, 2048);
    expect(replay.A.left.some(sample => Math.abs(sample) > .01)).toBe(true);
    expect(replay.A.left).toEqual(replay.B.left);
    kernel.pauseDeck('A'); kernel.processInto(buffers(512), 2560);
    const paused = kernel.readPosition('A').frame; kernel.playDeck('A');
    expect(kernel.readPosition('A').frame).toBe(paused);
    kernel.setLoop('B', { startFrame: 100, endFrame: 700 }); kernel.playDeck('B');
    kernel.processInto(buffers(512), 3072); const position = kernel.readPosition('B');
    expect(position.playing).toBe(true); expect(position.frame).toBeGreaterThanOrEqual(100); expect(position.frame).toBeLessThan(700);
  });
});
