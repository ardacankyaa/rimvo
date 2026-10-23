import { test, expect, type Page } from '@playwright/test';

// Runs in the production-offline project against `vite preview` of the
// `--base=/rimvo/` build (see playwright.config.ts).

function watchPolicy(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', message => { if (/Content Security Policy|CSP violation/i.test(message.text())) problems.push(message.text()); });
  page.on('pageerror', error => problems.push(error.message));
  return problems;
}

async function loadDemos(page: Page) {
  await page.getByRole('button', { name: 'Try a mix', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play both decks', exact: true })).toBeEnabled();
}

test('the hosted build runs under its Content-Security-Policy and reopens offline', async ({ page, context }) => {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`));
  });
  const problems = watchPolicy(page);

  await page.goto('./');
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /script-src 'self'/);
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // Decoding the demos exercises the workers and audio worklets under the policy,
  // and keeps the demo audio for offline use.
  await loadDemos(page);
  await page.getByRole('button', { name: 'Play both decks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause both decks', exact: true })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Try a mix', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  // License texts are not cached, so they genuinely need the (now missing) network.
  expect(await page.evaluate(() => fetch('THIRD_PARTY_LICENSES.txt').then(() => 'loaded', () => 'offline'))).toBe('offline');
  await loadDemos(page);

  await context.setOffline(false);
  expect(problems).toEqual([]);
});
