import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

test('customer and administrator builds have separate page graphs and staff controls', async () => {
  const customer = JSON.parse(await readFile(join('dist-customer', '.vite', 'manifest.json'), 'utf8'));
  const admin = JSON.parse(await readFile(join('dist-admin', '.vite', 'manifest.json'), 'utf8'));
  assert.ok(!Object.keys(customer).some(key => key.startsWith('src/admin/')));
  assert.ok(Object.keys(admin).includes('src/admin/pages/admin-page.tsx'));
  assert.ok(!Object.keys(admin).some(key => key.startsWith('src/main-site/pages/')));
  const assets = join('dist-customer', 'assets');
  const files = (await readdir(assets)).filter(file => file.endsWith('.js'));
  const source = (await Promise.all(files.map(file => readFile(join(assets, file), 'utf8')))).join('\n');
  for (const marker of [
    'support_complete_booking_handoff_exception', 'Manage case', 'admin_upsert_admin',
    'admin_approve_listing_publication', 'admin_list_users', 'admin_update_case',
    'admin_create_case', 'admin_list_cases', 'Administrator sign-in',
  ]) {
    assert.ok(!source.includes(marker), `Customer bundle includes privileged operation: ${marker}`);
  }
});
