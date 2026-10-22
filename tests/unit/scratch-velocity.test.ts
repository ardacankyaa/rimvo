import { describe, expect, it } from 'vitest';
import { smoothScratchVelocity } from '../../src/ui/ScratchMotion';
describe('hand velocity filtering', () => {
  it('rejects stationary, duplicate and invalid samples', () => {
    expect(smoothScratchVelocity(1,0,.016)).toBe(0);
    expect(smoothScratchVelocity(1,.02,0)).toBe(0);
    expect(smoothScratchVelocity(1,NaN,.016)).toBe(0);
  });
  it('reduces same-direction jitter without overshooting signed audio limits', () => {
    const first=smoothScratchVelocity(0,.016,.016);
    expect(first).toBeGreaterThan(.5);expect(first).toBeLessThan(1);
    expect(smoothScratchVelocity(first,10,.001)).toBeLessThanOrEqual(2);
  });
  it('follows a reversal immediately instead of fighting the hand', () => {
    expect(smoothScratchVelocity(1,-.016,.016)).toBe(-1);
  });
});
