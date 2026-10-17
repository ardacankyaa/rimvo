import { describe, expect, it } from 'vitest';
import { driveCurve } from '../../src/audio/performance-fx';

describe('drive transfer curve', () => {
  it('keeps silence at zero and an odd, bounded transfer at every intensity', () => {
    for (const amount of [0, .2, .7, 1]) {
      const curve = driveCurve(amount);
      expect(curve[1024]).toBe(0);
      expect(Math.max(...curve)).toBeLessThanOrEqual(1);
      expect(Math.min(...curve)).toBeGreaterThanOrEqual(-1);
      for (let i = 0; i < curve.length; i += 64) expect(curve[i]).toBeCloseTo(-curve[curve.length - 1 - i], 6);
    }
  });
  it('changes low-level harmonics with intensity and rejects non-finite input', () => {
    expect(driveCurve(.9)[1120]).toBeGreaterThan(driveCurve(.1)[1120]);
    expect(() => driveCurve(NaN)).toThrow();
  });
});
