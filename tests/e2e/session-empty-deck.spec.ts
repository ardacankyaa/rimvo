import { test, expect, type Page } from '@playwright/test';

async function requireAudio(page: Page) {
  const available = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !available, 'Windows WebKit has no Web Audio; Linux CI runs the session restoration workflow.');
  expect(available).toBe(true);
}

async function engineSnapshot(page: Page) {
  return page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
    if (!moduleUrl) throw new Error('The app engine module was not loaded.');
    const { engine } = await import(moduleUrl);
    const deck = engine.getSnapshot().decks.B;
    return {
      hasTrack: Boolean(deck.track),
      volume: deck.volume,
      gainDb: deck.gainDb,
      eqDb: deck.eqDb,
      filterValue: deck.filterValue,
      quantize: deck.quantize,
      drive: deck.fx.drive,
    };
  });
}

test('restore applies saved controls to an empty deck after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await requireAudio(page);
  await page.getByRole('button', { name: 'Try a mix', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play both decks', exact: true })).toBeEnabled();

  const engineModule = async () => page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
    if (!moduleUrl) throw new Error('The app engine module was not loaded.');
    const { engine } = await import(moduleUrl);
    engine.setVolume('B', 0);
  });
  await engineModule();
  await page.getByRole('button', { name: 'Track information B', exact: true }).click();
  await page.getByRole('button', { name: 'Unload track B', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Deck B' })).toContainText('Empty');

  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
    if (!moduleUrl) throw new Error('The app engine module was not loaded.');
    const { engine } = await import(moduleUrl);
    engine.setGainDb('B', -7);
    engine.setEqDb('B', 'low', -5);
    engine.setEqDb('B', 'mid', 2);
    engine.setFilter('B', 0.4);
    engine.setQuantize('B', true);
    engine.setFx('B', { type: 'drive', enabled: true, amount: 0.35 });
  });

  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await page.getByRole('button', { name: 'Save session on this device', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session saved');

  await page.reload();
  await requireAudio(page);
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await page.getByRole('button', { name: 'Restore saved session', exact: true }).click();
  await page.getByRole('button', { name: 'Restore session now', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session restored');

  expect(await engineSnapshot(page)).toEqual({
    hasTrack: false,
    volume: 0,
    gainDb: -7,
    eqDb: { low: -5, mid: 2, high: 0 },
    filterValue: 0.4,
    quantize: true,
    drive: { enabled: true, amount: 0.35 },
  });
});
