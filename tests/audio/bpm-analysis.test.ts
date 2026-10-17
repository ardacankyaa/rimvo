import { describe, expect, it } from 'vitest';
import type { BpmAnalysisSnapshot } from '../../src/audio/types';

type AnalysisModule = {
  analyzeBpm?: (channels: readonly Float32Array[], sampleRate: number) => BpmAnalysisSnapshot;
};
const analysisModules = import.meta.glob('../../src/analysis/bpm-analysis.ts');
async function loadAnalysis(): Promise<AnalysisModule | null> {
  const load = Object.values(analysisModules)[0];
  return load ? await load() as AnalysisModule : null;
}

function clickTrack(bpm: number, seconds = 12): Float32Array {
  const sampleRate = 48_000;
  const samples = new Float32Array(sampleRate * seconds);
  const period = sampleRate * 60 / bpm;
  for (let beat = 0; beat * period < samples.length; beat += 1) {
    const start = Math.round(beat * period);
    for (let frame = start; frame < Math.min(samples.length, start + 240); frame += 1) {
      samples[frame] = 0.8;
    }
  }
  return samples;
}

describe('worker BPM analysis', () => {
  it('finds the rhythm after a long silent introduction',async()=>{
    const module=await loadAnalysis(),rate=8000,samples=new Float32Array(rate*150);
    for(let start=rate*85;start<samples.length;start+=rate/2)for(let i=0;i<40;i++)samples[start+i]=.8;
    const result=module!.analyzeBpm!([samples],rate);
    expect(result.status).toBe('complete');expect(result.candidates[0].bpm).toBeCloseTo(120,1);
    expect(result.candidates[0].firstBeatSeconds).toBeGreaterThanOrEqual(0);expect(result.candidates[0].firstBeatSeconds).toBeLessThan(.501);
  });
  it('finds clean 120 and 128 BPM clicks and reports plausible half/double alternatives', async () => {
    const module = await loadAnalysis();
    expect(typeof module?.analyzeBpm).toBe('function');
    if (!module?.analyzeBpm) return;

    for (const bpm of [120, 128]) {
      const result = module.analyzeBpm([clickTrack(bpm)], 48_000);
      expect(result.status).toBe('complete');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.candidates[0]?.bpm).toBeCloseTo(bpm, 1);
      expect(result.candidates[0]?.firstBeatSeconds).toBeLessThan(0.01);
      expect(result.candidates.some(candidate => Math.abs(candidate.bpm - bpm / 2) < 0.2)).toBe(true);
      expect(result.candidates.some(candidate => Math.abs(candidate.bpm - bpm * 2) < 0.2)).toBe(true);
    }
  });

  it('marks silence and unrelated noise unavailable instead of inventing a reliable beat grid', async () => {
    const module = await loadAnalysis();
    expect(typeof module?.analyzeBpm).toBe('function');
    if (!module?.analyzeBpm) return;

    const silence = new Float32Array(48_000 * 8);
    const noise = Float32Array.from({ length: silence.length }, (_, index) => {
      let value = (index * 1_103_515_245 + 12_345) >>> 0;
      value = (value ^ (value >>> 11)) >>> 0;
      return ((value & 0xffff) / 32768 - 1) * 0.05;
    });
    expect(module.analyzeBpm([silence], 48_000).status).toBe('unavailable');
    expect(module.analyzeBpm([noise], 48_000).status).toBe('unavailable');
  });
});
  it('refuses a constant grid when strong pulse timing changes halfway through the track', async () => {
    const module = await loadAnalysis();
    expect(typeof module?.analyzeBpm).toBe('function');
    if (!module?.analyzeBpm) return;

    const sampleRate = 48_000;
    const samples = new Float32Array(sampleRate * 12);
    let time = 0;
    let beat = 0;
    while (time < 12) {
      const start = Math.round(time * sampleRate);
      for (let frame = start; frame < Math.min(samples.length, start + 240); frame += 1) samples[frame] = 0.8;
      time += beat < 12 ? 0.5 : 60 / 140;
      beat += 1;
    }
    const result = module.analyzeBpm([samples], sampleRate);
    expect(result.status).toBe('unavailable');
    expect(result.confidence).toBe(0);
  });
