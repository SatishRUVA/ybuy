import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as pickupTimeZone from './pickup-timezone.ts';

test('auction cutoff uses the pickup time zone rather than the device time zone', async () => {
  assert.equal(typeof pickupTimeZone.pickupMidnight, 'function');
  assert.equal(await pickupTimeZone.pickupMidnight('2026-11-26', 'America/Los_Angeles'), '2026-11-26T08:00:00.000Z');
  assert.equal(await pickupTimeZone.pickupMidnight('2026-07-26', 'America/Los_Angeles'), '2026-07-26T07:00:00.000Z');
});

test('ambiguous or nonexistent pickup midnights do not silently produce a schedule', async () => {
  assert.equal(typeof pickupTimeZone.pickupMidnight, 'function');
  await assert.rejects(() => pickupTimeZone.pickupMidnight('2018-11-04', 'America/Sao_Paulo'));
});
