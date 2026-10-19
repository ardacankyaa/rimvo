import { expect, test } from '@playwright/test';
import path from 'node:path';

test('corrupt local audio reports a Turkish error while preserving its title', async ({ page }) => {
  await page.goto('/');
  const available = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !available, 'Windows WebKit does not expose Web Audio; Linux CI exercises this workflow.');
  expect(available).toBe(true);
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('tr');
  await page.getByLabel('Yerel dosya ekle', { exact: true }).setInputFiles(path.resolve('tests/fixtures/m1-corrupt.wav'));
  const row = page.locator('.library-track-local');
  await expect(row).toHaveCount(1);
  await row.locator('.library-load-button').first().click();
  await expect(page.getByRole('alert').first()).toContainText('WAV dosyasındaki bir bölüm dosya sınırını aşıyor.');
  const alert = page.locator('.dock-error');
  await expect(alert).toContainText('m1-corrupt');
  await expect(alert).toContainText('A kanalına yüklenemedi.');
  await expect(alert).toContainText('WAV dosyasındaki bir bölüm dosya sınırını aşıyor.');
  await expect(alert).not.toContainText('Could not load');
  await expect(page.getByRole('button', { name: 'Bir miks dene', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Dil', exact: true }).selectOption('en');
  await expect(alert).toContainText('Could not load m1-corrupt');
  await expect(alert).toContainText('A WAV chunk extends beyond the file.');
});
