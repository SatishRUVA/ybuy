// Shared by middleware.js, api/access/verify.js and scripts/verify-access-gate.mjs.
// Plain JS (not TS) so it can run unmodified on Vercel's Edge runtime and under plain Node,
// with zero build step and zero new dependencies.

const cryptoImpl = globalThis.crypto;

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // tolerate ±1 step (±30s) of clock drift
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // exactly 2 hours

export const ACCESS_COOKIE_NAME = 'ybuy_access';

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

function counterToBytes(counter) {
  const bytes = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
}

async function hmac(keyBytes, msgBytes, hash) {
  const key = await cryptoImpl.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign']);
  const sig = await cryptoImpl.subtle.sign('HMAC', key, msgBytes);
  return new Uint8Array(sig);
}

async function totpAt(secretBase32, counter) {
  const digest = await hmac(base32Decode(secretBase32), counterToBytes(counter), 'SHA-1');
  const offset = digest[digest.length - 1] & 0x0f;
  const binCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binCode % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies a 6-digit code against the server-side TOTP secret using server time. */
export async function verifyTotp(secretBase32, code, nowMs = Date.now()) {
  const trimmed = String(code ?? '').trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const counter = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    const expected = await totpAt(secretBase32, counter + drift);
    if (timingSafeEqualStr(expected, trimmed)) return true;
  }
  return false;
}

/** Test-only: computes the code an authenticator app would show right now, to verify the positive path. */
export async function computeTotpForTest(secretBase32, nowMs = Date.now()) {
  return totpAt(secretBase32, Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS));
}

function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Mints a signed, stateless session token: base64url(payload).base64url(signature). No DB/KV needed. */
export async function signAccessSession(sessionSecret, nowMs = Date.now()) {
  const expiresAt = nowMs + SESSION_TTL_MS;
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ expiresAt }));
  const sig = await hmac(new TextEncoder().encode(sessionSecret), payloadBytes, 'SHA-256');
  return { token: `${toBase64Url(payloadBytes)}.${toBase64Url(sig)}`, expiresAt };
}

/** Verifies signature + expiry (server time only) — a tampered or expired token is rejected. */
export async function verifyAccessSession(sessionSecret, token, nowMs = Date.now()) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [payloadPart, sigPart] = parts;
  if (!payloadPart || !sigPart) return false;

  let payloadBytes;
  try {
    payloadBytes = fromBase64Url(payloadPart);
  } catch {
    return false;
  }

  const expectedSig = await hmac(new TextEncoder().encode(sessionSecret), payloadBytes, 'SHA-256');
  const expectedSigPart = toBase64Url(expectedSig);
  if (!timingSafeEqualStr(expectedSigPart, sigPart)) return false;

  try {
    const { expiresAt } = JSON.parse(new TextDecoder().decode(payloadBytes));
    return typeof expiresAt === 'number' && nowMs < expiresAt;
  } catch {
    return false;
  }
}
