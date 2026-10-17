import { describe, expect, it } from 'vitest';

type PolyphaseModule = {
  readBandlimitedSample?: (source: Float32Array, positionFrame: number, playbackRate: number, loopStartFrame?: number, loopEndFrame?: number) => number;
};
const resamplerModules = import.meta.glob('../../src/dsp/polyphase-resampler.ts');
async function loadResampler(): Promise<PolyphaseModule | null> {
  const load = Object.values(resamplerModules)[0];
  return load ? await load() as PolyphaseModule : null;
}

function renderAtRate(
  read: NonNullable<PolyphaseModule['readBandlimitedSample']>,
  source: Float32Array,
  playbackRate: number,
): Float32Array {
  const result = new Float32Array(4096);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = read(source, 1024 + index * playbackRate, playbackRate);
  }
  return result;
}

function rms(samples: Float32Array): number {
  let power = 0;
  for (const sample of samples) power += sample * sample;
  return Math.sqrt(power / samples.length);
}

describe('band-limited polyphase resampler', () => {
  it('preserves in-band pitch while suppressing aliases above the 2x playback Nyquist limit', async () => {
    const module = await loadResampler();
    expect(typeof module?.readBandlimitedSample).toBe('function');
    if (!module?.readBandlimitedSample) return;

    const inBand = Float32Array.from({ length: 12_000 }, (_, frame) => Math.sin(2 * Math.PI * 0.1 * frame));
    const wanted = rms(renderAtRate(module.readBandlimitedSample, inBand, 2));
    expect(wanted).toBeGreaterThan(0.68);
    for (const frequency of [0.3, 0.35, 0.4, 0.45]) {
      const aboveCutoff = Float32Array.from({ length: inBand.length }, (_, frame) => Math.sin(2 * Math.PI * frequency * frame));
      const aliased = rms(renderAtRate(module.readBandlimitedSample, aboveCutoff, 2));
      expect(aliased / wanted).toBeLessThanOrEqual(0.01);
    }
  });

  it('uses the same band-limited source when the signed cursor moves backwards', async () => {
    const module = await loadResampler();
    expect(typeof module?.readBandlimitedSample).toBe('function');
    if (!module?.readBandlimitedSample) return;

    const tone = Float32Array.from({ length: 8192 }, (_, frame) => Math.sin(2 * Math.PI * frame / 64));
    const forward = module.readBandlimitedSample(tone, 3000.25, 1);
    const reverse = module.readBandlimitedSample(tone, 3000.25, -1);
    expect(forward).toBeCloseTo(Math.sin(2 * Math.PI * 3000.25 / 64), 2);
    expect(reverse).toBeCloseTo(forward, 6);
  });
});
  it('keeps slow forward and reverse rates audible at their measured signed pitch', async () => {
    const module = await loadResampler();
    expect(typeof module?.readBandlimitedSample).toBe('function');
    if (!module?.readBandlimitedSample) return;

    const source = Float32Array.from({ length: 16_000 }, (_, frame) => Math.sin(2 * Math.PI * 0.02 * frame));
    const measureAmplitude = (rate: number, frequency: number): number => {
      const samples = renderAtRate(module.readBandlimitedSample!, source, rate);
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const angle = 2 * Math.PI * frequency * index;
        real += samples[index] * Math.cos(angle);
        imaginary -= samples[index] * Math.sin(angle);
      }
      return 2 * Math.hypot(real, imaginary) / samples.length;
    };

    for (const rate of [0.84, 0.25, -0.25]) {
      expect(measureAmplitude(rate, Math.abs(rate) * 0.02)).toBeGreaterThan(0.85);
    }
  });

  it('wraps filter neighbors through a loop instead of reading outside the loop region', async () => {
    const module = await loadResampler();
    expect(typeof module?.readBandlimitedSample).toBe('function');
    if (!module?.readBandlimitedSample) return;

    const source = new Float32Array(400);
    source.fill(0.5, 100, 200);
    source.fill(12, 0, 100);
    source.fill(-12, 200);
    expect(module.readBandlimitedSample(source, 100.25, 1.16, 100, 200)).toBeCloseTo(0.5, 2);
    expect(module.readBandlimitedSample(source, 199.75, -1.16, 100, 200)).toBeCloseTo(0.5, 2);
  });


describe('fractional loop resampling', () => {
  it('wraps fractional interpolation taps inside the loop in both directions', async () => {
    const module = await loadResampler();
    expect(typeof module?.readBandlimitedSample).toBe('function');
    if (!module?.readBandlimitedSample) return;
    const source = new Float32Array(64);
    source.fill(0.91);
    source.fill(0.2, 10, 21);
    const start = 10.25, end = 20.75;
    const forward = module.readBandlimitedSample(source, start + 0.25, 1, start, end);
    const reverse = module.readBandlimitedSample(source, start + 0.25, -2, start, end);
    expect(Number.isFinite(forward)).toBe(true);
    expect(Number.isFinite(reverse)).toBe(true);
    expect(forward).toBeCloseTo(0.2, 2);
    expect(reverse).toBeCloseTo(0.2, 1);
    expect(Math.abs(module.readBandlimitedSample(source, start + 0.25, 1) - 0.2)).toBeGreaterThan(0.02);
  });
});
