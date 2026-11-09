import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`bidding ribbon retains neutral styling and controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/__bidding-banner-fixture', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
</script></head><body></body></html>`,
    }));
    await page.route('**/src/lib/use-feature-flags.ts*', route => route.fulfill({
      contentType: 'text/javascript', body: 'export const useFeatureFlag = () => ({enabled:true});',
    }));
    await page.route('**/src/lib/listing-auctions.ts*', route => route.fulfill({
      contentType: 'text/javascript',
      body: `export async function getTopListingBids() { return [{
        listing_id: '30000000-0000-4000-8000-000000000001', title: 'Pressure washer',
        daily_rate: 5, has_bids: false, bid_count: 0, participant_count: 0,
        start_date: '2099-01-01', end_date: '2099-01-04', expires_at: '2098-12-31T12:00:00Z', image_url: null
      }]; }
      export function subscribeToAuctionTickerUpdates() { return () => {}; }`,
    }));
    await page.goto('/__bidding-banner-fixture');
    await page.evaluate(async () => {
      const { createElement: h, mountComponent } = await import('/tests/component-mount.tsx');
      await import('/src/main-site/index.css');
      await import('/src/main-site/theme.css');
      const { ThemeProvider } = await import('/src/theme-context.tsx');
      const { BiddingTicker } = await import('/src/main-site/components/bidding-ticker.tsx');
      mountComponent(() => h(ThemeProvider, { fixedTheme: 'main' }, h(BiddingTicker)));
    });

    const ribbon = page.getByRole('region', { name: 'Live bidding' });
    const offer = ribbon.getByRole('link', { name: /Pressure washer/ });
    await expect(offer).toBeVisible();
    await expect(offer).toHaveAttribute('href', '/bidding/30000000-0000-4000-8000-000000000001');
    await expect(ribbon).toHaveCSS('background-color', 'rgb(245, 245, 245)');
    await expect(offer).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect((await ribbon.boundingBox())?.height).toBe(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await ribbon.getByRole('button', { name: 'Pause bidding ribbon motion' }).click();
    await expect(ribbon.locator('.bid-banner-track')).toHaveCSS('animation-name', 'none');
    await ribbon.getByRole('button', { name: 'Minimize bidding banner' }).click();
    await expect(offer).toBeHidden();
    await ribbon.getByRole('button', { name: 'Expand bidding banner' }).click();
    await expect(offer).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`bidding-ribbon-${width}.png`) });
  });
}
