import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRememberPreferences, PREFERENCE_LIFETIME_DAYS, PREFERENCE_STORAGE_KEY,
  readThemePreference, setRememberPreferences, THEME_STORAGE_KEY, writeThemePreference,
} from '../../src/legal/preference-storage';

const now = Date.UTC(2026, 9, 10);
const lifetime = PREFERENCE_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
let values: Map<string, string>;
let storage: Storage;
beforeEach(() => {
  values = new Map();
  storage = {
    get length() { return values.size; },
    clear: vi.fn(() => values.clear()),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, String(value)); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  vi.stubGlobal('localStorage', storage);
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('optional theme persistence', () => {
  it('starts without consent and does not persist a session theme', () => {
    expect(getRememberPreferences()).toBe(false);
    expect(readThemePreference()).toBe('dark');
    writeThemePreference('light');
    expect(values.size).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('removes a legacy automatically persisted theme instead of treating it as consent', () => {
    values.set(THEME_STORAGE_KEY, 'light');
    expect(readThemePreference()).toBe('dark');
    expect(values.has(THEME_STORAGE_KEY)).toBe(false);
    expect(getRememberPreferences()).toBe(false);
  });
  it.each(['dark', 'light'] as const)('remembers the actual %s theme only after opt-in', theme => {
    expect(setRememberPreferences(true, theme)).toBe(true);
    expect(getRememberPreferences()).toBe(true);
    expect(readThemePreference()).toBe(theme);
    expect(JSON.parse(values.get(PREFERENCE_STORAGE_KEY)!)).toEqual({ version: 1, expiresAt: now + lifetime });
    expect(values.get(THEME_STORAGE_KEY)).toBe(theme);
  });
  it('changes the theme without extending the original permission lifetime', () => {
    setRememberPreferences(true, 'dark');
    const permission = values.get(PREFERENCE_STORAGE_KEY);
    vi.mocked(Date.now).mockReturnValue(now + 24 * 60 * 60 * 1000);
    writeThemePreference('light');
    expect(readThemePreference()).toBe('light');
    expect(values.get(PREFERENCE_STORAGE_KEY)).toBe(permission);
  });
  it('revokes both saved values and does not re-create them on later theme changes', () => {
    setRememberPreferences(true, 'light');
    expect(setRememberPreferences(false, 'light')).toBe(false);
    expect(values.has(THEME_STORAGE_KEY)).toBe(false);
    expect(values.has(PREFERENCE_STORAGE_KEY)).toBe(false);
    writeThemePreference('dark');
    expect(values.size).toBe(0);
    expect(readThemePreference()).toBe('dark');
  });
  it('expires on the boundary, removes both values, and returns the default theme', () => {
    setRememberPreferences(true, 'light');
    vi.mocked(Date.now).mockReturnValue(now + lifetime);
    expect(getRememberPreferences()).toBe(false);
    expect(values.size).toBe(0);
    expect(readThemePreference()).toBe('dark');
  });
  it.each([
    ['malformed JSON', '{invalid'],
    ['null', 'null'],
    ['primitive', '"yes"'],
    ['unsupported version', JSON.stringify({ version: 2, expiresAt: now + lifetime })],
    ['missing expiry', JSON.stringify({ version: 1 })],
    ['string expiry', JSON.stringify({ version: 1, expiresAt: String(now + lifetime) })],
    ['null expiry', JSON.stringify({ version: 1, expiresAt: null })],
    ['expired', JSON.stringify({ version: 1, expiresAt: now - 1 })],
    ['excessive future expiry', JSON.stringify({ version: 1, expiresAt: now + lifetime * 2 })],
  ])('rejects %s permission without retaining a remembered theme', (_description, raw) => {
    values.set(PREFERENCE_STORAGE_KEY, raw);
    values.set(THEME_STORAGE_KEY, 'light');
    expect(getRememberPreferences()).toBe(false);
    expect(values.size).toBe(0);
    expect(readThemePreference()).toBe('dark');
  });
  it('uses the safe default if an opted-in stored theme is invalid', () => {
    setRememberPreferences(true, 'light');
    values.set(THEME_STORAGE_KEY, 'unexpected');
    expect(readThemePreference()).toBe('dark');
  });
  it('rolls back a partial opt-in when saving the actual theme fails', () => {
    vi.mocked(storage.setItem).mockImplementation((key, value) => {
      if (key === THEME_STORAGE_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      values.set(key, value);
    });
    expect(setRememberPreferences(true, 'light')).toBe(false);
    expect(values.size).toBe(0);
    expect(getRememberPreferences()).toBe(false);
  });
  it('does not throw or claim opt-in when browser storage is unavailable', () => {
    const denied = () => { throw new DOMException('Storage denied', 'SecurityError'); };
    vi.stubGlobal('localStorage', {
      getItem: denied, setItem: denied, removeItem: denied,
    });
    expect(getRememberPreferences()).toBe(false);
    expect(readThemePreference()).toBe('dark');
    expect(setRememberPreferences(true, 'light')).toBe(false);
    expect(setRememberPreferences(false, 'dark')).toBe(false);
    expect(() => writeThemePreference('light')).not.toThrow();
  });
});

