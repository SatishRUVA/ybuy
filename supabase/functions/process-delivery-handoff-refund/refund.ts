import { cents } from '../settle-rental/settlement.ts';

export interface Claim {
  case_id: string; booking_id: string; payment_intent_id: string;
  payment_amount: number; amount: number; currency: string;
  deposit_refund_id: string | null; deposit_amount: number;
}
export interface Refund {
  id: string; payment_intent: string | null; amount: number; currency: string;
  status: string | null; livemode: boolean; metadata: Record<string, string>;
}
export interface Services {
  intent(id: string): Promise<{ id: string; status: string; currency: string; amount_received: number;
    livemode: boolean; latest_charge: { id: string; amount_refunded: number; disputed: boolean } | null }>;
  refunds(id: string): Promise<Refund[]>;
  noTransfer(charge: string, bookingId: string): Promise<boolean>;
  flag(reason: string): Promise<void>;
  create(id: string, amount: number, key: string): Promise<Refund>;
  record(refund: Refund): Promise<void>;
}

export async function processDeliveryRefund(claim: Claim, services: Services, live: boolean): Promise<void> {
  const amount = cents(claim.amount);
  if (!amount || claim.currency !== 'usd') throw new Error('Invalid approved refund');
  const intent = await services.intent(claim.payment_intent_id);
  if (intent.id !== claim.payment_intent_id || intent.livemode !== live || intent.status !== 'succeeded'
    || intent.currency !== claim.currency || intent.amount_received !== cents(claim.payment_amount)
    || !intent.latest_charge || intent.latest_charge.disputed) throw new Error('Payment requires reconciliation');
  if (!await services.noTransfer(intent.latest_charge.id, claim.booking_id)) {
    await services.flag('Owner transfer found at payment provider');
    throw new Error('Owner transfer requires reconciliation');
  }
  const refunds = await services.refunds(intent.id);
  const delivery = refunds.filter((r) => r.metadata.purpose === 'delivery_handoff'
    && r.metadata.booking_id === claim.booking_id && r.metadata.claim_id === claim.case_id);
  const deposit = refunds.filter((r) => r.id === claim.deposit_refund_id);
  if (delivery.length > 1 || refunds.length !== delivery.length + deposit.length
    || (claim.deposit_refund_id ? deposit.length !== 1 : deposit.length !== 0)) {
    throw new Error('Existing refunds require reconciliation');
  }
  const matches = (r: Refund, expected: number) => r.payment_intent === intent.id
    && r.amount === expected && r.currency === claim.currency && r.livemode === live;
  if (deposit.length && (!matches(deposit[0], cents(claim.deposit_amount)) || deposit[0].status !== 'succeeded')) {
    throw new Error('Deposit refund requires reconciliation');
  }
  if (delivery.length && !matches(delivery[0], amount)) throw new Error('Delivery refund requires reconciliation');
  const refunded = refunds.filter((r) => r.status === 'succeeded').reduce((sum, r) => sum + r.amount, 0);
  if (intent.latest_charge.amount_refunded !== refunded || refunded + (delivery.length ? 0 : amount) > intent.amount_received) {
    throw new Error('Refund balance requires reconciliation');
  }
  const refund = delivery[0] ?? await services.create(intent.id, amount, `delivery-handoff:${claim.case_id}:v1`);
  if (!matches(refund, amount) || refund.metadata.purpose !== 'delivery_handoff'
    || refund.metadata.booking_id !== claim.booking_id || refund.metadata.claim_id !== claim.case_id
    || !refund.id.startsWith('re_')) throw new Error('Delivery refund receipt requires reconciliation');
  await services.record(refund);
}
