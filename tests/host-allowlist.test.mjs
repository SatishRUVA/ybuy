import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedHostname } from '../api/_lib/host-allowlist.js';

const defaults = ['ybuy-e2e-test.vercel.app'];

test('allows configured hostnames but not sibling Netlify sites', () => {
  assert.equal(isAllowedHostname('ybuy-preview.netlify.app', 'ybuy-preview.netlify.app', defaults), true);
  assert.equal(isAllowedHostname('other-site.netlify.app', 'ybuy-preview.netlify.app', defaults), false);
});

test('preserves Vercel defaults and normalizes hostname casing and whitespace', () => {
  assert.equal(isAllowedHostname('YBUY-E2E-TEST.VERCEL.APP', '', defaults), true);
  assert.equal(isAllowedHostname(' ybuy-preview.netlify.app ', ' ybuy-preview.netlify.app ', defaults), true);
  assert.equal(isAllowedHostname('', 'ybuy-preview.netlify.app', defaults), false);
});
