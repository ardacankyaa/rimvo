import { describe, expect, it } from 'vitest';

type Limiter = {
  processInto(inputLeft: Float32Array, inputRight: Float32Array, outputLeft: Float32Array, outputRight: Float32Array): void;
  dispose(): void;
};
type LimiterModule = {
  SamplePeakLimiterKernel?: new (
    sampleRate: number,
    options?: { lookaheadMs?: number; ceiling?: number; releaseMs?: number },
  ) => Limiter;
};

const limiterModules = import.meta.glob('../../src/dsp/limiter-kernel.ts');
async function createLimiter(sampleRate = 48000): Promise<Limiter | null> {
  const load = Object.values(limiterModules)[0];
  const module = load ? (await load()) as LimiterModule : null;
  expect(typeof module?.SamplePeakLimiterKernel).toBe('function');
  return module?.SamplePeakLimiterKernel
    ? new module.SamplePeakLimiterKernel(sampleRate, { lookaheadMs: 3, ceiling: 10 ** (-1 / 20), releaseMs: 80 })
    : null;
}

describe('SamplePeakLimiterKernel', () => {
  it('keeps silence silent and replaces non-finite input with finite output', async () => {
    const limiter = await createLimiter();
    if (!limiter) return;

    const inputLeft = new Float32Array(512);
    const inputRight = new Float32Array(512);
    inputLeft[17] = Number.NaN;
    inputRight[31] = Number.POSITIVE_INFINITY;
    const outputLeft = new Float32Array(512);
    const outputRight = new Float32Array(512);
    limiter.processInto(inputLeft, inputRight, outputLeft, outputRight);

    expect(Array.from(outputLeft).every(Number.isFinite)).toBe(true);
    expect(Array.from(outputRight).every(Number.isFinite)).toBe(true);
    expect(Math.max(...outputLeft.map(Math.abs))).toBe(0);
    expect(Math.max(...outputRight.map(Math.abs))).toBe(0);
    limiter.dispose();
  });

  it('uses stereo-linked lookahead to keep a burst under its sample-peak ceiling', async () => {
    const limiter = await createLimiter();
    if (!limiter) return;

    const inputLeft = new Float32Array(512);
    const inputRight = new Float32Array(512);
    inputLeft[200] = 2;
    inputRight[200] = 1;
    const outputLeft = new Float32Array(512);
    const outputRight = new Float32Array(512);
    limiter.processInto(inputLeft, inputRight, outputLeft, outputRight);

    const ceiling = 10 ** (-1 / 20);
    expect(Math.max(...outputLeft.map(Math.abs))).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(Math.max(...outputRight.map(Math.abs))).toBeLessThanOrEqual(ceiling / 2 + 1e-6);
    expect(outputRight[200 + 144]).toBeGreaterThan(0.4);
    limiter.dispose();
  });

  it('stays under ceiling during sustained correlated overload and releases smoothly', async () => {
    const limiter = await createLimiter();
    if (!limiter) return;

    const inputLeft = new Float32Array(12_000).fill(1.4);
    const inputRight = new Float32Array(12_000).fill(1.4);
    const outputLeft = new Float32Array(inputLeft.length);
    const outputRight = new Float32Array(inputRight.length);
    limiter.processInto(inputLeft, inputRight, outputLeft, outputRight);

    const ceiling = 10 ** (-1 / 20);
    expect(Math.max(...outputLeft.map(Math.abs))).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(Math.max(...outputRight.map(Math.abs))).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(outputLeft.at(-1)).toBeGreaterThanOrEqual(ceiling - 0.02);
    expect(outputLeft.at(-1)).toBeLessThanOrEqual(ceiling + 1e-6);
    limiter.dispose();
  });
});
