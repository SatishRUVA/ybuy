import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rejects } from 'node:assert/strict';
import ts from 'typescript';
import type { DbBookingRow } from '../src/lib/bookings';

const ownerId = 'owner-test';
const renterId = 'renter-test';
const historical = {
  id: 'booking-test', booking_reference: 'YB-26-000123', listing_id: 'listing-test', owner_id: ownerId, renter_id: renterId,
  start_date: '2026-11-03', end_date: '2026-11-04', status: 'completed',
  quantity: 2, daily_rate: 10, days: 1, subtotal: 20, service_fee_amount: 4,
  insurance_amount: 1, deposit: 15, total: 40, created_at: '2026-11-02T00:00:00Z',
  listing: null, owner: null, renter: null,
  agreement: { snapshot: {
    listing: { title: 'Saved rental title', photos: [] },
    owner_name: 'Saved owner', renter_name: 'Saved renter',
  } },
} satisfies DbBookingRow;

function harness(rows: DbBookingRow[], message?: string) {
  const signed: unknown[] = [];
  const query = {
    select: () => query, eq: () => query,
    order: async () => ({ data: rows, error: message ? { message } : null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: message ? { message } : null }),
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync('src\\lib\\bookings.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    exports,
    require(name: string) {
      if (name === '@/lib/supabase') return { supabase: { from: () => query } };
      if (name === '@/lib/listings') return { signListingImages: async (images: unknown[]) => {
        signed.push(images);
        return images;
      } };
      throw new Error(`Unexpected booking import: ${name}`);
    },
  });
  return { api: exports as typeof import('../src/lib/bookings'), signed };
}

test('renter, owner and individual history retain RLS-hidden listings using saved agreement details', async () => {
  const h = harness([historical]);
  const renter = await h.api.fetchBookingsAsRenter(renterId);
  const owner = await h.api.fetchBookingsAsOwner(ownerId);
  const single = await h.api.fetchBookingById(historical.id, renterId);
  for (const booking of [renter[0], owner[0], single]) {
    expect(booking).toMatchObject({
      id: historical.id, bookingReference: 'YB-26-000123', listingTitle: 'Saved rental title', quantity: 2, total: 40,
    });
  }
  expect(renter[0]).toMatchObject({ counterpartName: 'Saved owner', counterpartId: ownerId, isOwner: false });
  expect(owner[0]).toMatchObject({ counterpartName: 'Saved renter', counterpartId: renterId, isOwner: true });
  expect(h.signed).toHaveLength(0);
});

test('one inaccessible listing cannot hide other bookings; visible photos still get signed', async () => {
  const visible = { ...historical, id: 'visible-booking', listing: {
    id: 'visible-listing', title: 'Current rental title', listing_images: [{ url: 'photo.jpg', sort_order: 0 }],
  } };
  const h = harness([historical, visible]);
  const rows = await h.api.fetchBookingsAsRenter(renterId);
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ listingTitle: 'Current rental title', listingImage: 'photo.jpg' });
  expect(h.signed).toHaveLength(1);
});

test('legacy history without snapshots is explicitly unavailable rather than an invented rental', async () => {
  const h = harness([{ ...historical, agreement: null }]);
  expect(await h.api.fetchBookingById(historical.id, renterId)).toMatchObject({
    listingTitle: 'Unavailable listing', counterpartName: 'Unavailable account',
  });
});

test('database authorization and loading failures remain visible to callers', async () => {
  const h = harness([], 'Booking access denied');
  await rejects(async () => h.api.fetchBookingById(historical.id, renterId), { message: 'Booking access denied' });
  await rejects(async () => h.api.fetchBookingsAsRenter(renterId), { message: 'Booking access denied' });
  await rejects(async () => h.api.fetchBookingsAsOwner(ownerId), { message: 'Booking access denied' });
});
