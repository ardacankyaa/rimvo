import { test, expect, type Page } from '@playwright/test';

async function requireAudio(page: Page) {
  const available = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !available, 'The Windows Playwright WebKit runtime does not expose Web Audio. Linux CI runs the audio workflows.');
  expect(available).toBe(true);
}

test('deck panels show elapsed time while the records play', async ({ page }) => {
  await page.goto('/');
  await requireAudio(page);
  await page.getByRole('button', { name: 'Try a mix', exact: true }).click();
  await page.getByRole('button', { name: 'Play both decks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause both decks', exact: true })).toBeVisible();
  const elapsed = page.locator('.deck-panel-A .deck-track__progress span').first();
  await expect(elapsed).not.toHaveText('00:00', { timeout: 5000 });
  const progress = await page.locator('.deck-panel-A .deck-track__progress i').evaluate(bar => parseFloat(getComputedStyle(bar).getPropertyValue('--track-progress')));
  expect(progress).toBeGreaterThan(0);
});

test('AltGr-typed brackets still move the crossfader', async ({ page }) => {
  await page.goto('/');
  const crossfader = page.getByRole('slider', { name: 'Crossfader', exact: true });
  const before = Number(await crossfader.getAttribute('aria-valuenow'));
  // Turkish and many European layouts type [ with AltGr, which Windows reports as Ctrl+Alt.
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '[', code: 'Digit8', ctrlKey: true, altKey: true, modifierAltGraph: true, bubbles: true } as KeyboardEventInit)));
  await expect.poll(async () => Number(await crossfader.getAttribute('aria-valuenow'))).toBeLessThan(before);
  // A real Ctrl+Alt shortcut without AltGr is left to the browser.
  const afterAltGr = Number(await crossfader.getAttribute('aria-valuenow'));
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ']', ctrlKey: true, altKey: true, bubbles: true })));
  await page.waitForTimeout(200);
  expect(Number(await crossfader.getAttribute('aria-valuenow'))).toBe(afterAltGr);
});

test('the demo replacement control is named by its visible text', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Audio session and demo tracks', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace both with demos', exact: true })).toBeVisible();
});

test('a 1024×768 desktop shows the whole console without page scrolling', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile-chromium', 'Phone layouts scroll by design.');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await requireAudio(page);
  await page.getByRole('button', { name: 'Try a mix', exact: true }).click();
  await expect(page.locator('.waveform-bank--welcome')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(overflow).toBeLessThanOrEqual(0);
});
