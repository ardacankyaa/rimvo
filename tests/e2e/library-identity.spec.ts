import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function chooseFile(page: Page, deck: 'A' | 'B', bytes: Buffer) {
  await page.locator(`.deck-panel-${deck} input[type=file]`).evaluate((input, data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], 'same.wav', { type: 'audio/wav', lastModified: 1234567890000 }));
    (input as HTMLInputElement).files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [...bytes]);
  await expect(page.getByRole('button', { name: `Play/Pause ${deck}`, exact: true })).toBeEnabled();
}

async function saveAndRead(page: Page) {
  await page.getByRole('button', { name: 'Save session on this device', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session saved');
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rimvo-sessions', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ names: string[]; ids: string[] }>((resolve, reject) => {
        const request = db.transaction('sessions').objectStore('sessions').get('latest');
        request.onsuccess = () => resolve({
          names: request.result.tracks.filter((track: { name: string }) => track.name === 'same.wav').map((track: { name: string }) => track.name),
          ids: [request.result.decks.A.trackId, request.result.decks.B.trackId],
        });
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

test('distinct same-metadata files stay separate through deck loading and session restore', async ({ page }) => {
  await page.goto('/');
  const audio = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !audio, 'Windows WebKit has no Web Audio; Linux CI covers this workflow.');
  expect(audio).toBe(true);
  const first = await readFile('tests/fixtures/m1-tone-440-mono-44100-pcm16.wav');
  const second = Buffer.from(first);
  second[7_000] = (second[7_000] + 1) % 256;
  await chooseFile(page, 'A', first);
  await chooseFile(page, 'B', second);
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  const before = await saveAndRead(page);
  expect(before.names).toHaveLength(2);
  expect(before.ids[0]).not.toBe(before.ids[1]);

  await page.reload();
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
  await page.getByRole('button', { name: 'Restore saved session', exact: true }).click();
  await page.getByRole('button', { name: 'Restore session now', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session restored');
  const after = await saveAndRead(page);
  expect(after.names).toHaveLength(2);
  expect(after.ids[0]).not.toBe(after.ids[1]);
});
