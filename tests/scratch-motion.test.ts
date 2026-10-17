import { describe, expect, it } from 'vitest';
import { createScratchAnchor, sampleScratchMotion } from '../src/ui/ScratchMotion';

describe('scratch centre safety', () => {
  it('freezes position through the centre and reanchors without accumulated rotation', () => {
    const anchor=createScratchAnchor(100,0,100);
    expect(sampleScratchMotion(anchor,0,100,100)).toBeCloseTo(Math.PI/2);
    expect(sampleScratchMotion(anchor,5,0,100)).toBe(0);
    expect(sampleScratchMotion(anchor,-18,0,100)).toBe(0);
    expect(sampleScratchMotion(anchor,-30,0,100)).toBe(0);
    expect(sampleScratchMotion(anchor,0,-100,100)).toBeCloseTo(Math.PI/2);
  });
  it('unwraps the angle boundary instead of jumping one full turn', () => {
    const anchor=createScratchAnchor(-100,1,100);
    expect(sampleScratchMotion(anchor,-100,-1,100)).toBeCloseTo(0.02,3);
  });
  it('anchors a gesture started inside the centre before applying any delta', () => {
    const anchor=createScratchAnchor(0,0,100);
    expect(sampleScratchMotion(anchor,100,0,100)).toBe(0);
    expect(sampleScratchMotion(anchor,0,100,100)).toBeCloseTo(Math.PI/2);
  });
  it('ignores non-finite samples without poisoning the anchor', () => {
    const anchor=createScratchAnchor(100,0,100);
    expect(sampleScratchMotion(anchor,NaN,10,100)).toBe(0);
    expect(sampleScratchMotion(anchor,0,100,100)).toBeCloseTo(Math.PI/2);
  });
});
