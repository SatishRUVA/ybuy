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

test('local testers require exactly five unique owners and five unique renters', () => {
  const testers = Array.from({ length: 10 }, (_, index) => ({
    id: `tester-${index}`, name: `Tester ${index}`, role: index < 5 ? 'Owner' : 'Renter',
  }));
  assert.equal(isValidLocalProfileList(testers, 'local'), true);
  assert.equal(isValidLocalProfileList(testers.slice(1), 'local'), false);
  assert.equal(isValidLocalProfileList([...testers, testers[0]], 'local'), false);
  assert.equal(isValidLocalProfileList(testers.map((item, index) =>
    index === 0 ? { ...item, role: 'Admin' } : item), 'local'), false);
  assert.equal(isValidLocalProfileList(testers.map((item, index) =>
    index === 0 ? { ...item, role: 'Renter' } : item), 'local'), false);
  assert.equal(isValidLocalProfileList(testers.map((item, index) =>
    index === 0 ? testers[1] : item), 'local'), false);
});
