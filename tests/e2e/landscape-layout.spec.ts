import { test, expect } from '@playwright/test';

for (const [width, height] of [[667, 375], [844, 390], [932, 430]]) {
  test(`landscape controls stay inside their panels at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width: height, height: width });
    await page.goto('/');
    await page.setViewportSize({ width, height });
    await expect(page.locator('.deck-panel-A')).toBeVisible();

    const layout = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      };
      return {
        viewportWidth: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        deckA: bounds('.deck-panel-A'),
        deckB: bounds('.deck-panel-B'),
        controls: ['.jog-wheel', '.transport-row', '.deck-performance__tools'].flatMap(control =>
          ['A', 'B'].map(deck => ({ deck, control, rect: bounds(`.deck-panel-${deck} ${control}`) }))),
        dock: bounds('.tools-dock'),
      };
    });

    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
    for (const { deck, control, rect } of layout.controls) {
      const panel = deck === 'A' ? layout.deckA : layout.deckB;
      expect(rect.top, `${deck} ${control} top`).toBeGreaterThanOrEqual(panel.top - 1);
      expect(rect.bottom, `${deck} ${control} bottom`).toBeLessThanOrEqual(panel.bottom + 1);
      expect(rect.left, `${deck} ${control} left`).toBeGreaterThanOrEqual(panel.left - 1);
      expect(rect.right, `${deck} ${control} right`).toBeLessThanOrEqual(panel.right + 1);
    }
    expect(layout.dock.top).toBeGreaterThanOrEqual(layout.deckA.bottom);
  });
}
