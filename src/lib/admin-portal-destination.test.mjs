import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { adminPortalDestination } from './admin-portal-destination.ts';

test('separate admin portal links retain the requested role', () => {
  assert.equal(adminPortalDestination('admin', 'https://admin.example.test'), 'https://admin.example.test');
  assert.equal(adminPortalDestination('super_admin', 'https://admin.example.test/'), 'https://admin.example.test/super-admin');
});
