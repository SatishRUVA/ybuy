import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|images\.pexels\.com)\//, route => route.abort());
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 900 }, { width: 390, height: 600 }, { width: 320, height: 480 }]) {
  test(`preview notification center groups and fits at ${viewport.width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await page.goto('/preview-1#/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 25_000 });
    const bell = page.getByRole('link', { name: '7 unread notifications', exact: true });
    await expect(bell.locator('.p1-notification-count')).toHaveText('7');
    if (viewport.width <= 560) {
      await expect(page.locator('.p1-header .p1-list-link')).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'List an item', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    for (const day of ['Today', 'Yesterday', 'Earlier']) {
      await expect(page.getByRole('region', { name: `${day} notifications`, exact: true })).toBeVisible();
    }
    const tabs = page.getByRole('navigation', { name: 'Notification categories' });
    await tabs.getByRole('button', { name: /^Listings/ }).click();
    const inbox = page.getByRole('region', { name: 'Notification inbox' });
    await expect(inbox.getByRole('heading', { name: 'Listing ready for review' })).toBeVisible();
    await expect(inbox.getByRole('heading', { name: 'New booking request' })).toHaveCount(0);
    await tabs.getByRole('button', { name: /^All updates/ }).click();
    await inbox.getByRole('button', { name: 'Mute by category', exact: true }).click();
    const muteMenu = page.getByRole('region', { name: 'Mute by category', exact: true });
    await expect(muteMenu).toBeVisible();
    const menuBounds = await muteMenu.boundingBox();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.y).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Escape');
    const settings = page.getByRole('complementary', { name: 'Notification settings' });
    await expect(settings.getByRole('switch', { name: /^Bookings/ })).toBeDisabled();
    await expect(settings.getByRole('switch', { name: /^Payments/ })).toBeDisabled();
    await expect(settings.getByRole('switch', { name: /^Safety & support/ })).toBeDisabled();
    const listingSwitch = settings.getByRole('switch', { name: /^Listings/ });
    await listingSwitch.click();
    await expect(listingSwitch).not.toBeChecked();
    await expect(inbox.getByRole('heading', { name: 'Listing ready for review' })).toBeVisible();
    await settings.getByRole('button', { name: 'Notification settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Notification settings' });
    await expect(dialog.getByRole('switch', { name: /^Listings/ })).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeInViewport({ ratio: 1 });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Escape');
    await inbox.getByRole('checkbox', { name: 'Select New booking request', exact: true }).check();
    await inbox.getByRole('button', { name: 'Mark 1 read', exact: true }).click();
    await expect(page.getByRole('link', { name: '6 unread notifications', exact: true }).locator('.p1-notification-count')).toHaveText('6');
    await inbox.getByRole('button', { name: 'Mark all read', exact: true }).click();
    await expect(page.getByRole('link', { name: '0 unread notifications', exact: true }).locator('.p1-notification-count')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('optional muting never suppresses mandatory preview alerts', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
  <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
  <script type="module">import '/src/index.css'; import '/src/styles/preview-one.css';</script></head><body></body></html>`;
  await page.route('**/__preview-notification-fixture', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('/__preview-notification-fixture');
  await page.waitForFunction(() => window.__vite_plugin_react_preamble_installed__ === true);
  await page.evaluate(async () => {
    const { mountComponent } = await import('/tests/component-mount.tsx');
    const { PreviewNotificationHarness } = await import('/tests/preview-notification-harness.tsx');
    mountComponent(PreviewNotificationHarness);
  });
  const settings = page.getByRole('complementary', { name: 'Notification settings' });
  await settings.getByRole('switch', { name: /^Offers & bids/ }).click();
  await page.getByRole('button', { name: 'Generate preview events' }).click();
  await expect(page.getByRole('heading', { name: 'Optional bid test', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Mandatory winning bid test', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mandatory payment test', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mute by category', exact: true }).click();
  const menu = page.getByRole('region', { name: 'Mute by category' });
  await expect(menu.getByRole('switch', { name: /^Payments/ })).toBeDisabled();
  await expect(menu.getByRole('switch', { name: /^Offers & bids/ })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
});
