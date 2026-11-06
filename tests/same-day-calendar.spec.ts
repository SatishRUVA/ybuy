import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'Asia/Tokyo' });
test.setTimeout(120_000);

for (const surface of ['main-site', ''] as const) {
  for (const owner of [true, false]) {
    test(`${surface || 'preview'} ${owner ? 'owner listing' : 'renter booking'} accepts pickup-local today`, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-05T00:30:00Z'));
      await page.addInitScript(() => Object.assign(globalThis, {
        $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type,
        __vite_plugin_react_preamble_installed__: true,
      }));
      const path = surface ? `${surface}/components` : 'components';
      await page.route('**/src/main.tsx*', route => route.fulfill({
        contentType: 'application/javascript',
        body: `import React from '/node_modules/.vite/deps/react.js';
          import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
          import { ${owner ? 'ListingAvailabilityPicker' : 'DateRangePicker'} as Picker }
            from '/src/${path}/${owner ? 'listing-availability-picker' : 'date-range-picker'}.tsx';
          function Fixture() {
            const [dates,setDates]=React.useState({start:'',end:''});
            const props=${owner ? "{start:dates.start,end:dates.end,today:'2026-11-04'}"
              : "{startDate:dates.start,endDate:dates.end,timeZone:'America/Chicago'}"};
            return React.createElement(React.Fragment,null,
              React.createElement(Picker,{...props,onChange:(start,end)=>setDates({start,end})}),
              React.createElement('p',{'data-testid':'selection'},dates.start+' / '+dates.end));
          }

          ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));`,
      }));
      await page.goto('/');
      if (!owner) await page.getByRole('button', { name: 'Choose a date range', exact: true }).click();
      const today = page.getByRole('button', { name: /^Wednesday, November 4, 2026/ });
      await expect(today).toBeEnabled();
      await today.click();
      if (owner) await today.click();
      else {
        await page.getByRole('button', { name: /^Thursday, November 5, 2026/ }).click();
        await page.getByRole('button', { name: surface ? 'Done' : 'Use these dates', exact: true }).click();
      }
      await expect(page.getByTestId('selection')).toHaveText('2026-11-04 / 2026-11-05');
    });
  }
}

for (const surface of ['main-site', ''] as const) {
  test(`${surface || 'preview'} owner blocked-days calendar accepts pickup-local today`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-05T00:30:00Z'));
    await page.addInitScript(() => Object.assign(globalThis, {
      $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type,
      __vite_plugin_react_preamble_installed__: true,
    }));
    const path = surface ? `${surface}/components` : 'components';
    await page.route('**/src/main.tsx*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `import React from '/node_modules/.vite/deps/react.js';
        import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
        import { AvailabilityCalendar } from '/src/${path}/availability-calendar.tsx';
        ReactDOM.createRoot(document.getElementById('root')).render(
          React.createElement(AvailabilityCalendar,{bookedDates:new Set(),blockedDates:new Set(),
            editable:true,today:'2026-11-04'}));`,
    }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Wednesday, November 4, 2026, available', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Tuesday, November 3, 2026, available', exact: true })).toBeDisabled();
  });
}
