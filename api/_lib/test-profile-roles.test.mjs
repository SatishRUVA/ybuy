import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hostedProfileRole } from './test-profile-roles.js';

test('resolves active hosted administrator fixtures to their shared picker roles', () => {
  assert.equal(hostedProfileRole('admin@example.test', { role: 'admin', active: true }), 'Admin');
  assert.equal(hostedProfileRole('super-admin@example.test', { role: 'super_admin', active: true }), 'Super Admin');
});

test('does not expose inactive or mismatched administrator fixtures', () => {
  assert.equal(hostedProfileRole('admin@example.test', { role: 'admin', active: false }), null);
  assert.equal(hostedProfileRole('admin@example.test', { role: 'super_admin', active: true }), null);
});
