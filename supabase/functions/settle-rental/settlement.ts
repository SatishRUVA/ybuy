export interface Settlement {
  booking_id: string;
  deposit_amount: number;
  owner_amount: number;
  payment_amount: number;
  payment_intent_id: string;
  destination_account: string | null;
  refund_status: string;
  refund_id: string | null;
  transfer_status: string;
  transfer_id: string | null;
}

interface Intent {
  id: string; livemode: boolean; status: string; currency: string; amount_received: number;
  latest_charge: { id: string; amount_refunded: number; disputed?: boolean } | null;
}
interface Refund {
  id: string; payment_intent: string | null; amount: number; currency: string;
  status: string | null;
}
interface Transfer {
  id: string; livemode: boolean; amount: number; currency: string;
  destination: string | null; source_transaction: string | null; reversed: boolean;
  amount_reversed?: number;
}
export interface SettlementServices {
  claim(step: 'refund' | 'transfer'): Promise<Settlement>;
  record(step: 'refund' | 'transfer', id: string, status: string): Promise<void>;
  intent(id: string): Promise<Intent>;
  refund(id: string): Promise<Refund>;
  findDepositRefund(intent: string): Promise<Refund | null>;
  createRefund(intent: string, amount: number, key: string): Promise<Refund>;
  accountReady(id: string): Promise<boolean>;
  transfer(id: string): Promise<Transfer>;
  createTransfer(destination: string, charge: string, amount: number, key: string): Promise<Transfer>;
}

export function cents(amount: number): number {
  const result = Math.round(Number(amount) * 100);
  if (!Number.isFinite(Number(amount)) || amount < 0 || !Number.isSafeInteger(result)
    || Math.abs(Number(amount) * 100 - result) > 0.00001) throw new Error('Invalid money amount');
  return result;
}

export function requireTestSettlement(key: string, url: string, enabled: string | undefined): void {
  const allowed = ['http://kong:8000', 'http://localhost:54321',
    'https://jzyjmsixfuwzfnntewqn.supabase.co'];
  if (enabled !== 'true' || !/^(sk|rk)_test_/.test(key) || !allowed.includes(url)) {
    throw new Error('Settlement is disabled: an isolated backend and Stripe test credentials are required');
  }
}

export async function sameWorkerSecret(actual: string | null, expected: string | undefined): Promise<boolean> {
  if (!actual || !expected) return false;
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([hash(actual), hash(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function settleRental(bookingId: string, services: SettlementServices): Promise<void> {
  let row = await services.claim('refund');
  const intent = await services.intent(row.payment_intent_id);
  if (intent.livemode || intent.id !== row.payment_intent_id || intent.status !== 'succeeded'
    || intent.currency !== 'usd' || intent.amount_received !== cents(row.payment_amount) || !intent.latest_charge
    || intent.latest_charge.disputed) {
    throw new Error('Stripe payment does not match the verified booking payment');
  }
  if (row.refund_status !== 'not_required') {
    const recovered = !row.refund_id ? await services.findDepositRefund(intent.id) : null;
    if (intent.latest_charge.amount_refunded > 0 && !row.refund_id && !recovered) {
      throw new Error('Existing refund requires reconciliation');
    }
    const refund = row.refund_id
      ? await services.refund(row.refund_id)
      : recovered ?? await services.createRefund(intent.id, cents(row.deposit_amount), `deposit:${bookingId}:v1`);
    if (refund.payment_intent !== intent.id || refund.amount !== cents(row.deposit_amount) || refund.currency !== 'usd') {
      throw new Error('Stripe deposit refund receipt does not match');
    }
    const status = refund.status === 'succeeded' ? 'succeeded'
      : ['failed', 'canceled'].includes(refund.status ?? '') ? 'failed' : 'processing';
    await services.record('refund', refund.id, status);
    if (status !== 'succeeded') throw new Error(status === 'failed'
      ? 'Deposit refund failed; manual reconciliation required' : 'Deposit refund is processing; owner transfer is waiting');
    const latest = await services.intent(intent.id);
    if (latest.latest_charge?.amount_refunded !== refund.amount) {
      throw new Error('Additional refunds require reconciliation before owner transfer');
    }
  } else if (intent.latest_charge.amount_refunded !== 0) {
    throw new Error('Existing refund requires reconciliation before owner transfer');
  }
  row = await services.claim('transfer');
  if (!row.destination_account || !await services.accountReady(row.destination_account)) {
    throw new Error('Owner Stripe Connect account is not ready to receive transfers');
  }
  const transfer = row.transfer_id ? await services.transfer(row.transfer_id)
    : await services.createTransfer(row.destination_account, intent.latest_charge.id,
      cents(row.owner_amount), `earnings:${bookingId}:v1`);
  if (transfer.livemode || transfer.amount !== cents(row.owner_amount) || transfer.currency !== 'usd'
    || transfer.destination !== row.destination_account || transfer.source_transaction !== intent.latest_charge.id) {
    throw new Error('Stripe transfer receipt does not match the owner earnings');
  }
  const reversed = transfer.reversed || (transfer.amount_reversed ?? 0) > 0;
  await services.record('transfer', transfer.id, reversed ? 'reversed' : 'succeeded');
  if (reversed) throw new Error('Owner transfer was reversed; manual reconciliation required');
}
