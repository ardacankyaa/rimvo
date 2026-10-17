import { describe, expect, it } from 'vitest';

type Peak = { min: number; max: number };
type Level = { blockFrames: number; left: readonly Peak[]; right: readonly Peak[] | null };
type Waveform = { sampleRate: number; frameCount: number; channels: number; baseBlockFrames: number; levels: readonly Level[] };
type Analyze = (channels: readonly Float32Array[], sampleRate: number, options?: { baseBlockFrames?: number }) => Waveform;
type AnalysisModule = { analyzeWaveform?: Analyze };

function expectPeaksClose(actual: readonly Peak[], expected: readonly Peak[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((peak, index) => {
    expect(actual[index].min).toBeCloseTo(peak.min, 6);
    expect(actual[index].max).toBeCloseTo(peak.max, 6);
  });
}

const analysisModules = import.meta.glob('../../src/analysis/waveform.ts');
async function loadAnalyzer(): Promise<Analyze | null> {
  const load = Object.values(analysisModules)[0];
  const module = load ? (await load()) as AnalysisModule : null;
  expect(typeof module?.analyzeWaveform).toBe('function');
  return module?.analyzeWaveform ?? null;
}

describe('analyzeWaveform', () => {
  it('returns exact stereo min/max peaks and folds levels into a compact pyramid', async () => {
    const analyze = await loadAnalyzer();
    if (!analyze) return;

    const result = analyze(
      [
        Float32Array.from([-0.8, 0.2, -0.4, 0.6, -0.1, 0.9, -0.7, 0.3]),
        Float32Array.from([0.5, -0.3, 0.1, -0.9, 0.7, -0.2, 0.4, -0.6]),
      ],
      48_000,
      { baseBlockFrames: 2 },
    );

    expect(result).toMatchObject({ sampleRate: 48_000, frameCount: 8, channels: 2, baseBlockFrames: 2 });
    expectPeaksClose(result.levels[0].left, [
      { min: -0.8, max: 0.2 },
      { min: -0.4, max: 0.6 },
      { min: -0.1, max: 0.9 },
      { min: -0.7, max: 0.3 },
    ]);
    expectPeaksClose(result.levels[0].right ?? [], [
      { min: -0.3, max: 0.5 },
      { min: -0.9, max: 0.1 },
      { min: -0.2, max: 0.7 },
      { min: -0.6, max: 0.4 },
    ]);
    expect(result.levels[1].blockFrames).toBe(4);
    expectPeaksClose(result.levels[1].left, [{ min: -0.8, max: 0.6 }, { min: -0.7, max: 0.9 }]);
    expectPeaksClose(result.levels.at(-1)?.left ?? [], [{ min: -0.8, max: 0.9 }]);
  });

  it('handles mono, partial buckets, empty input and non-finite samples safely', async () => {
    const analyze = await loadAnalyzer();
    if (!analyze) return;

    const mono = analyze([Float32Array.from([0.25, Number.NaN, -0.5])], 44_100, { baseBlockFrames: 2 });
    expect(mono).toMatchObject({ frameCount: 3, channels: 1 });
    expectPeaksClose(mono.levels[0].left, [{ min: 0, max: 0.25 }, { min: -0.5, max: -0.5 }]);
    expect(mono.levels[0].right).toBeNull();
    expect(mono.levels.flatMap((level) => level.left).every((peak) => Number.isFinite(peak.min) && Number.isFinite(peak.max))).toBe(true);

    const empty = analyze([new Float32Array(0)], 44_100);
    expect(empty.frameCount).toBe(0);
    expect(empty.levels).toHaveLength(0);
  });
});
