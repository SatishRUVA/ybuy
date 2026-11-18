import { expect, test } from '@playwright/test';

test('optional insurance is unchecked by default and updates its displayed amount', async ({ page }) => {
  await page.route('**/__insurance-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
</script></head><body></body></html>`,
  }));
  await page.goto('/__insurance-fixture');
  await page.evaluate(async () => {
    const { mountComponent } = await import('/tests/component-mount.tsx');
    await import('/src/main-site/index.css');
    await import('/src/main-site/theme.css');
    const { CheckoutInsuranceHarness } = await import('/tests/checkout-insurance-harness.tsx');
    mountComponent(CheckoutInsuranceHarness);
  });

  const choice = page.getByRole('checkbox', { name: 'Optional insurance' });
  await expect(choice).not.toBeChecked();
  await expect(page.getByTestId('insurance-choice')).toHaveText('false');
  await expect(page.getByText('Adds $4.00 at 1% of declared item value per rental day and unit. Not included unless selected.')).toBeVisible();
  await choice.check();
  await expect(page.getByTestId('insurance-choice')).toHaveText('true');
  await expect(page.getByText('$4.00', { exact: true })).toBeVisible();
});
