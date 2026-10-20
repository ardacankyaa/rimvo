import type { Language } from '../i18n';

/** Lowercase searchable user text with the active UI language's casing rules. */
export function normalizeSearchText(value: string, language: Language): string {
  return value.normalize('NFC').toLocaleLowerCase(language === 'tr' ? 'tr' : 'en-US');
}

export function matchesSearchText(value: string, query: string, language: Language): boolean {
  const needle = normalizeSearchText(query.trim(), language);
  return !needle || normalizeSearchText(value, language).includes(needle);
}
