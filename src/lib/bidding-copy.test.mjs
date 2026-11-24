import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { biddingErrorMessage, biddingNotificationCopy } from './bidding-copy.ts';

test('bidding errors use bidding terminology', () => {
  assert.equal(biddingErrorMessage('An auction cannot be restarted.'), 'A bidding event cannot be restarted.');
  assert.equal(biddingErrorMessage('Auction dates are no longer available.'), 'Bidding dates are no longer available.');
  assert.equal(biddingErrorMessage('A completed auction cannot be restarted.'), 'Completed bidding cannot be restarted.');
});

test('bidding notifications change system copy without changing listing titles', () => {
  assert.deepEqual(
    biddingNotificationCopy('auction-outbid:123', 'You have been outbid', 'A higher bid has been placed on "Auction Camera". Open the auction to review your remaining bids.'),
    { title: 'You have been outbid', body: 'A higher bid has been placed on "Auction Camera". Open bidding to review your remaining bids.' },
  );
  assert.deepEqual(
    biddingNotificationCopy('listing:123', 'Auction Camera', 'Your auction item is ready.'),
    { title: 'Auction Camera', body: 'Your auction item is ready.' },
  );
  assert.deepEqual(
    biddingNotificationCopy('auction-not-selected:123', 'Not selected', 'The auction for "Auction Camera" ended without a completed booking.'),
    { title: 'Not selected', body: 'Bidding for "Auction Camera" ended without a completed booking.' },
  );
  assert.deepEqual(
    biddingNotificationCopy('checkout-exception:123', 'Payment requires support review', 'Do not pay again. Contact support to resolve this late auction payment.'),
    { title: 'Payment requires support review', body: 'Do not pay again. Contact support to resolve this late bidding payment.' },
  );
});
