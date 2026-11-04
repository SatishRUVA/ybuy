import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const hostedTest = process.argv.includes('--hosted-test');
const localUrl = hostedTest ? 'https://jzyjmsixfuwzfnntewqn.supabase.co' : 'http://127.0.0.1:54321';
const status = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(status.API_URL, localUrl, 'Only local Supabase or the explicitly approved isolated test project is allowed.');
assert.ok(status.SERVICE_ROLE_KEY && status.ANON_KEY, 'Local Supabase keys are required.');

const fixturePath = resolve(hostedTest ? 'ybuy-hosted-test-accounts.local' : 'ybuy-test-accounts.local');
const marker = 'ybuy-local-lifecycle-v1';
const expectedEmails = ['owner', 'renter'].flatMap((persona) =>
  Array.from({ length: 5 }, (_, index) => `${persona}${index + 1}@example.test`));
const fixture = existsSync(fixturePath)
  ? JSON.parse(readFileSync(fixturePath, 'utf8'))
  : {
    marker,
    accounts: expectedEmails.map((email) => ({
      email,
      password: `Yb!${randomBytes(24).toString('base64url')}`,
      name: `Test ${email.startsWith('owner') ? 'Owner' : 'Renter'} ${email.match(/\d+/)[0]}`,
    })),
  };
assert.equal(fixture.marker, marker, 'Unrecognized fixture file; refusing to overwrite.');
const adminAccounts = [
  { email: 'admin@example.test', name: 'Test Admin', role: 'admin' },
  { email: 'super-admin@example.test', name: 'Test Super Admin', role: 'super_admin' },
];
const withAdmins = process.argv.includes('--with-admins')
  || fixture.accounts.some(account => account.email === 'admin@example.test');
if (withAdmins) {
  for (const { email, name } of adminAccounts) {
    expectedEmails.push(email);
    if (!fixture.accounts.some(account => account.email === email)) {
      fixture.accounts.push({ email, name, password: `Yb!${randomBytes(24).toString('base64url')}` });
    }
  }
}
assert.deepEqual(fixture.accounts.map((account) => account.email), expectedEmails);
for (const account of fixture.accounts) {
  assert.ok(typeof account.password === 'string' && account.password.length >= 24);
}
if (!existsSync(fixturePath)) {
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
} else if (withAdmins) {
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
}

const options = {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: (url, init) => {
    assert.equal(new URL(url).origin, localUrl, 'Refusing a non-local API request.');
    return fetch(url, { ...init, redirect: 'error' });
  } },
};
const admin = createClient(localUrl, status.SERVICE_ROLE_KEY, options);
const existing = new Map();
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw new Error(`Cannot list local users: ${error.message}`);
  for (const user of data.users) existing.set(user.email, user);
  if (data.users.length < 100) break;
}

for (const account of fixture.accounts) {
  let user = existing.get(account.email);
  if (user) {
    assert.equal(user.app_metadata.local_test_fixture, marker,
      `Refusing to modify an unrelated account: ${account.email}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      app_metadata: { local_test_fixture: marker },
      user_metadata: { full_name: account.name },
    });
    if (error) throw new Error(`Cannot create ${account.email}: ${error.message}`);
    user = data.user;
  }
  assert.ok(user?.id, 'Expected a persisted Auth user.');
  account.id = user.id;

  const adminAccount = adminAccounts.find(item => item.email === account.email);
  if (adminAccount) {
    const { data: permissions, error: permissionsError } = await admin.rpc('admin_grantable_permissions');
    if (permissionsError) throw permissionsError;
    assert.ok(Array.isArray(permissions) && permissions.every(permission => typeof permission === 'string'),
      'Expected the database admin permission catalog.');
    const { error } = await admin.from('admin_users').upsert({
      user_id: user.id, role: adminAccount.role, active: true,
      permissions: adminAccount.role === 'admin' ? permissions : [],
    });
    if (error) throw new Error(`Cannot provision ${account.email} role: ${error.message}`);
  }

  const client = createClient(localUrl, status.ANON_KEY, options);
  const invalid = await client.auth.signInWithPassword({
    email: account.email, password: 'intentionally-invalid-local-password',
  });
  assert.ok(invalid.error && !invalid.data.session, 'Wrong password must be rejected.');
  const signedIn = await client.auth.signInWithPassword(account);
  if (signedIn.error) throw new Error(`Cannot authenticate ${account.email}: ${signedIn.error.message}`);
  assert.equal(signedIn.data.user.id, user.id);
  assert.ok(signedIn.data.session?.access_token, 'Expected a real Auth session.');
  const active = await client.rpc('has_active_session');
  if (active.error) throw new Error(active.error.message);
  assert.equal(active.data, true);
  const profile = await client.rpc('get_my_profile').single();
  if (profile.error) throw new Error(profile.error.message);
  assert.equal(profile.data.id, user.id);
  assert.equal(profile.data.email, account.email);
  assert.equal(profile.data.full_name, account.name);
  if (process.argv.includes('--with-listings') && account.email.startsWith('owner')) {
    const title = `${account.name} camera - test fixture`;
    const found = await client.from('listings').select('id').eq('owner_id', user.id).eq('title', title);
    if (found.error) throw new Error(found.error.message);
    assert.ok(found.data.length <= 1, 'Duplicate manual-test fixture listings found.');
    if (found.data.length === 0) {
      const category = await client.from('categories').select('id').order('sort_order').limit(1).single();
      if (category.error) throw new Error(category.error.message);
      const created = await client.from('listings').insert({
        owner_id: user.id, category_id: category.data.id, title,
        description: 'Synthetic test listing for manual booking requests. No actual item or fulfillment.',
        price_per_day: 10, deposit: 0, status: 'published',
        estimated_value:200,item_condition:'good',
        location_label: 'Dallas, TX', location_lat: 32.78, location_lng: -96.8,
      }).select('id').single();
      if (created.error) throw new Error(created.error.message);
      account.listingId = created.data.id;
    } else {
      account.listingId = found.data[0].id;
    }
    console.log(`Manual-test listing ready for ${account.email}`);
  }
  const signedOut = await client.auth.signOut({ scope: 'local' });
  if (signedOut.error) throw new Error(signedOut.error.message);
  console.log(`PASS ${account.email}: persisted profile, password auth, active session, wrong-password rejection, sign-out`);
}
assert.equal(new Set(fixture.accounts.map((account) => account.id)).size, expectedEmails.length);
writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
console.log(`Verified ${expectedEmails.length} separate ${hostedTest ? 'hosted test' : 'local'} accounts. Credentials: ${fixturePath}`);
console.log('Admin-created fixtures are not registration or booking lifecycle E2E coverage.');
