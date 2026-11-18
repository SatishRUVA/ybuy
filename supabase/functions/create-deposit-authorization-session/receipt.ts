interface AuthorizationReceipt {
  livemode: boolean;
  currency: string;
  capture_method: string;
  amount: number;
  status: string;
  metadata: Record<string, string>;
}

export function requirePendingAuthorizationReceipt(
  intent: AuthorizationReceipt, bookingId: string, authorizationId: string, amount: number,
): void {
  if (intent.livemode || intent.currency !== 'usd' || intent.capture_method !== 'manual'
    || intent.amount !== Math.round(amount * 100)
    || intent.metadata?.booking_id !== bookingId || intent.metadata?.deposit_authorization_id !== authorizationId) {
    throw new Error('Authorization receipt does not match the booking; contact support.');
  }
  if (!['requires_capture', 'processing', 'requires_action', 'succeeded'].includes(intent.status)) {
    throw new Error('Authorization did not complete; contact support for reconciliation.');
  }
}
