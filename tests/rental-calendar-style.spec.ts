import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`booking calendar shows a single month and selected range at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime(new Date('2026-11-07T18:00:00Z'));
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/__rental-calendar-fixture', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
</script></head><body></body></html>`,
    }));
    await page.goto('/__rental-calendar-fixture');
    await page.evaluate(async () => {
      const { createElement: h, mountComponent } = await import('/tests/component-mount.tsx');
      await import('/src/main-site/index.css');
      await import('/src/main-site/theme.css');
      const { ThemeProvider } = await import('/src/theme-context.tsx');
      const { RentalCalendarHarness } = await import('/tests/rental-calendar-harness.tsx');
      mountComponent(() => h(ThemeProvider, { fixedTheme: 'main' }, h(RentalCalendarHarness)));
    });

    const trigger = page.getByRole('button', { name: /^Choose a date range/ });
    await trigger.click();
    const calendar = page.getByRole('dialog', { name: 'Choose rental dates' });
    await expect(calendar).toContainText('November 2026');
    await expect(calendar.locator('.calendar-months > div')).toHaveCount(1);
    await expect(calendar.getByRole('button', { name: /Friday, November 20, 2026/ })).toBeDisabled();
    const pickup = calendar.getByRole('button', { name: /Wednesday, November 11, 2026/ });
    const middle = calendar.getByRole('button', { name: /Thursday, November 12, 2026/ });
    const returnDate = calendar.getByRole('button', { name: /Thursday, November 19, 2026/ });
    await pickup.click();
    await returnDate.click();
    await expect(pickup).toHaveCSS('background-color', 'rgb(32, 88, 73)');
    await expect(middle).toHaveCSS('background-color', 'rgb(237, 243, 234)');
    await expect(returnDate).toHaveCSS('background-color', 'rgb(32, 88, 73)');
    const box = await calendar.boundingBox();
    expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 900).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`rental-calendar-${width}.png`) });
    await calendar.getByRole('button', { name: 'Done' }).click();
    await expect(trigger).toContainText('Nov 11');
    await expect(trigger).toContainText('Nov 19');

    await trigger.click();
    await calendar.getByRole('button', { name: 'Next month' }).click();
    await expect(calendar).toContainText('December 2026');
    await calendar.getByRole('button', { name: 'Previous month' }).click();
    await calendar.getByRole('button', { name: 'Reset' }).click();
    await calendar.getByRole('button', { name: 'Done' }).click();
    await expect(trigger).toContainText('Add date');
    await expect(trigger).toBeFocused();
  });
}
