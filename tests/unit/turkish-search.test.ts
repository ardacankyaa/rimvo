import { describe, expect, it } from 'vitest';
import { matchesSearchText } from '../../src/library/search';

describe('library search language rules', () => {
  it.each([
    ['Işık.wav', 'ışık'],
    ['IŞIK.wav', 'ışık'],
    ['İNCİ.wav', 'inci'],
    ['I\u0307NCİ.wav', 'inci'],
    ['İstanbul', '  istanbul  '],
  ])('finds %s using Turkish case folding for %s', (title, query) => {
    expect(matchesSearchText(title, query, 'tr')).toBe(true);
  });

  it('keeps dotted and dotless I distinct in Turkish while following English casing in English', () => {
    expect(matchesSearchText('Istanbul', 'istanbul', 'tr')).toBe(false);
    expect(matchesSearchText('Istanbul', 'istanbul', 'en')).toBe(true);
    expect(matchesSearchText('Işık.wav', 'ışık', 'en')).toBe(false);
  });

  it('does not filter the library for an empty query', () => {
    expect(matchesSearchText('Işık.wav', '   ', 'tr')).toBe(true);
  });
});
