import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';

const bookingId = 'a5000000-0000-4000-8000-000000000001';
const wallet = {
  test_only: true, enabled: true, signup_enabled: true, verified: true,
  eligible: true, awarded: true, signup_points: 500, balance: 500,
  transactions: [{ id: 'signup', points: 500, kind: 'signup', booking_id: null, created_at: '2026-11-17T12:00:00Z' }],
};

async function prepare(page: Page) {
  await page.route('**/src/lib/supabase.ts', mockSupabaseModule);
  await page.route('**/src/auth-context.tsx', route => route.fulfill({
    contentType: 'application/javascript', body: 'export const useAuth = () => ({user:{id:"points-renter"}});',
  }));
  await page.route('**/src/router.tsx', route => route.fulfill({
    contentType: 'application/javascript', body: 'export const useRouter = () => ({navigate:() => {}});',
  }));
  await page.route('**/__rewards-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;</script></head><body></body></html>`,
  }));
  await page.goto('/__rewards-fixture');
  await page.waitForFunction(() => window.__vite_plugin_react_preamble_installed__ === true);
}

async function mount(page: Page, checkout = false) {
  await page.evaluate(async ({ checkout, bookingId }) => {
    const { mountComponent } = await import('/tests/component-mount.tsx');
    const { RewardsPanel, CheckoutRewards } = await import('/src/main-site/components/rewards.tsx');
    await import('/src/main-site/index.css');
    mountComponent(checkout ? CheckoutRewards : RewardsPanel, checkout ? { bookingId, rentalSubtotal: 10 } : {});
  }, { checkout, bookingId });
}

test('points wallet explains test-only value, history and recoverable loading errors', async ({ page }) => {
  let failed = true;
  await page.route('**/rest/v1/rpc/get_my_rewards', route => failed
    ? route.fulfill({ status: 503, json: { message: 'Rewards temporarily unavailable' } })
    : route.fulfill({ json: wallet }));
  await prepare(page);
  await mount(page);
  await expect(page.getByRole('status')).toContainText('Rewards temporarily unavailable');
  failed = false;
  await page.getByRole('button', { name: 'Retry rewards' }).click();
  await expect(page.getByText('500 PTS = $5. Free to join. No subscription.')).toBeVisible();
  await expect(page.getByText('Signup reward', { exact: true })).toBeVisible();
  await expect(page.getByText('Simulation only. Points do not reduce Stripe payments or represent cash.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('checkout spends points once and explicitly leaves the real payment unchanged', async ({ page }) => {
  let calls = 0;
  let redeemed = false;
  const paymentRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/functions/v1/')) paymentRequests.push(request.url());
  });
  await page.route('**/rest/v1/rpc/get_my_rewards', route => route.fulfill({ json: {
    ...wallet, balance: redeemed ? 0 : 500,
    transactions: redeemed ? [...wallet.transactions, {
      id: 'spend', points: -500, kind: 'redemption', booking_id: bookingId, created_at: '2026-11-17T13:00:00Z',
    }] : wallet.transactions,
  } }));
  await page.route('**/rest/v1/rpc/redeem_test_reward_points', async route => {
    expect(route.request().postDataJSON()).toEqual({ p_booking_id: bookingId });
    calls++;
    redeemed = true;
    await route.fulfill({ json: { test_only: true, points: 500, discount: 5, simulated_total: 6.77, payment_total: 11.77 } });
  });
  await prepare(page);
  await mount(page, true);
  await page.getByRole('button', { name: 'Simulate redeeming 500 points ($5)' }).click();
  await expect(page.getByRole('status')).toContainText('No discount is applied to Stripe.');
  await expect(page.getByRole('button', { name: 'Simulate redeeming 500 points ($5)' })).toHaveCount(0);
  expect(calls).toBe(1);
  expect(paymentRequests).toEqual([]);
});

async function prepareMarketing(page: Page) {
  await prepare(page);
  await page.route('**/src/auth-context.tsx', route => route.fulfill({
    contentType: 'application/javascript', body: `export const useAuth = () => ({
      user:null, error:null, signInOpen:true, passwordRecovery:false, authBusy:null,
      closeSignIn:() => {}, openSignIn:() => {window.joinCalls = (window.joinCalls || 0) + 1;},
      authenticate:async () => 'confirmation-required'
    });`,
  }));
  await page.route('**/src/lib/local-profile-login.ts', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'export const LOCAL_PROFILE_LOGIN=false, HOSTED_PROFILE_LOGIN=false; export const loadLocalProfiles=async () => [];',
  }));
}

test('local signup promotion shows verified signup terms and opens the signup entry point', async ({ page }) => {
  await prepareMarketing(page);
  await page.evaluate(async () => {
    const { mountComponent } = await import('/tests/component-mount.tsx');
    const { SignupRewardOffer } = await import('/src/main-site/components/signup-reward-offer.tsx');
    await import('/src/main-site/index.css');
    mountComponent(SignupRewardOffer);
  });
  const offer = page.getByRole('region', { name: 'YBuy signup reward' });
  await expect(offer.getByRole('heading')).toHaveText('Get rewarded just for joining!');
  await expect(offer).toContainText('verify your email and phone');
  await expect(offer).toContainText('500 PTS = $5');
  await expect(offer).toContainText('Rewards are not live');
  await offer.getByRole('button', { name: 'Join YBuy' }).click();
  expect(await page.evaluate(() => (window as Window & { joinCalls: number }).joinCalls)).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('signup dialog keeps the offer visible for registration but hides it during password reset', async ({ page }) => {
  await prepareMarketing(page);
  await page.evaluate(async () => {
    const { mountComponent } = await import('/tests/component-mount.tsx');
    const { SignInDialog } = await import('/src/main-site/components/sign-in-dialog.tsx');
    await import('/src/main-site/index.css');
    mountComponent(SignInDialog);
  });
  const dialog = page.getByRole('dialog');
  const offer = dialog.getByRole('region', { name: 'YBuy signup reward' });
  await expect(offer).toBeVisible();
  await dialog.getByRole('button', { name: 'New to YBuy? Create an account' }).click();
  await expect(dialog.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
  await expect(offer).toBeVisible();
  await dialog.getByRole('button', { name: 'Already have an account? Sign in' }).click();
  await dialog.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(offer).toHaveCount(0);
});

async function prepareCheckout(page: Page, { balance = 500, rental = 23, failFirstRedemption = false } = {}) {
  const calls = { bookings: 0, redemptions: 0 };
  const listingId = 'a4000000-0000-4000-8000-000000000001';
  const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const startDate = date(2);
  const endDate = date(3);
  const listing = {
    id: listingId, owner_id: 'a1000000-0000-4000-8000-000000000001',
    title: 'Points checkout camera', description: 'Camera for checkout points tests.',
    price_per_day: rental, deposit: 72, estimated_value: 240,
    status: 'published', instant_booking: true, created_at: '2026-11-17T12:00:00Z',
    availability_start: date(1), availability_end: date(30), listing_images: [],
    categories: { name: 'Cameras' }, owner: { full_name: 'Local owner' },
  };
  await prepare(page);
  await page.route('**/src/lib/use-feature-flags.ts', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'export const useFeatureFlag=() => ({enabled:false,loading:false,error:null}); export const useFeatureFlags=() => ({data:[],loading:false,error:null});',
  }));
  await page.route('**/rest/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/listings')) return route.fulfill({ json: listing });
    if (path.endsWith('/app_settings')) return route.fulfill({ json: { value: 0.1 } });
    if (path.endsWith('/get_listing_time_zone')) return route.fulfill({ json: 'America/Chicago' });
    if (path.endsWith('/get_listing_unavailable_dates')) return route.fulfill({ json: { blocked: [], booked: [] } });
    if (path.endsWith('/get_my_rewards')) return route.fulfill({ json: { ...wallet, balance } });
    if (path.endsWith('/create_booking_request')) {
      calls.bookings++;
      return route.fulfill({ json: {
        id: bookingId, listing_id: listingId, subtotal: rental, service_fee_amount: 2.3,
        insurance_amount: 0, tax_amount: 1.77, tax_rate: 0.07, deposit: 72, total: 27.07,
        status: 'pending_payment', payment_first: true, deposit_collection_model: 'authorization',
      } });
    }
    if (path.endsWith('/redeem_test_reward_points')) {
      calls.redemptions++;
      expect(route.request().postDataJSON()).toEqual({ p_booking_id: bookingId });
      if (failFirstRedemption && calls.redemptions === 1) {
        return route.fulfill({ status: 400, json: { message: 'Please retry points redemption' } });
      }
      return route.fulfill({ json: { test_only: true, points: 500, discount: 5, simulated_total: 22.07, payment_total: 27.07 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.evaluate(async ({ listingId, startDate, endDate }) => {
    const { mountComponent } = await import('/tests/component-mount.tsx');
    const { CheckoutPage } = await import('/src/main-site/pages/checkout.tsx');
    await import('/src/main-site/index.css');
    mountComponent(CheckoutPage, { id: listingId, startDate, endDate });
  }, { listingId, startDate, endDate });
  return calls;
}

test('checkout shows a points slider before booking and reuses the saved booking when redemption needs a retry', async ({ page }) => {
  const calls = await prepareCheckout(page, { failFirstRedemption: true });
  const picker = page.getByRole('region', { name: 'Apply YBuy Points' });
  const slider = picker.getByRole('slider', { name: 'Apply YBuy Points' });
  await expect(slider).toBeEnabled();
  await expect(slider).toHaveValue('0');
  await expect(picker).toContainText('500 points available');
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(slider).toHaveValue('500');
  await expect(picker.getByText('Simulated total after points').locator('..')).toContainText('$22.07');
  await expect(picker).toContainText('your actual payment remains $27.07');
  await slider.press('ArrowLeft');
  await expect(picker.getByText('Simulated total after points')).toHaveCount(0);
  await slider.press('ArrowRight');
  expect(calls).toEqual({ bookings: 0, redemptions: 0 });

  await page.getByRole('button', { name: 'Continue to payment', exact: true }).click();
  await expect(page.getByText('Booking saved - action required', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Please retry points redemption');
  expect(calls).toEqual({ bookings: 1, redemptions: 1 });
  await page.getByRole('button', { name: 'Continue to payment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm $27.07 and pay', exact: true })).toBeVisible();
  await expect(slider).toBeDisabled();
  await expect(picker).toContainText('500 points applied to this test booking.');
  expect(calls).toEqual({ bookings: 1, redemptions: 2 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(slider).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const scenario of [
  { balance: 499, rental: 23, reason: 'At least 500 points are required.' },
  { balance: 500, rental: 4.99, reason: 'Rental charges must be at least $5 to apply points.' },
]) {
  test(`checkout points slider rejects ${scenario.reason}`, async ({ page }) => {
    await prepareCheckout(page, scenario);
    const picker = page.getByRole('region', { name: 'Apply YBuy Points' });
    await expect(picker).toContainText(scenario.reason);
    await expect(picker.getByRole('slider')).toBeDisabled();
  });
}
