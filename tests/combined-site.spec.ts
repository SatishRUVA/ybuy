import { expect, test } from '@playwright/test';

test('combined build serves customer, Admin, and Super Admin on their separate paths', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/**', route => route.fulfill({ status: 404, json: { error: 'Test API unavailable.' } }));
  await page.route('**/api/admin/access', route => route.fulfill({ status: 401, json: { error: 'Verify access.' } }));
  await page.route('**/api/super-admin/access', route => route.fulfill({ status: 401, json: { error: 'Verify access.' } }));
  await page.route('https://example.supabase.co/**', route => route.fulfill({ status: 401, json: { message: 'No test session.' } }));

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in / Join' })).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  await page.goto('/super-admin');
  await expect(page.getByRole('heading', { name: 'Super Admin sign-in' })).toBeVisible();
  expect(errors).toEqual([]);
});
