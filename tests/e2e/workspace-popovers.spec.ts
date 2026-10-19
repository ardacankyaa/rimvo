import { test, expect } from '@playwright/test';

test('workspace panels are exclusive and dismiss without trapping or stealing focus', async ({ page }) => {
  await page.goto('/');
  const session = page.getByRole('button', { name: 'Session tools', exact: true });
  const headphones = page.getByRole('button', { name: 'Headphone monitoring', exact: true });
  const sessionPanel = page.getByRole('region', { name: 'Session tools', exact: true });
  const headphonePanel = page.getByRole('region', { name: 'Headphone monitoring', exact: true });

  await session.click();
  await expect(sessionPanel).toBeVisible();
  await headphones.click();
  await expect(headphonePanel).toBeVisible();
  await expect(sessionPanel).toHaveCount(0);
  await expect(session).toHaveAttribute('aria-expanded', 'false');
  // Safari does not focus buttons on pointer activation. Neither browser may
  // send focus back to the panel that has just been replaced.
  await expect(session).not.toBeFocused();
  const panelId = await headphonePanel.getAttribute('id');
  expect(panelId).toBeTruthy();
  await expect(headphones).toHaveAttribute('aria-controls', panelId!);

  await headphonePanel.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(headphonePanel).toHaveCount(0);
  await expect(headphones).toBeFocused();
  await expect(headphones).toHaveAttribute('aria-expanded', 'false');

  await session.click();
  await sessionPanel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sessionPanel).toHaveCount(0);
  await expect(session).toBeFocused();

  await session.click();
  const search = page.getByRole('combobox', { name: 'Search library', exact: true });
  await search.click();
  await expect(sessionPanel).toHaveCount(0);
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');

  // Both desktop anchoring and the mobile sheet must remain within the viewport.
  await headphones.click();
  const bounds = await headphonePanel.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
});

test('Escape closes the session panel from one of its controls', async ({ page }) => {
  await page.goto('/');
  const session = page.getByRole('button', { name: 'Session tools', exact: true });
  await session.click();
  await page.getByRole('button', { name: 'Save session on this device', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Session tools', exact: true })).toHaveCount(0);
  await expect(session).toBeFocused();
});

test('keyboard focus outside closes the workspace panel and Help still dismisses with Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  const help = page.getByRole('button', { name: 'Help and keyboard shortcuts', exact: true });
  await help.focus();
  await expect(page.getByRole('region', { name: 'Session tools', exact: true })).toHaveCount(0);
  await expect(help).toBeFocused();
  await help.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(help).toBeFocused();
});

test('closing the headphone panel leaves monitoring running', async ({ page }) => {
  // The physical output and its playback are the only doubles; the monitor stream
  // still comes from the application's real Web Audio engine.
  await page.addInitScript(() => {
    const output = { deviceId: 'test-headphones', groupId: 'test-output', kind: 'audiooutput', label: 'Test headphones', toJSON() { return {}; } };
    Object.defineProperty(navigator.mediaDevices, 'selectAudioOutput', { configurable: true, value: async () => output });
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [output] });
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: async function () {} });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async function () {} });
  });
  await page.goto('/');
  const audioAvailable = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !audioAvailable, 'Windows WebKit does not expose Web Audio; Linux CI exercises this workflow.');
  const headphones = page.getByRole('button', { name: 'Headphone monitoring', exact: true });
  await headphones.click();
  await page.getByRole('button', { name: 'Choose headphone output', exact: true }).click();
  await page.getByRole('button', { name: 'Start headphone monitoring', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop headphone monitoring', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await headphones.click();
  await expect(page.getByRole('button', { name: 'Stop headphone monitoring', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Headphone cue A', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop headphone monitoring', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start headphone monitoring', exact: true })).toBeVisible();
});
