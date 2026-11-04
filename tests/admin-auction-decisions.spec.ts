import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`admin decision audit shows records and handles pagination and retry at ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/__admin-decisions', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
</script></head><body></body></html>` }));
    await page.route('**/src/admin/api.ts*', route => route.fulfill({
      contentType: 'text/javascript', body: `export async function listAuctionDecisions(limit,offset,filters={}){
        const response=await fetch('/__decision-list?limit='+limit+'&offset='+offset+'&search='+encodeURIComponent(filters.search||'')+'&owner='+encodeURIComponent(filters.ownerId||''));
        if(!response.ok) throw new Error('Decision audit unavailable');
        return response.json();
      }
      export const useAdminAccess=()=>({access:{permissions:window.__plainAdmin?['users.manage']:['config.manage','users.manage']}});
      export async function listUsers(args){const response=await fetch('/__user-list?search='+encodeURIComponent(args.search));return response.json();}
      export const listBookings=listUsers,listListings=listUsers,listPayments=listUsers,listPayouts=listUsers,listReviews=listUsers,
      removeReview=listUsers,setListingSuspension=listUsers,setUserRestriction=listUsers,listCheckoutExceptions=listUsers,
      getListingPublicationReview=listUsers,approveListingPublication=listUsers;`,
    }));
    let fail = false;
    let empty = false;
    const offsets: number[] = [];
    const filters: { search: string | null; owner: string | null; offset: number }[] = [];
    await page.route('**/__decision-list?*', route => {
      const params = new URL(route.request().url()).searchParams;
      const offset = Number(params.get('offset'));
      filters.push({ search: params.get('search'), owner: params.get('owner'), offset });
      offsets.push(offset);
      if (fail) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { total: empty ? 0 : 21, rows: empty ? [] : [{
        id: `event-${offset}`, listing_id: 'listing-id', listing_title: offset ? 'Second page camera' : 'Travel camera',
        owner_id: 'owner-id', owner_name: 'Test Owner', customer_id: 'YB-0000000001', deadline_at: '2026-11-03T22:00:00Z',
        detected_at: '2026-11-03T22:00:01Z', eligible_bid_count: 3, owner_missed_decision_count: 2,
        rating_eligible: true, exclusion_reason: null, exclusion_detail: null,
      }] } });
    });
    await page.goto('/__admin-decisions');
    await page.evaluate(async () => {
      const { createElement: h, mountComponent } = await import('/tests/component-mount.tsx');
      await import('/src/main-site/index.css');
      await import('/src/main-site/theme.css');
      const { ThemeProvider } = await import('/src/theme-context.tsx');
      const { AuctionDecisionsSection } = await import('/src/admin/pages/auction-decisions.tsx');
      mountComponent(() => h(ThemeProvider, { fixedTheme: 'main' }, h(AuctionDecisionsSection)));
    });
    await expect(page.getByRole('heading', { name: 'Missed bidding decisions', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Travel camera listing-id' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Owner missed decisions' })).toBeVisible();
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.getByText('Second page camera', { exact: true })).toBeVisible();
    expect(offsets).toEqual([0, 20]);
    await page.getByRole('searchbox', { name: 'Owner, email, Customer ID or listing' }).fill('YB-0000000001');
    await expect.poll(() => filters.at(-1)).toEqual({ search: 'YB-0000000001', owner: '', offset: 0 });
    await expect(page.getByText('Travel camera', { exact: true })).toBeVisible();
    fail = true;
    await page.getByRole('button', { name: 'Refresh decisions' }).click();
    await expect(page.getByText('Decision audit unavailable', { exact: true })).toBeVisible();
    fail = false;
    empty = true;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'No missed bidding decisions' })).toBeVisible();
    empty = false;
    await page.route('**/__user-list?*', route => route.fulfill({ json: { total: 1, rows: [{
      id: 'owner-id', full_name: 'Test Owner', email: 'owner@example.test', customer_id: 'YB-0000000001',
      created_at: '2026-11-01T10:00:00Z', listing_count: 1, is_admin: false, restricted_at: null,
      missed_decision_count: 2, last_missed_decision_at: '2026-11-03T22:00:01Z',
    }] } }));
    await page.evaluate(async () => {
      const { createElement: h, mountComponent } = await import('/tests/component-mount.tsx');
      const { ThemeProvider } = await import('/src/theme-context.tsx');
      const { UsersSection } = await import('/src/admin/pages/resources.tsx');
      mountComponent(() => h(ThemeProvider, { fixedTheme: 'main' }, h(UsersSection)));
    });
    await expect(page.getByText('2 missed bidding decisions', { exact: true })).toBeVisible();
    await expect(page.getByText('access active', { exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Name, email or Customer ID' }).fill('YB-0000000001');
    await page.getByRole('button', { name: 'Bidding history', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Bidding history: Test Owner' });
    await expect(history).toContainText('Missed decisions do not automatically restrict an account');
    await expect(history.getByText('Travel camera', { exact: true })).toBeVisible();
    await expect.poll(() => filters.at(-1)).toEqual({ search: '', owner: 'owner-id', offset: 0 });
    await history.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(async () => {
      Object.assign(window, { __plainAdmin: true });
      const { createElement: h, mountComponent } = await import('/tests/component-mount.tsx');
      const { ThemeProvider } = await import('/src/theme-context.tsx');
      const { UsersSection } = await import('/src/admin/pages/resources.tsx');
      mountComponent(() => h(ThemeProvider, { fixedTheme: 'main' }, h(UsersSection)));
    });
    await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bidding history', exact: true })).toHaveCount(0);
    await expect(page.getByText('2 missed bidding decisions', { exact: true })).toHaveCount(0);
  });
}
