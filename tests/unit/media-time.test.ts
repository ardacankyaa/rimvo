import { describe, expect, it } from 'vitest';
import { formatMediaTime } from '../../src/ui/time';

describe('media time formatting', () => {
  it('formats minutes and hundredths', () => {
    expect(formatMediaTime(0)).toBe('00:00.00');
    expect(formatMediaTime(0.29)).toBe('00:00.29');
    expect(formatMediaTime(83.5)).toBe('01:23.50');
    expect(formatMediaTime(480)).toBe('08:00.00');
  });

  it('never shows 60 seconds near a minute boundary', () => {
    expect(formatMediaTime(59.999)).toBe('00:59.99');
    expect(formatMediaTime(239.9999)).toBe('03:59.99');
  });

  it('treats invalid and negative values as zero', () => {
    expect(formatMediaTime(Number.NaN)).toBe('00:00.00');
    expect(formatMediaTime(-3)).toBe('00:00.00');
  });
});
