import { test, expect, type Page } from '@playwright/test';

async function openSession(page: Page) {
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
}
async function saveSession(page: Page) {
  await page.getByRole('button', { name: 'Save session on this device', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session saved');
}
async function requireAudio(page: Page) {
  const available = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !available, 'Windows WebKit has no Web Audio; Linux CI runs this restoration workflow.');
  expect(available).toBe(true);
}

test('an already open tab discovers a session saved by another tab', async ({ page, context }) => {
  await page.goto('/');
  const writer = await context.newPage();
  await writer.goto('/');
  await openSession(writer);
  await saveSession(writer);
  await openSession(page);
  await expect(page.getByRole('button', { name: 'Restore saved session', exact: true })).toBeEnabled();
  await writer.close();
});

test('an open session panel follows saves and deletions from another tab', async ({ page, context }) => {
  await page.goto('/');
  await openSession(page);
  await expect(page.getByRole('button', { name: 'Restore saved session', exact: true })).toBeDisabled();
  const writer = await context.newPage();
  await writer.goto('/');
  await openSession(writer);
  await saveSession(writer);
  // Assertions do not focus this background tab: notifications must update the already open panel.
  await expect(page.getByRole('button', { name: 'Restore saved session', exact: true })).toBeEnabled();
  await saveSession(page);
  await writer.getByRole('button', { name: 'Delete saved session', exact: true }).click();
  await writer.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(writer.getByRole('status', { name: 'Session status' })).toContainText('Saved session deleted');
  await expect(page.getByRole('button', { name: 'Restore saved session', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete saved session', exact: true })).toBeDisabled();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('No saved session is available.');
  await writer.close();
});

test('unavailable storage offers a retry without treating it as a corrupt save', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get: () => { throw new DOMException('Storage is blocked.', 'SecurityError'); } });
  });
  await page.goto('/');
  await openSession(page);
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Local session storage is unavailable');
  await expect(page.getByRole('button', { name: 'Restore saved session', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete saved session', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry session storage', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('check your browser storage settings');
});

test('blocked tab notifications do not prevent saving and deleting sessions', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: class {
      constructor() { throw new DOMException('Channels are blocked.', 'SecurityError'); }
    } });
  });
  await page.goto('/');
  await openSession(page);
  await saveSession(page);
  await page.getByRole('button', { name: 'Delete saved session', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Saved session deleted');
});

test('restore confirmation reads the latest save, including another tab changes', async ({ page, context }) => {
  await page.goto('/');
  await requireAudio(page);
  await page.getByRole('slider', { name: 'Crossfader', exact: true }).press('Home');
  await openSession(page);
  await saveSession(page);
  await page.getByRole('button', { name: 'Restore saved session', exact: true }).click();

  const writer = await context.newPage();
  await writer.goto('/');
  await writer.getByRole('slider', { name: 'Crossfader', exact: true }).press('End');
  await openSession(writer);
  await saveSession(writer);
  await page.getByRole('button', { name: 'Restore session now', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session restored');
  await expect(page.getByRole('slider', { name: 'Crossfader', exact: true })).toHaveAttribute('aria-valuenow', '1');
  await writer.close();
});

test('a corrupt save is explained and can be deleted without decoding it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('rimvo-sessions', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('sessions', 'readwrite');
        transaction.objectStore('sessions').put({ version: 999, tracks: [] }, 'latest');
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  });
  await page.reload();
  await openSession(page);
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('invalid');
  await expect(page.getByRole('button', { name: 'Restore saved session', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => { throw new DOMException('Device storage is full.', 'QuotaExceededError'); };
  });
  await page.getByRole('button', { name: 'Save session on this device', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Device storage is full.');
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('invalid');
  await page.getByRole('button', { name: 'Delete saved session', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete saved session', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Delete saved session', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Saved session deleted');
  await page.reload();
  await openSession(page);
  await expect(page.getByRole('button', { name: 'Delete saved session', exact: true })).toBeDisabled();
  await expect(page.getByRole('status', { name: 'Session status' })).not.toContainText('invalid');
});
