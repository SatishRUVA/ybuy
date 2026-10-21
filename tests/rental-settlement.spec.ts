import { expect, test } from '@playwright/test';
import { cents, requireTestSettlement, sameWorkerSecret, settleRental, type Settlement, type SettlementServices } from '../supabase/functions/settle-rental/settlement';

function fixture() {
  const calls: string[] = [];
  const row: Settlement = {
    booking_id: 'booking', payment_intent_id: 'pi_test', payment_amount: 72,
    deposit_amount: 50, owner_amount: 20, destination_account: 'acct_owner',
    refund_status: 'processing', refund_id: null, transfer_status: 'processing', transfer_id: null,
  };
  let refunded = 0;
  const refund = { id: 're_test', payment_intent: 'pi_test', amount: 5000, currency: 'usd', status: 'succeeded' };
  const transfer = { id: 'tr_test', livemode: false, amount: 2000, currency: 'usd',
    destination: 'acct_owner', source_transaction: 'ch_test', reversed: false };
  const services: SettlementServices = {
    async claim(step) { calls.push(`claim:${step}`); return { ...row }; },
    async record(step, id, status) {
      calls.push(`record:${step}:${status}`);
      if (step === 'refund') { row.refund_id = id; row.refund_status = status; }
      else { row.transfer_id = id; row.transfer_status = status; }
    },
    async intent() { return { id: 'pi_test', livemode: false, status: 'succeeded', currency: 'usd', amount_received: 7200,
      latest_charge: { id: 'ch_test', amount_refunded: refunded } }; },
    async refund() { calls.push('retrieve:refund'); return refund; },
    async findDepositRefund() { return null; },
    async createRefund(_intent, amount, key) {
      calls.push(`refund:${amount}:${key}`); refunded = amount; return refund;
    },
    async accountReady() { return true; },
    async transfer() { calls.push('retrieve:transfer'); return transfer; },
    async createTransfer(_destination, _charge, amount, key) {
      calls.push(`transfer:${amount}:${key}`); return transfer;
    },
  };
  return { calls, row, services, refund, transfer, setRefunded(value: number) { refunded = value; } };
}

test('deposit is refunded before exact rental subtotal is transferred; retry retrieves existing receipts', async () => {
  const f = fixture();
  await settleRental('booking', f.services);
  await settleRental('booking', f.services);
  expect(f.calls.filter((call) => call.startsWith('refund:'))).toEqual(['refund:5000:deposit:booking:v1']);
  expect(f.calls.filter((call) => call.startsWith('transfer:'))).toEqual(['transfer:2000:earnings:booking:v1']);
  expect(f.calls.indexOf('record:refund:succeeded')).toBeLessThan(f.calls.indexOf('claim:transfer'));
  expect(f.calls).toContain('retrieve:refund');
  expect(f.calls).toContain('retrieve:transfer');
});

test('live credentials, production backend and missing enable flag all fail closed', () => {
  expect(() => requireTestSettlement('sk_test_fixture', 'http://kong:8000', 'true')).not.toThrow();
  expect(() => requireTestSettlement('sk_live_fixture', 'http://kong:8000', 'true')).toThrow('disabled');
  expect(() => requireTestSettlement('sk_test_fixture', 'https://xwmnfnhnnxxaarbfkqrp.supabase.co', 'true')).toThrow('disabled');
  expect(() => requireTestSettlement('sk_test_fixture', 'http://kong:8000', undefined)).toThrow('disabled');
});

test('money conversion rejects invalid, fractional-cent, and unsafe values', () => {
  expect(cents(250.01)).toBe(25001);
  expect(cents(0)).toBe(0);
  for (const amount of [-1, NaN, Infinity, 0.001, Number.MAX_SAFE_INTEGER]) expect(() => cents(amount)).toThrow();
});

test('background worker requires the configured secret and rejects missing or wrong credentials', async () => {
  expect(await sameWorkerSecret('correct', 'correct')).toBe(true);
  expect(await sameWorkerSecret('incorrect', 'correct')).toBe(false);
  expect(await sameWorkerSecret(null, 'correct')).toBe(false);
  expect(await sameWorkerSecret('correct', undefined)).toBe(false);
});

for (const status of ['pending', 'failed', 'canceled', 'requires_action']) {
  test(`refund ${status} never triggers an owner transfer`, async () => {
    const f = fixture();
    f.refund.status = status;
    await expect(settleRental('booking', f.services)).rejects.toThrow(/refund (is processing|failed)/);
    expect(f.calls).not.toContain('claim:transfer');
  });
}

test('unresolved claims and aged unknown outcomes fail before provider money movement', async () => {
  for (const message of ['Settlement blocked by an unresolved dispute', 'Unknown refund outcome requires manual reconciliation']) {
    const f = fixture();
    f.services.claim = async () => { throw new Error(message); };
    await expect(settleRental('booking', f.services)).rejects.toThrow(message);
    expect(f.calls).toEqual([]);
  }
});

test('wrong, live, incomplete or underpaid payment intent never creates a refund', async () => {
  for (const patch of [{ livemode: true }, { amount_received: 7199 }, { currency: 'eur' }, { status: 'processing' }, { latest_charge: null }]) {
    const f = fixture();
    const base = await f.services.intent('pi_test');
    f.services.intent = async () => ({ ...base, ...patch });
    await expect(settleRental('booking', f.services)).rejects.toThrow('Stripe payment does not match');
    expect(f.calls.some((call) => call.startsWith('refund:'))).toBe(false);
  }
});

test('zero deposit skips refunds but still verifies no unrelated refunds exist', async () => {
  const f = fixture();
  f.row.deposit_amount = 0;
  f.row.refund_status = 'not_required';
  await settleRental('booking', f.services);
  expect(f.calls.some((call) => call.startsWith('refund:'))).toBe(false);
  expect(f.calls).toContain('record:transfer:succeeded');
});

test('Stripe-disputed charges are blocked before deposits are refunded', async () => {
  const f = fixture();
  const intent = await f.services.intent('pi_test');
  f.services.intent = async () => ({ ...intent, latest_charge: { id: 'ch_test', amount_refunded: 0, disputed: true } });
  await expect(settleRental('booking', f.services)).rejects.toThrow('Stripe payment does not match');
  expect(f.calls.some((call) => call.startsWith('refund:'))).toBe(false);
});

test('manual refunds cannot silently become an automatic deposit allocation', async () => {
  const f = fixture();
  f.setRefunded(1000);
  await expect(settleRental('booking', f.services)).rejects.toThrow('Existing refund requires reconciliation');
  expect(f.calls.some((call) => call.startsWith('refund:'))).toBe(false);
});

test('provider refund is recovered after database receipt write was lost', async () => {
  const f = fixture();
  f.setRefunded(5000);
  f.services.findDepositRefund = async () => f.refund;
  await settleRental('booking', f.services);
  expect(f.row.refund_id).toBe('re_test');
  expect(f.calls.some((call) => call.startsWith('refund:'))).toBe(false);
});

test('wrong refund amount and additional refunds block transfer', async () => {
  const f = fixture();
  f.refund.amount = 4900;
  await expect(settleRental('booking', f.services)).rejects.toThrow('refund receipt does not match');
  expect(f.calls).not.toContain('claim:transfer');
  const other = fixture();
  other.row.refund_id = 're_test';
  other.setRefunded(6000);
  await expect(settleRental('booking', other.services)).rejects.toThrow('Additional refunds');
  expect(other.calls).not.toContain('claim:transfer');
});

test('incomplete Connect onboarding does not mark earnings as paid', async () => {
  const f = fixture();
  f.services.accountReady = async () => false;
  await expect(settleRental('booking', f.services)).rejects.toThrow('not ready');
  expect(f.calls.some((call) => call.startsWith('transfer:'))).toBe(false);
  expect(f.row.transfer_status).toBe('processing');
});

test('transfer provider errors remain explicit and retry uses the same idempotency key', async () => {
  const f = fixture();
  const transfer = f.services.createTransfer;
  f.services.createTransfer = async () => { throw new Error('Insufficient test balance'); };
  await expect(settleRental('booking', f.services)).rejects.toThrow('Insufficient test balance');
  expect(f.row.transfer_id).toBeNull();
  f.services.createTransfer = transfer;
  await settleRental('booking', f.services);
  expect(f.calls).toContain('transfer:2000:earnings:booking:v1');
});

test('reversed or wrong-destination transfers cannot masquerade as bank payouts', async () => {
  const f = fixture();
  f.transfer.reversed = true;
  await expect(settleRental('booking', f.services)).rejects.toThrow('reversed');
  expect(f.row.transfer_status).toBe('reversed');
  const other = fixture();
  other.transfer.destination = 'acct_other';
  await expect(settleRental('booking', other.services)).rejects.toThrow('transfer receipt does not match');
  expect(other.row.transfer_id).toBeNull();
});
