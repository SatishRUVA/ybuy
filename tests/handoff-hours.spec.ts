import { expect, test } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';

test.use({ timezoneId: 'Asia/Tokyo' });
test.setTimeout(120_000);

for (const kind of ['pickup', 'return'] as const) {
  test(`same-day ${kind} hides past hours and hours the owner does not offer`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: kind === 'pickup' ? 1440 : 390, height: 900 });
    await page.clock.install({ time: new Date('2026-11-04T16:20:00Z') });
    await page.addInitScript(() => Object.assign(globalThis, {
      $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type,
      __vite_plugin_react_preamble_installed__: true,
    }));
    await page.route('**/src/lib/supabase.ts*', mockSupabaseModule);
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    const bookingId = '81000000-0000-4000-8000-000000000001';
    let serverNow = '2026-11-04T16:20:00Z';
    let mutation: Record<string, unknown> | undefined;
    await page.route('**/rest/v1/rpc/get_booking_precheckin', route => route.fulfill({ json: {
      payment_first: true, slot: null, pickup_slot: null, return_slot: null,
      pickup_windows: ['morning', 'evening'], return_windows: ['morning', 'evening'],
      return_rules: [], return_note: '', time_zone: 'America/Chicago', server_now: serverNow,
      can_authorize: false, handoff_ready: false, return_handoff_ready: false,
      deposit_ready: true, consented: false, delivery_mode: 'pickup',
    } }));
    await page.route('**/rest/v1/rpc/propose_booking_handoff_slot_at_hour', route => {
      mutation = route.request().postDataJSON();
      return route.fulfill({ json: null });
    });
    await page.route('**/src/main.tsx*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `import React from '/node_modules/.vite/deps/react.js';
        import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
        import '/src/main-site/index.css';
        import '/src/main-site/theme.css';
        import { BookingPrecheckin } from '/src/main-site/components/booking-precheckin.tsx';
        document.documentElement.dataset.theme='main';
        ReactDOM.createRoot(document.getElementById('root')).render(
          React.createElement('main',{className:'main-site max-w-2xl mx-auto p-4'},
          React.createElement(BookingPrecheckin,{kind:'${kind}',onReady:()=>{},booking:{
            id:'${bookingId}',isOwner:false,status:'${kind === 'pickup' ? 'confirmed' : 'active'}',
            startDate:'${kind === 'pickup' ? '2026-11-04' : '2026-11-03'}',endDate:'${kind === 'return' ? '2026-11-04' : '2026-11-05'}',
            deposit:0,deliveryMode:'pickup'}})));`,
    }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: '11 am', exact: true })).toBeVisible({ timeout: 30_000 });
    for (const hour of ['7 am', '8 am', '9 am', '10 am', '12 pm', '1 pm']) {
      await expect(page.getByRole('button', { name: hour, exact: true })).toHaveCount(0);
    }
    for (const hour of ['5 pm', '6 pm', '7 pm']) {
      await expect(page.getByRole('button', { name: hour, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: '11 am', exact: true }).click();
    await expect(page.getByRole('button', { name: '11 am', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '11 am', exact: true })).toHaveCSS('background-color', 'rgb(17, 17, 17)');
    await page.getByLabel('Optional note', { exact: true }).fill('Please include the case.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`hourly-${kind}.png`), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Send proposal', exact: true }).click();
    await expect.poll(() => mutation).toEqual({
      p_booking_id: bookingId, p_kind: kind, p_slot_window: 'morning', p_hour: 11, p_note: 'Please include the case.',
    });
    serverNow = '2026-11-04T17:00:00Z';
    await page.clock.runFor(15001);
    await expect(page.getByRole('button', { name: '11 am', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send proposal', exact: true })).toBeDisabled();
    serverNow = '2026-11-05T01:20:00Z';
    await page.clock.runFor(15001);
    await expect(page.getByText(/No future owner-available times remain/)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Evening', exact: true })).toHaveCount(0);
  });
}

test('handoff hours follow location-local dates, midnight, future days and DST', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { availableHandoffHours } = await import('/src/lib/handoff-hours.ts');
    return {
      today: availableHandoffHours('2026-11-04', 'morning', 'America/Chicago', new Date('2026-11-04T16:20:00Z')),
      tomorrow: availableHandoffHours('2026-11-05', 'morning', 'America/Chicago', new Date('2026-11-04T16:20:00Z')),
      midnight: availableHandoffHours('2026-11-05', 'morning', 'America/Chicago', new Date('2026-11-05T06:00:00Z')),
      pastDay: availableHandoffHours('2026-11-03', 'evening', 'America/Chicago', new Date('2026-11-04T16:20:00Z')),
      end: availableHandoffHours('2026-11-04', 'evening', 'America/Chicago', new Date('2026-11-05T01:00:00Z')),
      dst: availableHandoffHours('2027-03-14', 'morning', 'America/New_York', new Date('2027-03-14T14:20:00Z')),
    };
  });
  expect(result).toEqual({
    today: [11], tomorrow: [7, 8, 9, 10, 11], midnight: [7, 8, 9, 10, 11],
    pastDay: [], end: [], dst: [11],
  });
});
