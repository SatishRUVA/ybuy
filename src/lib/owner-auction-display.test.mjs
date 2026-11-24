import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlineLabel, winnerRental } from './owner-auction-display.ts';

test('deadline labels describe the active auction stage', () => {
  assert.equal(deadlineLabel('scheduled'), 'Bidding opens');
  assert.equal(deadlineLabel('open'), 'Bidding closes');
  assert.equal(deadlineLabel('owner_selection'), 'Decision due');
  assert.equal(deadlineLabel('awaiting_payment'), 'Payment due');
});

test('winner rental uses bid dates for flexible auctions and auction dates for fixed ones', () => {
  const auction = { start_date: '2026-11-24', end_date: '2026-11-30', date_flexible: false };
  const bid = { start_date: '2026-11-25', end_date: '2026-11-27', daily_rate: 14, total_value: 28 };
  assert.deepEqual(winnerRental(auction, bid), { start: '2026-11-24', end: '2026-11-30', subtotal: 84 });
  assert.deepEqual(winnerRental({ ...auction, date_flexible: true }, bid), { start: '2026-11-25', end: '2026-11-27', subtotal: 28 });
  assert.equal(winnerRental({ ...auction, date_flexible: true }, { ...bid, end_date: undefined }), null);
});
