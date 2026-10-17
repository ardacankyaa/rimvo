export type ThemePreference = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'rimvo-theme';
export const PREFERENCE_STORAGE_KEY = 'rimvo-preferences';
export const PREFERENCE_LIFETIME_DAYS = 180;
const lifetimeMs = PREFERENCE_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

function clearStoredPreference(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
    localStorage.removeItem(PREFERENCE_STORAGE_KEY);
  } catch { /* Storage may be unavailable; the console still works. */ }
}
export function getRememberPreferences(): boolean {
  try {
    const raw = localStorage.getItem(PREFERENCE_STORAGE_KEY);
    if (!raw) return false;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') { clearStoredPreference(); return false; }
    const record = saved as { version?: unknown; expiresAt?: unknown };
    if (record.version !== 1 || typeof record.expiresAt !== 'number'
      || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()
      || record.expiresAt > Date.now() + lifetimeMs + 60_000) {
      clearStoredPreference(); return false;
    }
    return true;
  } catch { clearStoredPreference(); return false; }
}
export function readThemePreference(): ThemePreference {
  if (!getRememberPreferences()) {
    // Old releases persisted a theme automatically. Do not keep that legacy value.
    clearStoredPreference(); return 'dark';
  }
  try { return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}
export function writeThemePreference(theme: ThemePreference): void {
  if (!getRememberPreferences()) return;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); }
  catch { /* A denied preference must not interrupt playback. */ }
}
/** Returns the actual opt-in state, including storage-unavailable recovery. */
export function setRememberPreferences(enabled: boolean, theme: ThemePreference): boolean {
  if (!enabled) { clearStoredPreference(); return false; }
  try {
    localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify({ version: 1, expiresAt: Date.now() + lifetimeMs }));
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch { clearStoredPreference(); return false; }
}

