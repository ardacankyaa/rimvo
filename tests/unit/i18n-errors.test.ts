import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../../src/i18n';

afterEach(() => setLanguage('en'));

describe('Turkish error messages', () => {
  it.each([
    ['A WAV chunk extends beyond the file.', 'WAV dosyasındaki bir bölüm dosya sınırını aşıyor.'],
    ['The MP3 ID3 header is truncated.', 'MP3 dosyasının ID3 başlığı eksik.'],
    ['The FLAC metadata is truncated.', 'FLAC dosyasının üst verileri eksik.'],
    ['Add up to 32 tracks at a time.', 'Bir seferde en fazla 32 parça ekleyebilirsin.'],
    ['Resume audio before recording.', 'Kaydetmeden önce sesi devam ettir.'],
    ['MP3 encoding failed. Try WAV instead.', 'MP3 dönüşümü başarısız oldu. WAV biçimini dene.'],
    ['The saved session is invalid.', 'Kayıtlı oturum geçersiz.'],
    ['The saved session is invalid. Delete it or save a new session to continue.', 'Kayıtlı oturum geçersiz. Devam etmek için bu kaydı sil veya yeni bir oturum kaydet.'],
    ['Local session storage is unavailable. Try again or check your browser storage settings.', 'Yerel oturum depolaması kullanılamıyor. Yeniden dene veya tarayıcının depolama ayarlarını kontrol et.'],
    ['Web Audio is unavailable in this browser.', 'Bu tarayıcı Web Audio ses motorunu desteklemiyor.'],
  ])('translates a known error: %s', (source, expected) => {
    setLanguage('tr');
    expect(t(source)).toBe(expected);
  });

  it('translates load failure context and cause without translating a user title', () => {
    setLanguage('tr');
    expect(t('Could not load Audio paused into Deck A. A WAV chunk extends beyond the file.'))
      .toBe('Audio paused, A kanalına yüklenemedi. WAV dosyasındaki bir bölüm dosya sınırını aşıyor.');
  });

  it('preserves deck-like text inside user titles', () => {
    setLanguage('tr');
    expect(t('Could not load Night into Deck B. remix.wav into Deck A. The WAV header is invalid.'))
      .toBe('Night into Deck B. remix.wav, A kanalına yüklenemedi. WAV dosyasının başlığı geçersiz.');
  });

  it('translates known load prefixes but retains unknown platform diagnostics', () => {
    setLanguage('tr');
    expect(t('Could not load Night.wav into Deck B. Decoder 0x52: user-file.wav'))
      .toBe('Night.wav, B kanalına yüklenemedi. Decoder 0x52: user-file.wav');
    expect(t('Could not load the selected file into Deck A.')).toBe('Seçilen dosya A kanalına yüklenemedi.');
  });

  it('preserves the filename in download notifications', () => {
    setLanguage('tr');
    expect(t('Download requested: Audio paused v01.wav')).toBe('İndirme istendi: Audio paused v01.wav');
  });

  it('leaves English messages and unrelated user data unchanged', () => {
    const message = 'Could not load Night.wav into Deck B. The WAV header is invalid.';
    expect(t(message)).toBe(message);
    setLanguage('tr');
    expect(t('Night.wav')).toBe('Night.wav');
    expect(t('Headphone USB Arda')).toBe('Headphone USB Arda');
  });
});
