// Assert-based self-check for the TOTP access gate's pure logic (no server needed).
// Run with: node scripts/verify-access-gate.mjs
import assert from 'node:assert/strict';
import { verifyTotp, signAccessSession, verifyAccessSession, computeTotpForTest } from '../api/_lib/access-session.js';

const SECRET = 'JBSWY3DPEHPK3PXP'; // well-known test-only base32 TOTP secret
const now = Date.now();

// The correct current code must be accepted (proves the positive path, not just rejections).
const validCode = await computeTotpForTest(SECRET, now);
assert.equal(await verifyTotp(SECRET, validCode, now), true, 'correct TOTP code must succeed');

// A wrong code must be rejected.
assert.equal(await verifyTotp(SECRET, '000000', now), false, 'wrong TOTP code must fail');

// A malformed code must be rejected, never throw.
assert.equal(await verifyTotp(SECRET, 'abcdef', now), false, 'non-numeric code must fail');
assert.equal(await verifyTotp(SECRET, '12345', now), false, 'wrong-length code must fail');

// Session token: valid immediately after signing, invalid once past expiry, invalid if tampered.
const { token, expiresAt } = await signAccessSession('session-secret', now);
assert.equal(await verifyAccessSession('session-secret', token, now), true, 'freshly-signed session must verify');
assert.equal(await verifyAccessSession('session-secret', token, expiresAt + 1), false, 'expired session must fail');
assert.equal(await verifyAccessSession('wrong-secret', token, now), false, 'session signed with a different secret must fail');
assert.equal(await verifyAccessSession('session-secret', `${token}x`, now), false, 'tampered session token must fail');
assert.equal(await verifyAccessSession('session-secret', `${token}.extra`, now), false, 'extra token segments must fail');
assert.equal(await verifyAccessSession('session-secret', undefined, now), false, 'missing session token must fail');

console.log('access-gate self-check passed');
