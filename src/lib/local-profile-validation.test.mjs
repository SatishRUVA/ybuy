import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isValidLocalProfileList } from './local-profile-validation.ts';

const profiles = ['Owner', 'Renter', 'Admin', 'Super Admin'].map((role, index) => ({
  id: `${index}`, name: role, role,
}));

test('accepts all twelve hosted profiles including both administrator roles', () => {
  assert.equal(isValidLocalProfileList([...profiles, ...profiles, ...profiles], 'hosted'), true);
});

test('rejects hosted profile lists larger than twelve', () => {
  assert.equal(isValidLocalProfileList([...profiles, ...profiles, ...profiles, profiles[0]], 'hosted'), false);
});
