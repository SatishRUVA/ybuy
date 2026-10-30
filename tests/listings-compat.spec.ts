import { expect, test } from '@playwright/test';
import { appUrl } from './test-url';

const listing = {
  id: '30000000-0000-4000-8000-000000000001',
  owner_id: '10000000-0000-4000-8000-000000000001',
  category_id: '20000000-0000-4000-8000-000000000001',
  title: 'Legacy compatibility item',
  description: 'A published listing from an older schema.',
  price_per_day: 12,
  deposit: 0,
  location_lat: null,
  location_lng: null,
  location_label: 'Dallas, TX',
  status: 'published',
  created_at: '2026-01-01T00:00:00Z',
  listing_images: [],
  owner: { id: '10000000-0000-4000-8000-000000000001', full_name: 'Owner', avatar_url: null },
  categories: { name: 'Tools' },
};

test('published listings still load before optional marketplace columns are migrated', async ({ page }) => {
  let sawNewSchemaQuery = false;
  let sawLegacyFallback = false;

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appUrl) return route.continue();

    if (url.pathname === '/rest/v1/listings') {
      const select = url.searchParams.get('select') ?? '';
      if (select.startsWith('*') && url.searchParams.get('order')?.includes('owner_verified')) {
        sawNewSchemaQuery = true;
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            code: '42703',
            message: 'column listings.owner_verified does not exist',
          }),
        });

      }
      if (select.startsWith('id,owner_id,category_id,title,description')) {
        sawLegacyFallback = true;
        return route.fulfill({
          contentType: 'application/json',
          headers: { 'content-range': '0-0/1' },
          body: JSON.stringify([listing]),
        });
      }
    }

    return route.fulfill({
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: '[]',
    });
  });

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Legacy compatibility item')).toBeVisible();

  const mapped = await page.evaluate(async () => {
    const { searchListings, toUiListing } = await import('/src/lib/listings.ts');
    const result = await searchListings({ sortBy: 'recommended', pageSize: 1 });
    const uiListing = toUiListing(result.rows[0]);
    return {
      title: uiListing.title,
      availableQuantity: uiListing.availableQuantity,
      negotiationEnabled: uiListing.negotiationEnabled,
    };
  });

  expect(sawNewSchemaQuery).toBe(true);
  expect(sawLegacyFallback).toBe(true);
  expect(mapped).toEqual({
    title: 'Legacy compatibility item',
    availableQuantity: 1,
    negotiationEnabled: false,
  });
});

test('published listings load before duration discount columns are migrated', async ({ page }) => {
  let sawCompatibleQuery = false;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appUrl) return route.continue();
    if (url.pathname === '/rest/v1/listings') {
      const select = url.searchParams.get('select') ?? '';
      if (select.includes('duration_discount_')) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            code: '42703',
            message: 'column listings.duration_discount_min_days does not exist',
          }),
        });
      }
      if (select.startsWith('*')) {
        sawCompatibleQuery = true;
        return route.fulfill({
          contentType: 'application/json',
          headers: { 'content-range': '0-0/1' },
          body: JSON.stringify([{ ...listing, owner_verified: false, instant_booking: false }]),
        });
      }
    }
    return route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Legacy compatibility item')).toBeVisible();
  await expect(page.getByText("We couldn't load listings")).toHaveCount(0);
  expect(sawCompatibleQuery).toBe(true);
});
