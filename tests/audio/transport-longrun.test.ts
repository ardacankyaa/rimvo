import { describe, expect, it } from 'vitest';
import { DualDeckTransportKernel, type DualTransportOutputs } from '../../src/dsp/transport-kernel';

const rate = 48_000;
const quantum = 128;
function output(): DualTransportOutputs {
  return { A: { left: new Float32Array(quantum), right: new Float32Array(quantum) }, B: { left: new Float32Array(quantum), right: new Float32Array(quantum) } };
}
function phaseErrorFrames(masterFrame: number, slaveFrame: number, masterPeriod: number, slavePeriod: number): number {
  const difference = Math.abs(masterFrame / masterPeriod % 1 - slaveFrame / slavePeriod % 1);
  return Math.min(difference, 1 - difference) * slavePeriod;
}

describe('production transport long-run frame accuracy', () => {
  it('renders one actual kernel hour with fractional shared-clock sync and records 32-bar phase error', () => {
    const kernel = new DualDeckTransportKernel(rate);
    const out = output();
    const masterPeriod = 60 * rate / 118;
    const slavePeriod = 60 * rate / 124;
    const pcm = new Float32Array(rate).fill(0.2);
    kernel.installDeck('A', [pcm], 1);
    kernel.installDeck('B', [pcm], 2);
    kernel.setBeatGrid('A', { bpm: 118, firstBeatFrame: 0 });
    kernel.setBeatGrid('B', { bpm: 124, firstBeatFrame: 0 });
    kernel.setLoop('A', { startFrame: 0, endFrame: masterPeriod });
    kernel.setLoop('B', { startFrame: 0, endFrame: slavePeriod });
    kernel.setTempoPercent('A', 12);
    kernel.playDeck('A');
    kernel.playDeck('B');
    kernel.syncDeck('B', 'A');
    const totalFrames = 3600 * rate;
    const bar32Frame = Math.ceil(128 * masterPeriod / 1.12);
    let maxErrorFrames = 0;
    let error32BarsFrames: number | null = null;
    let checksum = 0;
    try {
      for (let frame = 0; frame < totalFrames; frame += quantum) {
        kernel.processInto(out, frame);
        checksum += out.A.left[quantum - 1] + out.B.left[quantum - 1];
        if (frame % (quantum * 10_000) === 0 || (frame < bar32Frame && frame + quantum >= bar32Frame) || frame + quantum === totalFrames) {
          const error = phaseErrorFrames(kernel.readPosition('A').frame, kernel.readPosition('B').frame, masterPeriod, slavePeriod);
          maxErrorFrames = Math.max(maxErrorFrames, error);
          if (frame < bar32Frame && frame + quantum >= bar32Frame) error32BarsFrames = error;
          expect(error).toBeLessThanOrEqual(1);
        }
      }
      expect(error32BarsFrames).not.toBeNull();
      expect(error32BarsFrames! / rate).toBeLessThanOrEqual(0.01);
      expect(Number.isFinite(checksum)).toBe(true);
      expect(checksum).toBeGreaterThan(1);
      expect(kernel.readPosition('A').contextFrame).toBe(totalFrames);
      expect(kernel.readPosition('B').contextFrame).toBe(totalFrames);
    } finally { kernel.dispose(); }
  }, 360_000);

  it('preserves the canonical fractional period through 1000 reverse wraps without reading outside-loop PCM', () => {
    const kernel = new DualDeckTransportKernel(rate);
    const out = output();
    const start = 123.4, end = 1124.7, length = end - start;
    const pcm = new Float32Array(rate).fill(1);
    pcm.fill(0.25, Math.ceil(start), Math.ceil(end));
    kernel.installDeck('A', [pcm], 3);
    kernel.setLoop('A', { startFrame: start, endFrame: end });
    kernel.beginScratch('A');
    const initial = start + length / 2;
    kernel.updateScratch('A', initial, -2);
    const frames = Math.ceil(1000 * length / 2);
    let peak = 0;
    try {
      for (let frame = 0; frame < frames; frame += quantum) {
        if (frame > 0) kernel.updateScratch('A', kernel.readPosition('A').frame, -2);
        const count = Math.min(quantum, frames - frame);
        kernel.processInto(out, frame, 0, count);
        for (let sample = 0; sample < count; sample++) peak = Math.max(peak, Math.abs(out.A.left[sample]));
      }
      const expected = start + ((initial - 2 * frames - start) % length + length) % length;
      expect(Math.abs(kernel.readPosition('A').frame - expected)).toBeLessThanOrEqual(1);
      expect(kernel.readPosition('A').rate).toBe(-2);
      expect(peak).toBeGreaterThan(0.1);
      expect(peak).toBeLessThanOrEqual(0.251);
    } finally { kernel.dispose(); }
  });
});
