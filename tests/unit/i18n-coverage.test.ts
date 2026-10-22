import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../../src/i18n';
import { english } from '../../src/i18n/tr';

afterEach(() => setLanguage('en'));

const root = join(__dirname, '../..');
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// Complete messages that can reach the status line, an error notice or a panel
// notice. Literals followed by `+` are fragments of dynamic text and are covered
// by the explicit cases below. RangeError/TypeError are programmer-facing
// argument checks and stay English.
const userMessage = [
  /\b(?:this\.error|new AudioEngineError)\(\s*'[a-z-]+',\s*'([^']+)'(?=\s*[,)])/g,
  /\bnew Error\(\s*'([^']+)'(?=\s*[,)])/g,
  /\bset(?:Message|Notice)\(\s*'([^']+)'(?=\s*[,)])/g,
  /\bt\(\s*'([^']+)'\s*\)/g,
  /\bt\(\s*"([^"]+)"\s*\)/g,
];
// Names, units and identifiers intentionally shown verbatim in both languages.
const verbatim = new Set(['RIMVO', 'kHz', 'EN', 'TR', 'BPM', 'Shift', 'Cue', 'Tempo', 'Flanger', 'Tremolo', 'Drive', 'MP3', 'WAV', 'FLAC', 'MP3 · 320 kbps']);
// Developer-only invariant that cannot be reached by a user action.
const internal = new Set(['Workspace panels need a WorkspacePopoverProvider.']);

function collectMessages(): Map<string, string> {
  const messages = new Map<string, string>();
  for (const file of sourceFiles(join(root, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of userMessage) {
      for (const match of source.matchAll(pattern)) {
        const text = match[1].trim();
        // Policy copy is authored in Turkish and translated to English instead.
        if (/[A-Za-z]{2}/.test(text) && !verbatim.has(text) && !internal.has(text) && !Object.hasOwn(english, text)) messages.set(text, relative(root, file));
      }
    }
  }
  return messages;
}

describe('Turkish translation coverage', () => {
  it('finds the user-facing messages it guards', () => {
    expect(collectMessages().size).toBeGreaterThan(200);
  });

  it('translates every literal user-facing message in the source', () => {
    setLanguage('tr');
    const untranslated = [...collectMessages()].filter(([text]) => t(text) === text).map(([text, file]) => `${file}: ${text}`);
    expect(untranslated).toEqual([]);
  });

  it.each([
    ['Adding 3 local tracks…', '3 yerel parça ekleniyor…'],
    ['Adding 1 local track…', '1 yerel parça ekleniyor…'],
    ['Adding 1 local track to Deck B…', '1 yerel parça B kanalına ekleniyor…'],
    ['Unloaded Deck A.', 'A kanalı boşaltıldı.'],
    ['Removed Deck A Anthem from the library. Loaded audio keeps playing.', 'Deck A Anthem kütüphaneden kaldırıldı. Yüklü ses çalmaya devam ediyor.'],
    ['Removed track from the library.', 'Parça kütüphaneden kaldırıldı.'],
    ['Use 120.0 BPM grid A', 'A için 120.0 BPM ızgarasını kullan'],
    ['Use this beat estimate (82% confidence)', 'Bu vuruş tahminini kullan (%82 güven)'],
  ])('translates the dynamic status %s', (source, expected) => {
    setLanguage('tr');
    expect(t(source)).toBe(expected);
  });
});
