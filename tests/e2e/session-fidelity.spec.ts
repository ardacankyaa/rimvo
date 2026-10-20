import { test, expect, type Page } from '@playwright/test';

async function requireAudio(page: Page) {
  const available = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(process.platform === 'win32' && test.info().project.name === 'webkit' && !available, 'Windows WebKit has no Web Audio; Linux CI runs the session restoration workflow.');
  expect(available).toBe(true);
}

async function loadDemos(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await requireAudio(page);
  await page.getByRole('button', { name: 'Try a mix', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play both decks', exact: true })).toBeEnabled();
  await page.locator('.session-menu summary').click();
  await page.getByRole('button', { name: 'Start audio', exact: true }).click();
}

async function openSession(page: Page) {
  await page.getByRole('button', { name: 'Session tools', exact: true }).click();
}

async function saveSession(page: Page) {
  await page.getByRole('button', { name: 'Save session on this device', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session saved');
}

async function restoreSession(page: Page) {
  await page.getByRole('button', { name: 'Restore saved session', exact: true }).click();
  await page.getByRole('button', { name: 'Restore session now', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Session status' })).toContainText('Session restored');
}

test('session restore retains pitch mode and stored semitone value for all pitch modes', async ({ page }) => {
  await loadDemos(page);
  await openSession(page);

  for (const mode of ['tape', 'linked', 'independent'] as const) {
    const semitones = mode === 'independent' ? 3.5 : -2.5;
    await page.evaluate(async ({ mode, semitones }) => {
      const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
        .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
      if (!moduleUrl) throw new Error('The app engine module was not loaded.');
      const { engine } = await import(moduleUrl);
      engine.setPitchSemitones('A', semitones);
      engine.setPitchMode('A', mode);
    }, { mode, semitones });
    await saveSession(page);
    await page.evaluate(async () => {
      const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
        .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
      if (!moduleUrl) throw new Error('The app engine module was not loaded.');
      const { engine } = await import(moduleUrl);
      engine.setPitchMode('A', 'independent');
      engine.setPitchSemitones('A', 6);
    });

    await restoreSession(page);
    const restored = await page.evaluate(async () => {
      const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
        .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
      if (!moduleUrl) throw new Error('The app engine module was not loaded.');
      const { engine } = await import(moduleUrl);
      return { pitchMode: engine.getSnapshot().decks.A.pitchMode, pitchSemitones: engine.getSnapshot().decks.A.pitchSemitones };
    });
    expect(restored).toEqual({ pitchMode: mode, pitchSemitones: semitones });
  }
});

test('session restore keeps a beat loop’s saved bounds after the track BPM grid changes', async ({ page }) => {
  await loadDemos(page);
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
    if (!moduleUrl) throw new Error('The app engine module was not loaded.');
    const { engine } = await import(moduleUrl);
    engine.setBeatGrid('A', { bpm: 120, firstBeatSeconds: 0 });
    await engine.seekDeck('A', 0.4);
    await engine.setBeatLoop('A', 2);
    engine.setBeatGrid('A', { bpm: 60, firstBeatSeconds: 0 });
  });

  const saved = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
    if (!moduleUrl) throw new Error('The app engine module was not loaded.');
    const { engine } = await import(moduleUrl);
    const deck = engine.getSnapshot().decks.A;
    return { loop: deck.loop, loopBeats: deck.loopBeats, beatGrid: deck.beatGrid };
  });
  expect(saved.loop).toEqual({ startSeconds: 0.4, endSeconds: 1.4 });
  expect(saved.loopBeats).toBe(2);
  expect(saved.beatGrid?.bpm).toBe(60);

  await openSession(page);
  await saveSession(page);
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
    if (!moduleUrl) throw new Error('The app engine module was not loaded.');
    const { engine } = await import(moduleUrl);
    await engine.setLoop('A', null);
  });
  await restoreSession(page);

  const restored = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(url => new URL(url).pathname === '/src/state/engine.ts').at(-1);
    if (!moduleUrl) throw new Error('The app engine module was not loaded.');
    const { engine } = await import(moduleUrl);
    const deck = engine.getSnapshot().decks.A;
    return { loop: deck.loop, loopBeats: deck.loopBeats };
  });
  expect(restored).toEqual({ loop: saved.loop, loopBeats: 2 });
});
