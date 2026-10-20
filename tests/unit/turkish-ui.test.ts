import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../../src/i18n';

afterEach(() => setLanguage('en'));

describe('Turkish DJ console copy', () => {
  it('translates sync guidance, grid states, effect descriptors, mixer filters, and pending duration', () => {
    setLanguage('tr');

    expect(t('Set a reliable beat grid to sync')).toBe('Eşlemek için doğrulanmış bir vuruş ızgarası belirle');
    expect(t('Master deck is stopped')).toBe('Ana kanal durduruldu');
    expect(t('Manual beat grid')).toBe('Elle belirlenen vuruş ızgarası');
    expect(t('Analysing BPM')).toBe('BPM analiz ediliyor');
    expect(t('No beat estimate')).toBe('Vuruş tahmini yok');
    expect(t('No track loaded')).toBe('Yüklü parça yok');
    expect(t('Duration pending')).toBe('Süre bekleniyor');
    expect(t('Repeats')).toBe('Tekrarlar');
    expect(t('Reverb space')).toBe('Derinlik');
    expect(t('Low-pass')).toBe('Alçak geçiren');
    expect(t('High-pass')).toBe('Yüksek geçiren');
    expect(t('Bypass')).toBe('Filtresiz');
  });

  it('translates dynamic BPM and confidence text while keeping measurement values intact', () => {
    setLanguage('tr');

    expect(t('Tap with the beat · 2 of 4')).toBe('Ritme göre vur · 2 / 4');
    expect(t('Estimate range · 118.5–121.0 BPM')).toBe('Tahmin aralığı · 118.5–121.0 BPM');
    expect(t('93% grid confidence')).toBe('Izgara güveni %93');
    expect(t('Tap 3/4')).toBe('Vur 3/4');
    expect(t('Hold & move · Grit')).toBe('Basılı tut ve hareket ettir · Pürüz');
    expect(t('Room · Live')).toBe('Oda · Canlı');
  });

  it('translates visible UI strings without translating user supplied names', () => {
    setLanguage('tr');

    expect(t('Low')).toBe('Bas');
    expect(t('Reverb space')).toBe('Derinlik');
    expect(t('Işık.wav')).toBe('Işık.wav');
    expect(t('Headphone USB Arda')).toBe('Headphone USB Arda');
    setLanguage('en');
    expect(t('Reverb space')).toBe('Space');
  });
});
