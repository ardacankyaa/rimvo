import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    await info.attach('visible-console', { body: await page.locator('body').innerText(), contentType: 'text/plain' });
  }
});

async function requireAudio(page: Page) {
  const available = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !available, 'The Windows Playwright WebKit runtime does not expose Web Audio. Linux CI runs the audio workflows.');
  expect(available).toBe(true);
}

async function demos(page: Page) {
  await page.goto('/');
  await requireAudio(page);
  await page.getByRole('button', { name: 'Try a mix', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play both decks', exact: true })).toBeEnabled();
}
async function take(page: Page) {
  await demos(page);
  await page.getByRole('button', { name: 'Play both decks', exact: true }).click();
  await page.getByRole('button', { name: 'Start mix recording', exact: true }).click();
  await expect(page.getByLabel('Recording time remaining')).toBeVisible();
  await page.waitForTimeout(1200); // Capture real audio frames, rather than a synthetic recorder stub.
  await page.getByRole('button', { name: 'Stop mix recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save mix', exact: true })).toBeEnabled();
}

test('unsaved take survives cancelling discard and downloads as WAV and MP3', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await take(page);
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await expect(page.getByText('Discard this unsaved recording?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep take', exact: true }).click();
  const wav = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save mix', exact: true }).click();
  expect((await wav).suggestedFilename()).toMatch(/\.wav$/);
  await page.getByLabel('Download format', { exact: true }).selectOption('mp3');
  await expect(page.getByRole('button', { name: 'Save mix', exact: true })).toBeEnabled();
  const mp3 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save mix', exact: true }).click();
  expect((await mp3).suggestedFilename()).toMatch(/\.mp3$/);
  expect(errors).toEqual([]);
});

test('saved session restores decks, mixer, hot cue and stopped recording without auto-play', async ({ page }) => {
  await take(page);
  await page.getByRole('button', { name: 'Close mix recorder', exact: true }).click();
  await page.locator('.deck-panel-A').press('1');
  await page.getByRole('slider', { name: 'Crossfader', exact: true }).press('Home');
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await page.getByRole('button', { name: 'Save session on this device', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session saved');
  page.once('dialog', dialog => void dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await page.getByRole('button', { name: 'Restore saved session', exact: true }).click();
  await page.getByRole('button', { name: 'Restore session now', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session restored');
  await expect(page.getByRole('button', { name: 'Play both decks', exact: true })).toBeEnabled();
  await expect(page.getByRole('slider', { name: 'Crossfader', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('button', { name: 'Open recorded mix', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause both decks', exact: true })).toHaveCount(0);
  await page.getByRole('region', { name: 'Session tools', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Tools A', exact: true }).click();
  await page.getByRole('tab', { name: 'Cues', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Hot cue 1 A/ })).toHaveAttribute('aria-pressed', 'true');
});

test('language switch updates labels, persists and fits the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('tr');
  await expect(page.getByRole('button', { name: 'Bir miks dene', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Bir miks dene', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => {
    const toolbar = document.querySelector('.workspace-tools')!.getBoundingClientRect();
    return [...document.querySelectorAll('.waveform-bank,.console-grid,.tools-dock,.session-footer')].every(element => {
      const rect = element.getBoundingClientRect();
      return toolbar.bottom <= rect.top || toolbar.top >= rect.bottom;
    });
  })).toBe(true);
  await page.getByRole('combobox', { name: 'Dil', exact: true }).selectOption('en');
  await expect(page.getByRole('button', { name: 'Try a mix', exact: true })).toBeVisible();
});

test('local WAV, MP3 and FLAC files load and a local track survives session restore', async ({ page }) => {
  await page.goto('/');
  await requireAudio(page);
  for (const filename of ['m1-tone-440-stereo-48000-pcm16.wav', 'm1-tone-440-stereo-48000-vbr.mp3', 'm1-tone-440-stereo-48000.flac']) {
    await page.getByLabel('Add local files', { exact: true }).setInputFiles(path.resolve('tests/fixtures', filename));
    const row = page.locator('.library-track-local').last();
    await row.locator('.library-load-button').first().click();
    await expect(page.getByRole('button', { name: 'Play/Pause A', exact: true })).toBeEnabled();
    await expect(row.locator('.library-load-button').first()).toHaveAttribute('data-loaded', 'true');
  }
  const title = await page.locator('.deck-panel-A h3').innerText();
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await page.getByRole('button', { name: 'Save session on this device', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session saved');
  await page.reload();
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await page.getByRole('button', { name: 'Restore saved session', exact: true }).click();
  await page.getByRole('button', { name: 'Restore session now', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session restored');
  await expect(page.locator('.deck-panel-A h3')).toHaveText(title);
  await expect(page.locator('.library-track-local')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Play/Pause A', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('corrupt audio produces an actionable error while the console remains usable', async ({ page }) => {
  await page.goto('/');
  await requireAudio(page);
  await page.getByLabel('Add local files', { exact: true }).setInputFiles(path.resolve('tests/fixtures/m1-corrupt.wav'));
  await page.locator('.library-track-local .library-load-button').first().click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try a mix', exact: true })).toBeEnabled();
});

test('unsupported headphone routing explains the limitation without disabling the mixer', async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Headphone monitoring', exact: true }).click();
  await expect(page.getByText('Separate headphone output is not supported in this browser. The main mixer still works.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try a mix', exact: true })).toBeEnabled();
});

test('missing Web Audio gives a visible explanation and leaves file controls available', async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'AudioContext'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a mix', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('Web Audio is unavailable');
  await expect(page.getByRole('button', { name: 'Add your tracks', exact: true })).toBeEnabled();
});

test('restoring over another stopped take replaces cached exports and protects the restored take', async ({ page }) => {
  await take(page);
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save mix', exact: true }).click();
  const original = await readFile((await (await originalDownload).path())!);
  await page.getByRole('button', { name: 'Close mix recorder', exact: true }).click();
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await page.getByRole('button', { name: 'Save session on this device', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session saved');
  await page.getByRole('region', { name: 'Session tools', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open recorded mix', exact: true }).click();
  await page.getByRole('button', { name: 'Record new version', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.getByRole('button', { name: 'Stop mix recording', exact: true }).waitFor();
  await page.waitForTimeout(1700);
  await page.getByRole('button', { name: 'Stop mix recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save mix', exact: true })).toBeEnabled();
  const secondDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save mix', exact: true }).click();
  expect((await readFile((await (await secondDownload).path())!)).equals(original)).toBe(false);
  await page.getByRole('button', { name: 'Close mix recorder', exact: true }).click();
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await page.getByRole('button', { name: 'Restore saved session', exact: true }).click();
  await page.getByRole('button', { name: 'Restore session now', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session restored');
  await page.getByRole('region', { name: 'Session tools', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open recorded mix', exact: true }).click();
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await expect(page.getByText('Discard this unsaved recording?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep take', exact: true }).click();
  const restoredDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save mix', exact: true }).click();
  expect((await readFile((await (await restoredDownload).path())!)).equals(original)).toBe(true);
});
