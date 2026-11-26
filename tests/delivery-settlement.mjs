import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleRental } from '../supabase/functions/settle-rental/settlement.ts';

function fixture(overrides = {}) {
  const row = {
    booking_id: 'booking', payment_intent_id: 'pi_1', payment_amount: 150,
    deposit_amount: 0, owner_amount: 100, destination_account: 'acct_1',
    refund_status: 'not_required', refund_id: null, transfer_status: 'pending', transfer_id: null,
    delivery_refund_id: 're_delivery', delivery_refund_amount: 25,
    ...overrides,
  };
  const recorded = [];
  const services = {
    claim: async () => row,
    record: async (...args) => recorded.push(args),
    intent: async () => ({ id: 'pi_1', livemode: false, status: 'succeeded', currency: 'usd',
      amount_received: 15000, latest_charge: { id: 'ch_1', amount_refunded: 2500 } }),
    refund: async () => ({ id: 're_delivery', payment_intent: 'pi_1', amount: 2500,
      currency: 'usd', status: 'succeeded', livemode: false }),
    findDepositRefund: async () => null,
    createRefund: async () => { throw new Error('unexpected refund'); },
    accountReady: async () => true,
    transfer: async () => { throw new Error('unexpected transfer lookup'); },
    createTransfer: async (destination, source_transaction, amount) => ({
      id: 'tr_1', livemode: false, amount, currency: 'usd', destination, source_transaction, reversed: false,
    }),
  };
  return { services, recorded };
}

test('settles after verifying the delivery refund and deducting it from owner earnings', async () => {
  const { services, recorded } = fixture();
  await settleRental('booking', services);
  assert.deepEqual(recorded, [['transfer', 'tr_1', 'succeeded']]);
});

test('refuses settlement when the delivery refund receipt does not match', async () => {
  const { services } = fixture();
  services.refund = async () => ({ id: 're_delivery', payment_intent: 'pi_1', amount: 2400,
    currency: 'usd', status: 'succeeded', livemode: false });
  await assert.rejects(() => settleRental('booking', services), /delivery refund/i);
});

test('preserves settlement for legacy bookings without delivery refunds', async () => {
  const { services, recorded } = fixture({ delivery_refund_id: null, delivery_refund_amount: 0 });
  services.intent = async () => ({ id: 'pi_1', livemode: false, status: 'succeeded', currency: 'usd',
    amount_received: 15000, latest_charge: { id: 'ch_1', amount_refunded: 0 } });
  await settleRental('booking', services);
  assert.deepEqual(recorded, [['transfer', 'tr_1', 'succeeded']]);
});

test('settles when a captured deposit and delivery refund are both verified', async () => {
  const { services, recorded } = fixture({ refund_status: 'succeeded', refund_id: 're_deposit', deposit_amount: 10 });
  services.intent = async () => ({ id: 'pi_1', livemode: false, status: 'succeeded', currency: 'usd',
    amount_received: 15000, latest_charge: { id: 'ch_1', amount_refunded: 3500 } });
  services.refund = async (id) => ({ id, payment_intent: 'pi_1', amount: id === 're_deposit' ? 1000 : 2500,
    currency: 'usd', status: 'succeeded', livemode: false });
  await settleRental('booking', services);
  assert.deepEqual(recorded, [['refund', 're_deposit', 'succeeded'], ['transfer', 'tr_1', 'succeeded']]);
});
