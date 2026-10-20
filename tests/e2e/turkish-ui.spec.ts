import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test.use({ locale: 'en-US' });

async function requireAudio(page: Page) {
  const available = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !available, 'The Windows Playwright WebKit runtime does not expose Web Audio.');
  expect(available).toBe(true);
}

test('Turkish library search follows the app language and keeps the uploaded filename', async ({ page }) => {
  await page.goto('/');
  await requireAudio(page);
  const audio = await readFile(path.resolve('tests/fixtures/m1-tone-440-mono-44100-pcm16.wav'));
  await page.getByLabel('Add local files', { exact: true }).setInputFiles([
    { name: 'Işık.wav', mimeType: 'audio/wav', buffer: audio },
    { name: 'İstanbul.wav', mimeType: 'audio/wav', buffer: audio },
  ]);

  const rows = page.locator('.library-track-local');
  const lightRow = rows.filter({ hasText: 'Işık' });
  const cityRow = rows.filter({ hasText: 'İstanbul' });
  await expect(rows).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Search library', exact: true }).fill('ışık');
  await expect(page.getByRole('status').filter({ hasText: 'No matching tracks' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('tr');
  const search = page.getByRole('combobox', { name: 'Kütüphanede ara', exact: true });
  await search.click();
  await expect(lightRow).toBeVisible();
  await expect(lightRow.locator('strong')).toContainText('Işık');
  await expect(cityRow).toHaveCount(0);
  await expect(search).toHaveAttribute('placeholder', 'Müzik ara');

  await search.fill('IŞIK');
  await expect(lightRow).toBeVisible();
  await search.fill('istanbul');
  await expect(cityRow).toBeVisible();
  await expect(cityRow.locator('strong')).toContainText('İstanbul');

  await page.getByRole('combobox', { name: 'Dil', exact: true }).selectOption('en');
  const englishSearch = page.getByRole('combobox', { name: 'Search library', exact: true });
  await englishSearch.click();
  await expect(englishSearch).toHaveAttribute('placeholder', 'Search music');
  await expect(page.getByRole('status').filter({ hasText: 'No matching tracks' })).toBeVisible();
});
