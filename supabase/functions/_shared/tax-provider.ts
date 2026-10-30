export interface TaxAddress {
  line1: string;
  city: string;
  state: string;
  postal_code: string;
  country: 'US';
  source: 'shipping' | 'billing';
}

export interface TaxLine {
  reference: string;
  amountCents: number;
  taxCode: string;
}

export interface TaxRequest {
  currency: 'usd';
  address: TaxAddress;
  lines: TaxLine[];
}

export interface TaxQuote {
  provider: 'stripe_tax';
  calculationId: string;
  currency: 'usd';
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  expiresAt: string;
  calculatedAt: string;
  lines: { reference: string; amountCents: number; taxCents: number; taxCode: string }[];
  breakdown: Record<string, unknown>[];
}

export interface TaxProvider {
  calculate(request: TaxRequest): Promise<TaxQuote>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Stripe Tax amount');
  return value;
}

export function stripeTaxSandbox(secret: string, request: typeof fetch = fetch): TaxProvider {
  if (!/^(sk|rk)_test_/.test(secret)) throw new Error('Stripe Tax sandbox requires a test-mode secret');
  return {
    async calculate(input) {
      const { address, lines } = input;
      if (input.currency !== 'usd' || address.country !== 'US'
        || !['shipping', 'billing'].includes(address.source)
        || [address.line1, address.city, address.state, address.postal_code].some(value => typeof value !== 'string' || !value.trim())
        || lines.length === 0 || lines.length > 100 || new Set(lines.map(line => line.reference)).size !== lines.length) {
        throw new Error('A complete sourced US tax address and unique tax lines are required');
      }
      const body = new URLSearchParams({
        currency: 'usd', 'customer_details[address_source]': address.source, 'expand[0]': 'line_items',
      });
      for (const key of ['line1', 'city', 'state', 'postal_code', 'country'] as const) {
        body.set(`customer_details[address][${key}]`, address[key]);
      }
      lines.forEach((line, index) => {
        if (!line.reference.trim() || !/^txcd_\d{8}$/.test(line.taxCode) || cents(line.amountCents) <= 0) {
          throw new Error('Each charge requires an approved Stripe tax code and a positive amount');
        }
        body.set(`line_items[${index}][amount]`, String(line.amountCents));
        body.set(`line_items[${index}][reference]`, line.reference);
        body.set(`line_items[${index}][tax_code]`, line.taxCode);
        body.set(`line_items[${index}][tax_behavior]`, 'exclusive');
        body.set(`line_items[${index}][quantity]`, '1');
      });
      const response = await request('https://api.stripe.com/v1/tax/calculations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-12-18.acacia' },
        body, signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`Stripe Tax calculation unavailable (HTTP ${response.status}); retry before paying`);
      const data: unknown = await response.json();
      if (!record(data) || data.livemode !== false || data.currency !== 'usd'
        || typeof data.id !== 'string' || !data.id.startsWith('taxcalc_')
        || typeof data.expires_at !== 'number' || !Number.isSafeInteger(data.expires_at)
        || data.expires_at <= Date.now() / 1000
        || !record(data.line_items) || data.line_items.has_more !== false || !Array.isArray(data.line_items.data)
        || data.line_items.data.length !== lines.length || !Array.isArray(data.tax_breakdown)
        || data.tax_breakdown.length === 0 || data.tax_amount_inclusive !== 0) {
        throw new Error('Stripe Tax returned an invalid, incomplete or expired calculation');
      }
      const parsed = data.line_items.data.map(value => {
        if (!record(value) || value.livemode !== false || value.quantity !== 1 || value.tax_behavior !== 'exclusive') {
          throw new Error('Invalid Stripe Tax line item');
        }
        const expected = lines.find(line => line.reference === value.reference);
        if (!expected || value.amount !== expected.amountCents || value.tax_code !== expected.taxCode) {
          throw new Error('Stripe Tax line does not match the requested charge');
        }
        return { reference: expected.reference, amountCents: cents(value.amount), taxCents: cents(value.amount_tax), taxCode: expected.taxCode };
      });
      if (new Set(parsed.map(line => line.reference)).size !== lines.length) throw new Error('Duplicate Stripe Tax lines');
      const breakdown = data.tax_breakdown.map(value => {
        if (!record(value) || value.inclusive !== false || typeof value.taxability_reason !== 'string'
          || value.taxability_reason === 'not_collecting') {
          throw new Error('Tax collection registration or taxability requires review');
        }
        cents(value.amount);
        cents(value.taxable_amount);
        if (!record(value.tax_rate_details) || value.tax_rate_details.country !== 'US') throw new Error('Invalid tax jurisdiction');
        return value;
      });
      const subtotal = parsed.reduce((sum, line) => sum + line.amountCents, 0);
      const tax = cents(data.tax_amount_exclusive);
      const total = cents(data.amount_total);
      if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(subtotal + tax)
        || total !== subtotal + tax || parsed.reduce((sum, line) => sum + line.taxCents, 0) !== tax
        || breakdown.reduce((sum, line) => sum + cents(line.amount), 0) !== tax) {
        throw new Error('Stripe Tax totals do not reconcile');
      }
      return {
        provider: 'stripe_tax', calculationId: data.id, currency: 'usd',
        subtotalCents: subtotal, taxCents: tax, totalCents: total,
        expiresAt: new Date(data.expires_at * 1000).toISOString(), calculatedAt: new Date().toISOString(),
        lines: parsed, breakdown,
      };
    },
  };
}
