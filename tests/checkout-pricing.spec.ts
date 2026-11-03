import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rejects } from 'node:assert/strict';
import ts from 'typescript';
import { insuranceAmountCents } from '../src/lib/insurance-pricing';
import { bookingTaxCents } from '../src/lib/booking-tax';
import type { ServerBookingPrice, SandboxPricingPolicy } from '../supabase/functions/_shared/checkout-pricing';
import type { TaxAddress, TaxRequest } from '../supabase/functions/_shared/tax-provider';

function load<T>(name: string): T {
  const source = readFileSync(`supabase\\functions\\_shared\\${name}.ts`, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(output, { exports, fetch, URLSearchParams, AbortSignal });
  return exports as T;
}

const { moneyToCents, quoteSandboxCheckout } = load<typeof import('../supabase/functions/_shared/checkout-pricing')>('checkout-pricing');
const { stripeTaxSandbox } = load<typeof import('../supabase/functions/_shared/tax-provider')>('tax-provider');
const { unavailableProtection } = load<typeof import('../supabase/functions/_shared/renter-protection')>('renter-protection');
const address: TaxAddress = { line1: '123 Test Street', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US', source: 'shipping' };
const input: TaxRequest = {
  currency: 'usd', address,
  lines: [{ reference: 'rental', amountCents: 10000, taxCode: 'txcd_99999999' }],
};
const booking: ServerBookingPrice = {
  bookingId: 'booking-test', categoryId: 'category-test', quantity: 2,
  startDate: '2026-11-02', endDate: '2026-11-04',
  rentalSubtotal: '100.00', serviceFee: '20.00', deliveryFee: '10.00',
  capturedDeposit: '60.00', replacementValuePerUnit: '200.01',
};
const policy: SandboxPricingPolicy = {
  taxReviewApproved: true, protectionRequired: false,
  taxCodes: { rental: 'txcd_99999999', service_fee: 'txcd_99999999', delivery: 'txcd_99999999', captured_deposit: 'txcd_99999999' },
};

function receipt(request: TaxRequest, taxCents = 825) {
  const subtotal = request.lines.reduce((sum, line) => sum + line.amountCents, 0);
  return {
    id: 'taxcalc_fixture', livemode: false, currency: 'usd',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    tax_amount_inclusive: 0, tax_amount_exclusive: taxCents, amount_total: subtotal + taxCents,
    line_items: {
      has_more: false, data: request.lines.map((line, index) => ({
        reference: line.reference, amount: line.amountCents, amount_tax: index === 0 ? taxCents : 0,
        tax_code: line.taxCode, livemode: false, quantity: 1, tax_behavior: 'exclusive',
      })),
    },
    tax_breakdown: [{
      amount: taxCents, inclusive: false, taxable_amount: subtotal,
      taxability_reason: taxCents ? 'standard_rated' : 'product_exempt',
      tax_rate_details: { country: 'US', state: request.address.state, percentage_decimal: '8.25', tax_type: 'sales_tax' },
    }],
  };
}

test('pricing foundation typechecks the actual server modules', () => {
  const program = ts.createProgram(['checkout-pricing', 'renter-protection', 'tax-provider'].map(name =>
    `supabase\\functions\\_shared\\${name}.ts`), {
    noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, skipLibCheck: true,
  });
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
});

test('ordinary booking requests do not require the optional owner-promo RPC', async () => {
  const source = readFileSync('src\\lib\\bookings.ts', 'utf8')
    .split('async function callBookingRpc(')[1].split('export async function respondToBookingRequest(')[0];
  const output = ts.transpileModule(`async function callBookingRpc(${source}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const exports: { createBookingRequest?: (params: { listingId: string; startDate: string; endDate: string; promotionCode?: string }) => Promise<unknown> } = {};
  runInNewContext(output, { exports, supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return fn === 'create_booking_request'
        ? { data: { id: 'booking-test' }, error: null }
        : { data: null, error: { message: 'Promo function unavailable' } };
    },
  } });
  const params = { listingId: 'listing-test', startDate: '2026-11-02', endDate: '2026-11-05' };
  for (const promotionCode of [undefined, '', '   ']) {
    expect(await exports.createBookingRequest!({ ...params, promotionCode })).toEqual({ id: 'booking-test' });
    expect(calls.at(-1)).toEqual({ fn: 'create_booking_request', args: {
      p_listing_id: params.listingId, p_start_date: params.startDate, p_end_date: params.endDate, p_quantity: 1,
      p_delivery_mode: 'pickup', p_renter_note: null,
    } });
  }
  await rejects(exports.createBookingRequest!({ ...params, promotionCode: ' SAVE10 ' }), /Promo function unavailable/);
  expect(calls.at(-1)).toMatchObject({ fn: 'create_booking_request_with_owner_promo', args: { p_code: 'SAVE10' } });
  expect(calls).toHaveLength(4);
});

test('default tax rounds discounted rental plus service fees, excluding all other charges', () => {
  expect(bookingTaxCents(25)).toBe(175);
  expect(bookingTaxCents(75)).toBe(525);
  expect(bookingTaxCents(60)).toBe(420);
  expect(bookingTaxCents(0.5)).toBe(4);
  expect(bookingTaxCents(0)).toBe(0);
  expect(bookingTaxCents(60, 6)).toBe(462);
  expect(bookingTaxCents(0.07, 0)).toBe(0);
  expect(bookingTaxCents(0.07, 0.01)).toBe(1);
  expect(bookingTaxCents(0.49, 0.01)).toBe(4);
  expect(bookingTaxCents(0, 0.5)).toBe(4);
  for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    expect(() => bookingTaxCents(value)).toThrow();
    expect(() => bookingTaxCents(0, value)).toThrow();
  }
});

test('actual checkout edge refuses sandbox tax with live keys before creating a session', () => {
  const source = readFileSync('supabase\\functions\\create-checkout-session\\index.ts', 'utf8');
  const helper = source.slice(source.indexOf('export function checkoutAmountCents('), source.indexOf('Deno.serve('));
  const output = ts.transpileModule(helper, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { checkoutAmountCents?: (booking: { total: unknown; sandbox_tax?: boolean; tax_amount?: unknown; tax_rate?: unknown }, key: string) => number } = {};
  runInNewContext(output, { exports, moneyToCents });
  const amount = exports.checkoutAmountCents!;
  for (const key of ['sk_test_fixture', 'rk_test_fixture']) {
    expect(amount({ total: '70.62', sandbox_tax: true, tax_amount: '4.62', tax_rate: '0.07' }, key)).toBe(7062);
    expect(amount({ total: '0.01', sandbox_tax: true, tax_amount: 0 }, key)).toBe(1);
  }
  for (const key of ['sk_live_fixture', 'rk_live_fixture', 'invalid', '']) {
    expect(() => amount({ total: 1, sandbox_tax: true, tax_amount: 0 }, key)).toThrow('test-mode');
  }
  for (const key of ['sk_live_fixture', 'rk_live_fixture', 'sk_test_fixture', 'rk_test_fixture']) {
    expect(amount({ total: '70.62', sandbox_tax: false, tax_amount: '4.62', tax_rate: '0.07' }, key)).toBe(7062);
  }
  expect(amount({ total: '10.29' }, 'sk_live_fixture')).toBe(1029);
  for (const total of [0, -1, NaN, Infinity, '1.001', '1.00000001', '90071992547409.92', null, {}]) {
    expect(() => amount({ total }, 'sk_test_fixture')).toThrow();
  }
  expect(source.indexOf('const amountCents = checkoutAmountCents(booking, stripeSecret)'))
    .toBeLessThan(source.indexOf('await stripe.checkout.sessions.create('));
  expect(source).toContain("select('*, listing:listings(title)')");
  expect(source).toContain('unit_amount: amountCents');
});

test('checkout handler charges normal tax with live or test keys but blocks historical sandbox tax on live keys', async () => {
  const source = readFileSync('supabase\\functions\\create-checkout-session\\index.ts', 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [key, sandboxTax, taxAmount, expectedStatus] of [
    ['sk_live_fixture', true, 0, 500], ['rk_live_fixture', true, 1.54, 500],
    ['sk_test_fixture', true, 1.54, 200], ['rk_test_fixture', true, 1.54, 200],
    ['sk_live_fixture', false, 0, 200], ['sk_live_fixture', false, 1.54, 200],
    ['rk_live_fixture', false, 1.54, 200], ['sk_test_fixture', false, 1.54, 200],
  ] as const) {
    let calls = 0;
    let chargedCents: number | undefined;
    let handler: ((req: Request) => Promise<Response>) | undefined;
    const booking = { id: 'booking-test', renter_id: 'renter-test', status: 'pending_payment',
      total: '42.54', sandbox_tax: sandboxTax, tax_amount: taxAmount, tax_rate: taxAmount > 0 || sandboxTax ? 0.07 : 0,
      listing: { title: 'Test camera' } };
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'renter-test' } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: booking, error: null }) }) }) }),
      rpc: async (name: string) => ({ error: null, data: name === 'has_active_session' ? true : {
        status: 'pending_payment', expires_at: '2026-11-02T15:00:00Z', server_now: '2026-11-02T14:00:00Z',
      } }),
    };
    class MockStripe {
      checkout = { sessions: { create: async (params: { line_items: { price_data: { unit_amount: number } }[] }) => {
        calls++; chargedCents = params.line_items[0].price_data.unit_amount;
        return { id: 'cs_mock', url: 'https://example.test/checkout', status: 'open' };
      } } };
    }
    runInNewContext(output, {
      exports: {}, Response, console: { error: () => {} },
      Deno: { env: { get: (name: string) => name === 'STRIPE_SECRET_KEY' ? key : 'fixture' },
        serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; } },
      require: (name: string) => name.startsWith('npm:stripe') ? { default: MockStripe }
        : name.startsWith('npm:@supabase') ? { createClient: () => client }
          : name.endsWith('checkout-pricing.ts') ? { moneyToCents }
            : { withCors: (fn: unknown) => fn, trustedOrigin: () => 'http://localhost:5174' },
    });
    const response = await handler!(new Request('http://localhost/checkout', {
      method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-test' }),
    }));
    expect(response.status).toBe(expectedStatus);
    expect(calls).toBe(expectedStatus === 200 ? 1 : 0);
    if (calls) expect(chargedCents).toBe(4254);
  }
});

test('USD conversion rejects precision loss, non-finite, negative and unsafe amounts', () => {
  expect(moneyToCents('0.29')).toBe(29);
  expect(moneyToCents('200.01')).toBe(20001);
  for (const value of ['1.001', '-1', 'NaN', 'Infinity', '1e3', '90071992547409.92']) {
    expect(() => moneyToCents(value)).toThrow();
  }
});

test('insurance amount charges one percent of item value per rental day', () => {
  expect(insuranceAmountCents(200, 2)).toBe(400);
  expect(insuranceAmountCents(200, 1, 3)).toBe(600);
  expect(insuranceAmountCents(200.01, 1)).toBe(200);
  expect(() => insuranceAmountCents(200, 0)).toThrow();
  expect(() => insuranceAmountCents(-1, 1)).toThrow();
  expect(() => insuranceAmountCents(200, 1, 0)).toThrow();
});

test('Stripe Tax uses approved line codes, sourced address and exclusive integer amounts', async () => {
  let encoded = '';
  const adapter = stripeTaxSandbox('sk_test_fixture', async (url, init) => {
    expect(url).toBe('https://api.stripe.com/v1/tax/calculations');
    encoded = String(init?.body);
    return Response.json(receipt(input));
  });
  const quote = await adapter.calculate(input);
  const body = new URLSearchParams(encoded);
  expect(body.get('customer_details[address][state]')).toBe('TX');
  expect(body.get('customer_details[address_source]')).toBe('shipping');
  expect(body.get('line_items[0][amount]')).toBe('10000');
  expect(body.get('line_items[0][tax_behavior]')).toBe('exclusive');
  expect(quote).toMatchObject({ subtotalCents: 10000, taxCents: 825, totalCents: 10825 });
  expect(() => stripeTaxSandbox('sk_live_fixture')).toThrow('test-mode');
});

test('tax provider failure, missing mappings and incomplete addresses fail explicitly', async () => {
  const adapter = stripeTaxSandbox('sk_test_fixture', async () => new Response('', { status: 503 }));
  await rejects(adapter.calculate(input), /unavailable/);
  await rejects(adapter.calculate({ ...input, address: { ...address, postal_code: '' } }), /complete/);
  await rejects(adapter.calculate({ ...input, lines: [{ ...input.lines[0], taxCode: '' }] }), /approved/);
});

test('altered totals, expired quotes, live receipts and unregistered collection fail closed', async () => {
  for (const patch of [
    { amount_total: 1 }, { expires_at: 1 }, { livemode: true },
    { tax_amount_inclusive: 825 }, { line_items: { has_more: true, data: [] } },
    { tax_breakdown: [{ ...receipt(input).tax_breakdown[0], taxability_reason: 'not_collecting' }] },
    { line_items: { has_more: false, data: [{ ...receipt(input).line_items.data[0], amount: 1 }] } },
  ]) {
    const adapter = stripeTaxSandbox('sk_test_fixture', async () => Response.json({ ...receipt(input), ...patch }));
    await rejects(adapter.calculate(input));
  }
});

test('legitimate nontaxable results and mixed charge taxability preserve provider breakdown', async () => {
  const request = { ...input, lines: [...input.lines, { reference: 'delivery', amountCents: 1000, taxCode: 'txcd_99999999' }] };
  const mixed = stripeTaxSandbox('sk_test_fixture', async () => Response.json(receipt(request)));
  expect((await mixed.calculate(request)).lines[1].taxCents).toBe(0);
  const exempt = stripeTaxSandbox('sk_test_fixture', async () => Response.json(receipt(input, 0)));
  expect((await exempt.calculate(input)).taxCents).toBe(0);
});

test('shared sandbox quote keeps captured deposit and proposed 40 percent hold separate', async () => {
  const tax = stripeTaxSandbox('sk_test_fixture', async (_url, init) => {
    const body = new URLSearchParams(String(init?.body));
    const lines = ['rental', 'service_fee', 'delivery', 'captured_deposit'].map((reference, i) => ({
      reference, amountCents: Number(body.get(`line_items[${i}][amount]`)), taxCode: 'txcd_99999999',
    }));
    return Response.json(receipt({ ...input, lines }));
  });
  const quote = await quoteSandboxCheckout(booking, address, policy, { tax, protection: unavailableProtection });
  expect(quote).toMatchObject({
    sandbox: true, payable: false, subtotalCents: 19000, taxCents: 825, totalCents: 19825,
    protection: { status: 'unavailable', premiumCents: 0 },
    proposedHold: { amountCents: 16001, percentage: 40, status: 'not_authorized' },
  });
});

test('unapproved tax, required protection and invalid dates cannot produce a quote', async () => {
  let taxCalls = 0;
  const tax = stripeTaxSandbox('sk_test_fixture', async () => { taxCalls++; return Response.json(receipt(input)); });
  const providers = { tax, protection: unavailableProtection };
  await rejects(quoteSandboxCheckout(booking, address, { ...policy, taxReviewApproved: false }, providers), /approval/);
  await rejects(quoteSandboxCheckout(booking, address, { ...policy, protectionRequired: true }, providers), /protection/);
  await rejects(quoteSandboxCheckout({ ...booking, startDate: '2026-02-30' }, address, policy, providers), /dates/);
  expect(taxCalls).toBe(0);
});
