import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync('supabase\\functions\\expire-checkout-sessions\\index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function runWorker(status: string, paymentStatus = 'unpaid', verified = true, expirationStatus = 'expired', intentStatus?: string) {
  const calls: string[] = [];
  let handler!: (request: Request) => Promise<Response>;
  const session = {
    id: 'cs_fixture', status, payment_status: paymentStatus, livemode: false, currency: 'usd',
    payment_intent: 'pi_fixture', amount_total: 12345, metadata: { booking_id: 'booking-fixture' },
  };
  class Stripe {
    checkout = { sessions: {
      retrieve: async () => session,
      expire: async () => { calls.push('expire-stripe'); return { status: expirationStatus }; },
    } };
    paymentIntents = {
      retrieve: async () => ({
        id: 'pi_fixture', status: intentStatus ?? (verified && paymentStatus === 'paid' ? 'succeeded' : 'processing'),
        currency: 'usd', livemode: false, amount_received: 12345,
      }),
      cancel: async () => { calls.push('cancel-intent'); return { status: 'canceled' }; },
    };
  }
  const admin = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push(name);
      if (name === 'confirm_booking_payment') expect(args).toMatchObject({
        p_booking_id: 'booking-fixture', p_checkout_session_id: 'cs_fixture', p_payment_intent_id: 'pi_fixture', p_amount: 123.45,
      });
      return { data: 0, error: null };
    },
    from: () => ({
      select: () => {
        const query = {
          eq: () => query, not: () => query, is: () => query,
          limit: async () => ({ data: [{ id: 'booking-fixture', checkout_session_id: 'cs_fixture' }], error: null }),
        };
        return query;
      },
      update: () => ({ eq: async () => { calls.push('mark-closed'); return { error: null }; } }),
    }),
  };
  const env: Record<string, string> = {
    NOTIFICATION_WORKER_SECRET: 'test-secret',
    SUPABASE_URL: 'https://jzyjmsixfuwzfnntewqn.supabase.co',
    STRIPE_SECRET_KEY: 'sk_test_fixture',
  };
  runInNewContext(compiled, {
    Stripe, createClient: () => admin, Response,
    console: { error() {} },
    Deno: { serve: (value: typeof handler) => { handler = value; }, env: { get: (name: string) => env[name] } },
  });
  const response = await handler(new Request('https://example.test/worker', {
    method: 'POST', headers: { 'x-notification-worker-secret': 'test-secret' },
  }));
  return { calls, response };
}

test('checkout worker never releases a completed session with a delayed payment', async () => {
  const { calls, response } = await runWorker('complete');
  expect(response.status).toBe(200);
  expect(calls).toEqual(['expire_checkout_reservations']);
});

test('checkout worker verifies and reconciles a paid winner before any runner-up can advance', async () => {
  const { calls, response } = await runWorker('complete', 'paid');
  expect(response.status).toBe(200);
  expect(calls).toEqual(['expire_checkout_reservations', 'confirm_booking_payment']);
});

test('checkout worker fails closed if payment verification is still processing', async () => {
  const { calls, response } = await runWorker('complete', 'paid', false);
  expect(response.status).toBe(500);
  expect(calls).toEqual(['expire_checkout_reservations']);
});

test('checkout worker marks closure only after Stripe expiration succeeds', async () => {
  const { calls, response } = await runWorker('open');
  expect(response.status).toBe(200);
  expect(calls).toEqual(['expire_checkout_reservations', 'expire-stripe', 'mark-closed']);
});

test('checkout worker does not release inventory if Stripe expiration is unconfirmed', async () => {
  const { calls, response } = await runWorker('open', 'unpaid', true, 'complete');
  expect(response.status).toBe(500);
  expect(calls).not.toContain('mark-closed');
});

test('checkout worker accepts an already-expired unpaid Stripe session', async () => {
  const { calls, response } = await runWorker('expired');
  expect(response.status).toBe(200);
  expect(calls).toEqual(['expire_checkout_reservations', 'mark-closed']);
});

test('checkout worker cancels failed delayed-payment intents before passing a winner', async () => {
  const { calls, response } = await runWorker('complete', 'unpaid', true, 'expired', 'requires_payment_method');
  expect(response.status).toBe(200);
  expect(calls).toEqual(['expire_checkout_reservations', 'cancel-intent', 'mark-closed']);
});
