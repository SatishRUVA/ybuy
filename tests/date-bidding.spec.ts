import { expect, test } from '@playwright/test';

const auction = {
  id: '60000000-0000-4000-8000-000000000001', listing_id: '30000000-0000-4000-8000-000000000001',
  date_flexible: true, status: 'open', start_date: '2026-11-10', end_date: '2026-11-20',
  ends_at: '2026-11-09T10:00:00Z', server_now: '2026-11-03T12:00:00Z',
  minimum_increment: 1, minimum_next_bid: 10, participant_count: 2, total_bid_count: 2,
  top_bids: [{ id: 'bid-a', rank: 1, daily_rate: 30, total_value: 150, start_date: '2026-11-10', end_date: '2026-11-15', bid_count: 1 },
    { id: 'bid-b', rank: 2, daily_rate: 40, total_value: 80, start_date: '2026-11-11', end_date: '2026-11-13', bid_count: 1 }],
  my_bids: [], my_bid_count: 0, my_booking_id: null, is_owner: false,
};

for (const width of [1440, 390]) {
  test(`fixed-date bidding shows a read-only calendar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/__fixed-bidding-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
</script></head><body></body></html>` }));
    await page.route('**/src/auth-context.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: 'export const useAuth = () => ({user:null,openSignIn:()=>{}});' }));
    await page.route('**/src/router.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: 'export const useRouter = () => ({navigate:()=>{}});' }));
    await page.route('**/src/lib/listing-auctions.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `export async function getListingAuction(){return ${JSON.stringify({ ...auction, date_flexible: false, end_date: '2026-12-03' })};} export async function placeListingAuctionBid(){throw new Error('Read-only calendar must not submit a bid');}` }));
    await page.goto('/__fixed-bidding-fixture');
    await page.evaluate(async listingId => {
      const { createElement: h, mountComponent } = await import('/tests/component-mount.tsx');
      await import('/src/index.css');
      await import('/src/main-site/index.css');
      await import('/src/main-site/theme.css');
      const { ThemeProvider } = await import('/src/theme-context.tsx');
      const { ListingAuctionPanel } = await import('/src/main-site/components/listing-auction-panel.tsx');
      mountComponent(() => h(ThemeProvider, { fixedTheme: 'main' }, h(ListingAuctionPanel, { listingId })));
    }, auction.listing_id);
    const calendar = page.getByRole('region', { name: 'Auction rental calendar' });
    await expect(calendar).toBeVisible();
    await expect(calendar).toContainText('These dates are fixed by the owner.');
    await expect(calendar.getByRole('button', { name: /November 10, 2026, start date/ })).toBeDisabled();
    await expect(calendar.getByRole('button', { name: /November 11, 2026, within selected range/ })).toHaveAttribute('aria-pressed', 'true');
    await calendar.getByRole('button', { name: 'Next rental month' }).click();
    await expect(calendar.getByRole('button', { name: /December 3, 2026, end date/ })).toBeDisabled();
    await expect(calendar.getByRole('button', { name: 'Next rental month' })).toBeDisabled();
    await calendar.getByRole('button', { name: 'Previous rental month' }).click();
    await expect(calendar).toContainText('November 2026');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`renter-selected date bidding calculates exclusive days and submits dates at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
    await page.setViewportSize({ width, height: 900 });
    const calls: Record<string, unknown>[] = [];
    const quotes: Record<string, unknown>[] = [];
    await page.route('**/__date-bidding-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
</script></head><body></body></html>` }));
    await page.route('**/src/auth-context.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: `export const useAuth = () => ({user:{id:'renter'},openSignIn:()=>{}});` }));
    await page.route('**/src/router.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: 'export const useRouter = () => ({navigate:route=>{window.__bidRoute=route;}});' }));
    await page.route('**/src/lib/availability.ts*', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function fetchUnavailableDates(){return {blocked:new Set(["2026-11-19"]),booked:new Set()};}' }));
    await page.route('**/src/lib/listing-auctions.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `const auction=${JSON.stringify(auction)}; export async function getListingAuction(listingId,range){if(range){await fetch('/__date-quote',{method:'POST',body:JSON.stringify({listingId,range})});return {...auction,minimum_next_bid:20};}return auction;}
export async function placeListingAuctionBid(listingId,rate,key,consent,range){await fetch('/__date-bid',{method:'POST',body:JSON.stringify({listingId,rate,key,consent,range})});return {...auction,my_bid_count:1,my_bids:[
{id:'selected-a',daily_rate:35,total_value:105,start_date:'2026-11-10',end_date:'2026-11-13',selected:true,booking_id:'booking-a',payment_status:'pending',payment_deadline:'2026-11-04T12:00:00Z'},
{id:'selected-b',daily_rate:35,total_value:70,start_date:'2026-11-15',end_date:'2026-11-17',selected:true,booking_id:'booking-b',payment_status:'paid'}
]};}` }));
    await page.route('**/__date-bid', async route => { calls.push(route.request().postDataJSON()); await route.fulfill({ json: {} }); });
    await page.route('**/__date-quote', async route => { quotes.push(route.request().postDataJSON()); await route.fulfill({ json: {} }); });
    await page.goto('/__date-bidding-fixture');
    await page.evaluate(async initialAuction => {
      const { createElement: h, mountComponent } = await import('/tests/component-mount.tsx');
      await import('/src/index.css');
      await import('/src/main-site/index.css');
      await import('/src/main-site/theme.css');
      const { ThemeProvider } = await import('/src/theme-context.tsx');
      const { DateBiddingPanel } = await import('/src/main-site/components/date-bidding-panel.tsx');
      mountComponent(() => h(ThemeProvider, { fixedTheme: 'main' },
        h(DateBiddingPanel, { listingId: initialAuction.listing_id, initialAuction, deposit: 0, listedPrice: 45 })));
    }, auction);
    await expect(page.getByLabel('Rental pickup', { exact: true })).toBeEnabled();
    await page.getByLabel('Rental pickup', { exact: true }).fill('2026-11-10');
    await page.getByLabel('Rental return', { exact: true }).fill('2026-11-13');
    await expect(page.getByText('Minimum $20.00/day for these dates.', { exact: false })).toBeVisible();
    await page.getByLabel('Your competitive bid per day (USD)', { exact: true }).fill('35');
    await expect(page.getByText('$105.00', { exact: true })).toBeVisible();
    await expect(page.getByText('Rental-price savings: $30.00', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Submit Bid', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Bid saved for' })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ rate: 35, consent: false, range: { start: '2026-11-10', end: '2026-11-13' } });
    expect(calls[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(quotes.at(-1)).toEqual({ listingId: auction.listing_id, range: { start: '2026-11-10', end: '2026-11-13' } });
    await expect(page.getByText('Payment: pending', { exact: false })).toBeVisible();
    await expect(page.getByText('Payment: paid', { exact: true })).toBeVisible();
    for (const [dates, id] of [['Nov 10, 2026 – Nov 13, 2026', 'booking-a'], ['Nov 15, 2026 – Nov 17, 2026', 'booking-b']]) {
      await page.getByRole('button', { name: `View booking for ${dates}`, exact: true }).click();
      expect(await page.evaluate(() => Reflect.get(window, '__bidRoute'))).toEqual({ name: 'confirmation', id });
    }
    await page.screenshot({ path: testInfo.outputPath(`date-bidding-${width}.png`), fullPage: true });
    await page.getByLabel('Rental pickup', { exact: true }).fill('2026-11-18');
    await page.getByLabel('Rental return', { exact: true }).fill('2026-11-20');
    await page.getByRole('button', { name: 'Submit Bid', exact: true }).click();
    await expect(page.getByText('Some selected dates are unavailable. Choose another range.', { exact: true })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
