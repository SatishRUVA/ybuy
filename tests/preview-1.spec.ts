import { test, expect, type Page, type TestInfo } from '@playwright/test';

const route = async (page: Page, hash: string) => {
  await page.evaluate((value) => { window.location.hash = `#/${value}`; }, hash);
  await expect(page.locator('main h1')).toBeVisible();
};
const screenshot = async (page: Page, name: string, testInfo: TestInfo, fullPage = true) => {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage });
};
async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const width of [1440, 768, 390]) {
  test(`all preview pages render without errors or overflow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [], backend: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (/supabase\.(co|in)|api\.stripe\.com|\/rest\/v1\/|\/auth\/v1\/|localhost:54321/i.test(request.url())) backend.push(request.url()); });
    await page.goto('/preview-1');
    await expect(page.locator('main h1')).toHaveText('Great gear.No need to buy.');
    await assertNoOverflow(page);
    await screenshot(page, 'home', testInfo);
    for (const name of ['search', 'listing/l1', 'bidding', 'auction/a1', 'requests', 'checkout/l1', 'confirmation', 'renter', 'favorites', 'owner', 'listings', 'create', 'payouts', 'messages', 'notifications', 'profile', 'admin', 'admin/moderation', 'admin/members', 'admin/disputes', 'admin/reporting', 'admin/settings', 'states']) {
      await route(page, name);
      await assertNoOverflow(page);
      await screenshot(page, name.replace('/', '-'), testInfo);
    }
    expect(errors).toEqual([]);
    expect(backend).toEqual([]);
  });
}

test('home search, radius, real filters, save and mobile calendar keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/preview-1');
  await page.getByRole('combobox', { name: 'Search radius', exact: true }).click();
  await page.getByRole('option', { name: 'Any distance', exact: true }).click();
  await page.getByRole('button', { name: 'When?' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'A short break' }).click();
  await dialog.getByRole('button', { name: 'Apply dates' }).click();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/#\/search$/);
  await page.getByRole('button', { name: 'When?' }).click();
  await dialog.getByRole('button', { name: 'Clear dates' }).click();
  await dialog.getByRole('button', { name: 'Apply dates' }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Category', exact: true }).click();
  await page.getByRole('option', { name: 'Cameras', exact: true }).click();
  await dialog.getByRole('button', { name: /Show \d+ results/ }).click();
  await expect(page.locator('.p1-results .p1-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Unsave Sony A7 IV Mirrorless Camera' }).click();
  await route(page, 'favorites');
  await expect(page.locator('.p1-item-title').filter({ hasText: 'Sony A7 IV Mirrorless Camera' })).toHaveCount(0);
  await route(page, 'listing/l1');
  await page.getByRole('button', { name: /Your rental dates/ }).click();
  const available = dialog.locator('button[data-day]:enabled').first();
  const originalDay = await available.getAttribute('data-day');
  await available.focus();
  await available.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-day'))).not.toBe(originalDay);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Your rental dates/ })).toBeFocused();
});

for (const width of [1440, 390]) {
  test(`styled dropdowns preserve selection and keyboard focus at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/preview-1');
    const location = page.getByRole('combobox', { name: 'Search location', exact: true });
    await location.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    const bounds = await page.getByRole('listbox').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await screenshot(page, 'location-dropdown', testInfo, false);
    await page.getByRole('option', { name: 'Dallas, TX', exact: true }).click();
    await expect(location).toHaveText('Dallas, TX');
    await expect(location).toBeFocused();
    const radius = page.getByRole('combobox', { name: 'Search radius', exact: true });
    await radius.focus();
    await radius.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(radius).toHaveText('Any distance');
    await expect(radius).toBeFocused();
    await radius.press('Enter');
    await screenshot(page, 'radius-dropdown', testInfo, false);
    await page.keyboard.press('Escape');
    await expect(radius).toBeFocused();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const sort = page.getByRole('combobox', { name: 'Sort results', exact: true });
    await sort.click();
    await page.getByRole('option', { name: 'Price: low to high', exact: true }).click();
    await expect(sort).toHaveText('Price: low to high');
    const prices = await page.locator('.p1-results .p1-item-price strong').allTextContents();
    const numbers = prices.map((p) => Number(p.replace(/[^\d]/g, '')));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    await route(page, 'requests');
    await page.getByRole('button', { name: 'Have something that fits?' }).first().click();
    const picker = page.getByRole('dialog').getByRole('combobox', { name: 'Choose an available sample listing', exact: true });
    await picker.click();
    await screenshot(page, 'listing-dropdown-in-dialog', testInfo, false);
    await page.getByRole('option').first().click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Link rental', exact: true })).toBeEnabled();
    await page.getByRole('dialog').getByRole('button', { name: 'Link rental', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Linked rentals' })).toBeVisible();
    await assertNoOverflow(page);
  });
}

test('regular checkout declined payment, recovery, rental pickup and issue resolution', async ({ page }) => {
  await page.goto('/preview-1#/checkout/l4');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('I agree to the item’s rental and cancellation terms.').check();
  await page.getByLabel('Preview a declined payment').check();
  await page.getByRole('button', { name: /Confirm demo booking/ }).click();
  await expect(page.getByRole('alert')).toContainText('Demo payment declined');
  await page.getByLabel('Preview a declined payment').uncheck();
  await page.getByRole('button', { name: /Confirm demo booking/ }).click();
  await expect(page).toHaveURL(/#\/confirmation\//);
  await page.getByRole('link', { name: 'View my rentals', exact: true }).click();
  await page.locator('.p1-rental-row').first().getByRole('button', { name: 'Rental details' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Mark picked up' }).click();
  await dialog.getByLabel('Report an issue').fill('The camera lens is not focusing as expected.');
  await dialog.getByRole('button', { name: 'Submit issue' }).click();
  await expect(dialog.getByText('Issue submitted for review')).toBeVisible();
  await page.keyboard.press('Escape');
  await route(page, 'admin/disputes');
  const issue = page.locator('.p1-data-list article').filter({ hasText: 'The camera lens is not focusing as expected.' });
  await issue.getByRole('button', { name: 'Review issue' }).click();
  await dialog.getByLabel('Resolution note').fill('Sample outcome: both sides agreed to a replacement rental.');
  await dialog.getByRole('button', { name: 'Save demo resolution' }).click();
  await expect(issue.getByText('resolved', { exact: true })).toBeVisible();
});

test('new listing wizard, calendar cap, blocking, moderation, edit and pause persist', async ({ page }) => {
  await page.goto('/preview-1#/create');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('title');
  await page.getByLabel('Give it a useful title').fill('Weekend photo kit preview');
  await page.getByLabel('What should renters know?').fill('A clean sample camera kit with a lens and carry bag.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Add a sample photo' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Daily price ($)').fill('35');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('30 / 30 days', { exact: true })).toBeVisible();
  const startDay = page.locator('button[data-day]:enabled').first();
  const startIso = await startDay.getAttribute('data-day');
  await startDay.click();
  const tooLong = await page.evaluate((iso) => { const [y, m, d] = iso!.split('-').map(Number); const date = new Date(y, m - 1, d + 30); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }, startIso);
  if (!await page.locator(`[data-day="${tooLong}"]`).count()) await page.getByRole('button', { name: 'Next month' }).click();
  await page.locator(`[data-day="${tooLong}"]`).click();
  await expect(page.getByRole('alert')).toContainText('30 calendar days or less');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.p1-wizard-content > .p1-error')).toContainText('Choose a start and end');
  const lastDay = await page.evaluate((iso) => { const [y, m, d] = iso!.split('-').map(Number); const date = new Date(y, m - 1, d + 29); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }, startIso);
  await page.locator(`[data-day="${lastDay}"]`).click();
  await page.getByRole('button', { name: 'Block individual days', exact: true }).click();
  const day = page.locator('button[data-day]:enabled').first();
  await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  const ownerCard = page.locator('.p1-owner-item').filter({ hasText: 'Weekend photo kit preview' });
  await expect(ownerCard.getByText('In review', { exact: true })).toBeVisible();
  await route(page, 'admin/moderation');
  await page.locator('.p1-moderation-list article').filter({ hasText: 'Weekend photo kit preview' }).getByRole('button', { name: 'Review listing' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve listing' }).click();
  await route(page, 'listings');
  await expect(ownerCard.getByText('Live', { exact: true })).toBeVisible();
  await ownerCard.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(ownerCard.getByText('Paused', { exact: true })).toBeVisible();
  await ownerCard.getByRole('button', { name: 'Resume', exact: true }).click();
  await ownerCard.getByRole('link', { name: 'Edit listing', exact: true }).click();
  await expect(page.getByLabel('Give it a useful title')).toHaveValue('Weekend photo kit preview');
});

test('owner approval is distinct from payment and dates remain protected', async ({ page }) => {
  await page.goto('/preview-1#/checkout/l1');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Owner approval comes first.' })).toBeVisible();
  await page.getByLabel('I agree to the item’s rental and cancellation terms.').check();
  await page.getByRole('button', { name: 'Send rental request' }).click();
  await expect(page.getByText('Awaiting approval', { exact: true })).toBeVisible();
  await route(page, 'owner');
  await page.locator('.p1-request-queue article').first().getByRole('button', { name: 'Approve', exact: true }).click();
  await route(page, 'renter');
  const row = page.locator('.p1-rental-row').first();
  await expect(row.getByText('approved', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Rental details' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Complete demo payment' }).click();
  await expect(page.getByRole('dialog').getByText('upcoming', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await route(page, 'listings');
  await page.locator('.p1-owner-item').filter({ hasText: 'Sony A7 IV Mirrorless Camera' }).getByRole('button', { name: 'Availability', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Block individual days', exact: true }).click();
  await expect(dialog.locator('button[data-day].locked').first()).toBeDisabled();
});

test('bidding allows only three bids and protects anonymous identity through payment', async ({ page }) => {
  await page.goto('/preview-1#/auction/a1');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Place bid/ }).click();
  await expect(page.getByText('3 of 3 bids used.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Place bid/ })).toBeDisabled();
  await page.getByText('Explore demo lifecycle').click();
  await page.getByRole('button', { name: 'Close demo bidding' }).click();
  await page.getByRole('button', { name: 'Select bidder' }).first().click();
  await page.getByRole('button', { name: 'Preview failed payment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('declined');
  await page.getByRole('button', { name: 'Simulate successful winner payment' }).click();
  await expect(page).toHaveURL(/#\/confirmation\//);
});

test('messages, notifications, profile preferences and preview isolation', async ({ page }) => {
  await page.goto('/preview-1#/messages');
  await page.getByLabel('Message', { exact: true }).fill('Can we arrange a morning pickup?');
  await page.getByRole('button', { name: 'Send demo message' }).click();
  await expect(page.getByRole('log')).toContainText('Can we arrange a morning pickup?');
  await route(page, 'profile');
  await page.getByLabel('Full name', { exact: true }).fill('Jamie Preview');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await route(page, 'messages');
  await expect(page.getByRole('log')).toContainText('Can we arrange a morning pickup?');
  await route(page, 'notifications');
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('button', { name: 'Unread (0)' })).toBeVisible();
  await page.goto('/preview');
  await expect(page.locator('.p1')).toHaveCount(0);
  await expect(page.locator('main')).toBeVisible();
});
