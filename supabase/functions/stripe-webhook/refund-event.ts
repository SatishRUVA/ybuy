interface RefundEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: unknown };
}

export interface RefundReceipt {
  p_event_id: string;
  p_provider_ref: string;
  p_payment_intent_id: string;
  p_amount: number;
  p_currency: string;
  p_status: string;
  p_livemode: false;
}

export function testRefundReceipt(event: RefundEvent): RefundReceipt | null {
  if (!['refund.created', 'refund.updated', 'refund.failed'].includes(event.type) || event.livemode) return null;
  const object = event.data.object;
  if (!object || typeof object !== 'object') throw new Error('Missing refund payload');
  if (!('id' in object) || typeof object.id !== 'string' || !object.id ||
      !('payment_intent' in object) || !('amount' in object) || typeof object.amount !== 'number' ||
      !Number.isSafeInteger(object.amount) || object.amount <= 0 ||
      !('currency' in object) || typeof object.currency !== 'string' ||
      !('status' in object) || typeof object.status !== 'string' || !object.status) throw new Error('Incomplete refund receipt');
  const intent = object.payment_intent;
  const paymentIntent = typeof intent === 'string' ? intent :
    intent && typeof intent === 'object' && 'id' in intent && typeof intent.id === 'string' ? intent.id : null;
  if (!event.id || !paymentIntent) throw new Error('Incomplete refund receipt');
  return {
    p_event_id: event.id, p_provider_ref: object.id, p_payment_intent_id: paymentIntent,
    p_amount: object.amount / 100, p_currency: object.currency.toLowerCase(),
    p_status: object.status, p_livemode: false,
  };
}
