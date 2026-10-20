import { test, expect } from '@playwright/test';
import path from 'node:path';

test('BPM settings stay clickable above the workspace toolbar on a short desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const audioAvailable = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !audioAvailable, 'Windows WebKit has no Web Audio; Linux CI exercises this workflow.');
  expect(audioAvailable).toBe(true);
  await page.locator('.deck-panel-A input[type=file]').setInputFiles(path.resolve('tests/fixtures/m1-tone-440-mono-44100-pcm16.wav'));
  await expect(page.getByRole('button', { name: 'Play/Pause A', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Tools A', exact: true }).click();
  await page.getByLabel('Adjust BPM A', { exact: true }).click();
  const popup = page.locator('.bpm-control[open]');
  await popup.getByRole('button', { name: 'Track BPM', exact: true }).click({ timeout: 5000 });
  await page.getByLabel('Track BPM A', { exact: true }).fill('120');
  await popup.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Original BPM A', { exact: true })).toHaveText('120.0');
  await popup.getByRole('button', { name: 'Close tuning A', exact: true }).click();
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save session on this device', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Session tools', exact: true })).toHaveCount(0);
});
