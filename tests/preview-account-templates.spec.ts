import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __templateCalls: string[];
    __saveProfileShouldFail: boolean;
    __offerShouldFail: boolean;
    __vite_plugin_react_preamble_installed__?: boolean;
  }
}

const appUrl = `http://localhost:${process.env.YBUY_TEST_PORT ?? '5174'}`;
const fixturePath = '/__preview-account-template-fixture';
const fixtureHtml = `<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module">import '/src/index.css';</script>
</head><body></body></html>`;

async function mount(page: Page, component: string, props: unknown) {
  await page.route(`${appUrl}${fixturePath}`, (route) => route.fulfill({ contentType: 'text/html', body: fixtureHtml }));
  await page.goto(`${appUrl}${fixturePath}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__vite_plugin_react_preamble_installed__ === true);
  await page.evaluate(() => { window.__templateCalls = []; window.__saveProfileShouldFail = true; window.__offerShouldFail = true; });
  await page.evaluate(async ({ componentName, componentProps }) => {
    const { mountComponent } = await import('/tests/component-mount.tsx');
    const module = await import('/src/preview-1/account.tsx');
    const backend = componentProps.backend as Record<string, unknown>;
    if (componentName === 'Requests') {
      backend.onRetry = () => window.__templateCalls.push('retry');
      backend.onManage = () => window.__templateCalls.push('manage');
      backend.ownerListings = [{ id: 'my-listing', title: 'Matching camera', dailyPrice: 35, categoryId: 'camera-category', quantity: 2 }];
      backend.onOffer = async (requestId: string, offer: { listingId: string; dailyRate: number }) => {
        window.__templateCalls.push(`offer:${requestId}:${offer.listingId}:${offer.dailyRate}`);
        if (window.__offerShouldFail) throw new Error('Offer service unavailable.');
      };
      backend.postForm = (await import('/tests/component-mount.tsx')).createElement('p', null, 'Native request composer');
    }
    if (componentName === 'Messages') {
      backend.onRetry = () => window.__templateCalls.push('retry');
      backend.onSelect = () => {};
      backend.onBack = () => {};
      backend.onSend = async () => false;
    }
    if (componentName === 'Notifications') {
      backend.onRetry = () => window.__templateCalls.push('retry');
      backend.onLoadMore = () => window.__templateCalls.push('more');
      backend.onMark = () => window.__templateCalls.push('mark');
      backend.onMarkAll = () => window.__templateCalls.push('all');
      backend.onOpen = () => window.__templateCalls.push('open');
    }
    if (componentName === 'Profile') {
      backend.onRetry = () => {};
      backend.onSaveProfile = async (fullName: string, phone: string) => {
        window.__templateCalls.push(`save:${fullName}|${phone}`);
        if (window.__saveProfileShouldFail) throw new Error('Profile could not be saved.');
      };
      backend.onSignOut = () => {};
      backend.onRetryPreferences = () => {};
      backend.onPreferenceChange = () => {};
    }
    mountComponent(module[componentName], componentProps);
  }, { componentName: component, componentProps: props });
}

test('native request template displays backend rows and keeps post/manage actions connected', async ({ page }) => {
  await mount(page, 'Requests', {
    backend: {
      rows: [{
        id: 'request-1', title: 'Weekend projector', startDate: '2026-11-04', endDate: '2026-11-06',
        location: 'Irving, TX', dailyBudget: 40, createdAt: '2026-11-01T10:00:00Z', responseCount: 2,
        description: 'Projector for an outdoor movie night.', category: 'Cameras', quantity: 1,
        intendedUse: null, specifications: 'HDMI input', notes: null, categoryId: 'camera-category',
        matchedListings: [{ id: 'listing-1', title: 'Portable projector', dailyPrice: 35 }],
      }],
      loading: false, error: null,
    },
  });
  await expect(page.locator('main.p1-container.p1-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Good plans need good gear.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekend projector' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Portable projector/ })).toHaveAttribute('href', '/listing/listing-1');
  await page.getByRole('button', { name: 'Post a request' }).click();
  await expect(page.getByText('Native request composer')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Have something that fits?' }).click();
  await page.getByRole('combobox', { name: 'Your matching published rental' }).click();
  await page.getByRole('option', { name: /Matching camera/ }).click();
  const dailyOffer = page.getByLabel('Daily offer ($)');
  await dailyOffer.fill('36');
  await page.getByLabel('Message (optional)').fill('Happy to coordinate a pickup.');
  await page.getByRole('button', { name: 'Send offer' }).click();
  await expect(page.getByRole('alert')).toContainText('Offer service unavailable.');
  await expect(dailyOffer).toHaveValue('36');
  await expect(page.getByLabel('Message (optional)')).toHaveValue('Happy to coordinate a pickup.');
  await page.evaluate(() => { window.__offerShouldFail = false; });
  await page.getByRole('button', { name: 'Send offer' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'My requests & offers' }).first().click();
  await expect.poll(() => page.evaluate(() => window.__templateCalls)).toContain('offer:request-1:my-listing:36');
  await expect.poll(() => page.evaluate(() => window.__templateCalls)).toContain('manage');
  await expect(page.getByText('Sample member profile')).toHaveCount(0);
});

test('native messages template sends real-thread drafts without fabricated replies', async ({ page }) => {
  await mount(page, 'Messages', {
    backend: {
      rows: [{ id: 'conversation-1', name: 'Owner One', avatar: null, listingTitle: 'Camera kit', listingImage: null, lastMessage: 'Pickup is flexible.', lastTime: '2026-11-01T10:00:00Z' }],
      selectedId: 'conversation-1', messages: [{ id: 'message-1', senderId: 'owner-1', text: 'Pickup is flexible.', time: '10:00 AM' }],
      currentUserId: 'renter-1', loading: false, loadingMessages: false, error: 'Could not send this message.',
      sending: false,
    },
  });
  await expect(page.locator('main.p1-work-page.p1-messages-page')).toBeVisible();
  await expect(page.getByRole('log', { name: 'Conversation messages' })).toContainText('Pickup is flexible.');
  await expect(page.getByText('Demo chat')).toHaveCount(0);
  await expect(page.getByText('Preview a reply')).toHaveCount(0);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Could I collect it at noon?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(input).toHaveValue('Could I collect it at noon?');
  await expect(page.getByRole('alert')).toContainText('Could not send this message.');
});

test('native notification template keeps failed state visible and exposes unread actions', async ({ page }) => {
  await mount(page, 'Notifications', {
    backend: {
      rows: [{ id: 'notice-1', title: 'Rental update', body: 'Your booking changed.', read: false, destination: '/dashboard' }],
      loading: false, hasMore: false, loadingMore: false, busy: null, error: 'Could not mark this update as read.',
    },
  });
  await expect(page.locator('main.p1-work-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The useful updates.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rental update' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Could not mark this update as read.');
  await page.getByRole('button', { name: 'Mark "Rental update" read' }).click();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await page.getByRole('link', { name: /Rental update/ }).click();
  await expect.poll(() => page.evaluate(() => window.__templateCalls)).toEqual(['mark', 'all', 'open']);
});

test('native profile template edits name and phone only after persistence, while email remains read-only', async ({ page }) => {
  await mount(page, 'Profile', {
    backend: {
      profile: {
        id: 'user-1', name: 'Real Member', email: 'member@example.test', phone: '', avatar: null, joinedYear: 2024,
        provider: 'Google', emailVerified: true, completedRentals: 3, listingsOwned: 2, savedItems: 1,
      },
      loading: false, error: null, signingOut: false,
      preferences: null, preferencesError: null, preferencesLoading: false, preferenceBusy: null,
    },
  });
  await expect(page.locator('main.p1-work-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Real Member' })).toBeVisible();
  await expect(page.getByText('Verified email')).toBeVisible();
  await expect(page.getByText('Demo verification badge')).toHaveCount(0);
  const fullName = page.getByLabel('Full name');
  const email = page.getByLabel('Email');
  const phone = page.getByLabel('Phone');
  await expect(fullName).not.toHaveAttribute('readonly', '');
  await expect(email).toHaveAttribute('readonly', '');
  await fullName.fill('Updated Member');
  await phone.fill('+1 214 555 0199');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('alert')).toContainText('Profile could not be saved.');
  await expect(fullName).toHaveValue('Updated Member');
  await expect(phone).toHaveValue('+1 214 555 0199');
  await page.evaluate(() => { window.__saveProfileShouldFail = false; });
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Your profile was saved.');
  await expect.poll(() => page.evaluate(() => window.__templateCalls)).toContain('save:Updated Member|+1 214 555 0199');
  await expect(page.getByText('Sample member profile')).toHaveCount(0);
});
