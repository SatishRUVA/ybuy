import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseEnv } from 'node:util';

const source = readFileSync('.env.local', 'utf8');
const config = parseEnv(source);
assert.ok(/^(sk_test_|rk_test_)/.test(config.STRIPE_SECRET_KEY ?? ''), 'Local webhooks require a Stripe test-mode key.');
const status = JSON.parse(execFileSync(process.execPath, ['dev\\supabase-local.mjs', 'status', '--output', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
assert.equal(new URL(status.API_URL).origin, 'http://127.0.0.1:54321', 'Only isolated local Supabase is allowed.');
const env = { ...process.env, STRIPE_API_KEY: config.STRIPE_SECRET_KEY };
let secret;
try {
  secret = execFileSync('stripe', ['listen', '--skip-update', '--print-secret'], {
    encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
  }).match(/\bwhsec_[A-Za-z0-9]+\b/)?.[0];
} catch {
  throw new Error('Stripe CLI could not configure local webhooks. Check the CLI installation and test-mode access.');
}
assert.ok(secret, 'Stripe CLI did not provide a local webhook signing secret.');
const envFile = '.env.local-stripe.local';
const contents = source.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?STRIPE_WEBHOOK_SECRET\s*=/.test(line)).join('\n');
writeFileSync(envFile, `${contents}\nSTRIPE_WEBHOOK_SECRET=${secret}\n`, { mode: 0o600 });
console.log(`Local test webhook environment configured. Serve functions with --env-file ${envFile}.`);

const listener = spawn('stripe', ['listen', '--skip-update', '--forward-to', `${status.API_URL}/functions/v1/stripe-webhook`,
  '--events', [
    'checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'payment_intent.amount_capturable_updated', 'payment_intent.succeeded', 'payment_intent.canceled',
    'payment_intent.payment_failed', 'payment_intent.requires_action',
    'refund.created', 'refund.updated', 'refund.failed', 'transfer.updated', 'transfer.reversed',
  ].join(',')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [listener.stdout, listener.stderr]) {
  createInterface({ input: stream }).on('line', line => {
    const announcedSecret = line.match(/\bwhsec_[A-Za-z0-9]+\b/)?.[0];
    if (announcedSecret && announcedSecret !== secret) {
      console.error('Stripe listener signing secret changed. Restart local webhook configuration.');
      process.exitCode = 1;
      listener.kill();
      return;
    }
    console.log(line.replace(/whsec_[A-Za-z0-9]+/g, '[redacted webhook secret]'));
  });
}
listener.on('error', error => { console.error(`Local Stripe listener failed: ${error.message}`); process.exitCode = 1; });
listener.on('exit', code => { process.exitCode = process.exitCode || code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => listener.kill());
