import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDeliveryRefund } from '../supabase/functions/process-delivery-handoff-refund/refund.ts';

function fixture() {
  const claim = { case_id: 'case-1', booking_id: 'booking-1', payment_intent_id: 'pi_1',
    payment_amount: 150, amount: 25, currency: 'usd', deposit_refund_id: null, deposit_amount: 0 };
  const refunds = [];
  const records = [];
  const flags = [];
  return { claim, refunds, records, flags, services: {
    intent: async () => ({ id: 'pi_1', status: 'succeeded', currency: 'usd', amount_received: 15000,
      livemode: false, latest_charge: { id: 'ch_1', amount_refunded: refunds.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amount, 0), disputed: false } }),
    refunds: async () => refunds,
    noTransfer: async () => true,
    flag: async (reason) => flags.push(reason),
    create: async (id, amount, key) => {
      assert.equal(key, 'delivery-handoff:case-1:v1');
      const refund = { id: 're_1', payment_intent: id, amount, currency: 'usd', status: 'succeeded',
        livemode: false, metadata: { purpose: 'delivery_handoff', booking_id: 'booking-1', claim_id: 'case-1' } };
      refunds.push(refund);
      return refund;
    },
    record: async (refund) => records.push(refund),
  } };
}

test('refunds the approved delivery amount exactly and records a verified receipt', async () => {
  const { claim, services, records } = fixture();
  await processDeliveryRefund(claim, services, false);
  assert.equal(records[0].amount, 2500);
  assert.equal(records[0].status, 'succeeded');
});

test('retries recover the existing matching refund instead of issuing another', async () => {
  const { claim, services, refunds, records } = fixture();
  await processDeliveryRefund(claim, services, false);
  await processDeliveryRefund(claim, services, false);
  assert.equal(refunds.length, 1);
  assert.equal(records.length, 2);
});

test('unknown refunds and mismatched provider receipts block processing', async () => {
  const { claim, services, refunds, records } = fixture();
  refunds.push({ id: 're_other', payment_intent: 'pi_1', amount: 1, currency: 'usd',
    status: 'succeeded', livemode: false, metadata: {} });
  await assert.rejects(() => processDeliveryRefund(claim, services, false), /reconciliation/i);
  assert.equal(records.length, 0);
});

test('accounts for a previously verified deposit refund before creating the delivery refund', async () => {
  const { claim, services, refunds, records } = fixture();
  claim.deposit_refund_id = 're_deposit';
  claim.deposit_amount = 10;
  refunds.push({ id: 're_deposit', payment_intent: 'pi_1', amount: 1000, currency: 'usd',
    status: 'succeeded', livemode: false, metadata: { purpose: 'deposit', booking_id: 'booking-1' } });
  await processDeliveryRefund(claim, services, false);
  assert.equal(records[0].amount, 2500);
  assert.equal(refunds.length, 2);
});

test('does not record a mismatched or unverified provider receipt', async () => {
  const { claim, services, records } = fixture();
  services.create = async () => ({ id: 're_1', payment_intent: 'pi_1', amount: 2500,
    currency: 'eur', status: 'succeeded', livemode: false,
    metadata: { purpose: 'delivery_handoff', booking_id: 'booking-1', claim_id: 'case-1' } });
  await assert.rejects(() => processDeliveryRefund(claim, services, false), /reconciliation/i);
  assert.equal(records.length, 0);
});

test('blocks a refund when Stripe reports an owner transfer even if the database has no transfer record', async () => {
  const { claim, services, records, flags } = fixture();
  services.noTransfer = async () => false;
  await assert.rejects(() => processDeliveryRefund(claim, services, false), /transfer.*reconciliation/i);
  assert.equal(records.length, 0);
  assert.equal(flags.length, 1);
});
