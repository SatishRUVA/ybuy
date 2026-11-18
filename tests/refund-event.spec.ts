import { expect, test } from '@playwright/test';
import { testRefundReceipt } from '../supabase/functions/stripe-webhook/refund-event';

const event = {
  id: 'evt_test_refund', type: 'refund.updated', livemode: false,
  data: { object: { id: 're_test', payment_intent: 'pi_test', amount: 25001, currency: 'USD', status: 'succeeded' } },
};

test('test refund receipts use provider amounts and stable event IDs', () => {
  const receipt = testRefundReceipt(event);
  expect(receipt).toEqual({
    p_event_id: 'evt_test_refund', p_provider_ref: 're_test', p_payment_intent_id: 'pi_test',
    p_amount: 250.01, p_currency: 'usd', p_status: 'succeeded', p_livemode: false,
  });
  expect(testRefundReceipt(event)).toEqual(receipt);
});

test('live refunds and unrelated checkout events are not handled as test refunds', () => {
  expect(testRefundReceipt({ ...event, livemode: true })).toBeNull();
  expect(testRefundReceipt({ ...event, type: 'checkout.session.completed' })).toBeNull();
});

test('invalid receipts fail explicitly and expanded payment intents are supported', () => {
  expect(() => testRefundReceipt({ ...event, data: { object: { ...event.data.object, amount: 0 } } })).toThrow('Incomplete refund receipt');
  expect(() => testRefundReceipt({ ...event, data: { object: { ...event.data.object, payment_intent: null } } })).toThrow('Incomplete refund receipt');
  expect(testRefundReceipt({ ...event, data: { object: { ...event.data.object, payment_intent: { id: 'pi_expanded' } } } })?.p_payment_intent_id).toBe('pi_expanded');
});
