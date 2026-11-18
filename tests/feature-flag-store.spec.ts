import { expect, test } from '@playwright/test';
import { createFeatureFlagStore, type FeatureFlag } from '../src/lib/feature-flag-store';

const row = (enabled: boolean, key = 'bidding'): FeatureFlag => ({
  key, enabled, description: 'Test flag', updated_at: new Date().toISOString(),
});

function harness(load: () => Promise<FeatureFlag[]>) {
  let changed = () => {};
  let status: (value: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED') => void = () => {};
  let connections = 0;
  let disconnections = 0;
  const store = createFeatureFlagStore({
    load,
    connect(onChange, onStatus) {
      connections += 1;
      changed = onChange;
      status = onStatus;
      return () => { disconnections += 1; };
    },
  });
  return {
    store, changed: () => changed(), status: (value: Parameters<typeof status>[0]) => status(value),
    connections: () => connections, disconnections: () => disconnections,
  };
}

test('consumers share one subscription and updates, inserts and deletions refresh the snapshot', async () => {
  let data = [row(true)];
  const h = harness(async () => data);
  const first = h.store.subscribe(() => {});
  const second = h.store.subscribe(() => {});
  expect(h.connections()).toBe(1);
  h.status('SUBSCRIBED');
  await expect.poll(() => h.store.getSnapshot().data).toEqual(data);
  data = [row(false), row(true, 'item_requests')];
  h.changed();
  await expect.poll(() => h.store.getSnapshot().data).toEqual(data);
  data = [];
  h.changed();
  await expect.poll(() => h.store.getSnapshot().data).toEqual([]);
  first();
  expect(h.disconnections()).toBe(0);
  second();
  expect(h.disconnections()).toBe(1);
});

test('an event during a snapshot cannot be overwritten by the stale response', async () => {
  const resolvers: ((value: FeatureFlag[]) => void)[] = [];
  const h = harness(() => new Promise((resolve) => resolvers.push(resolve)));
  const unsubscribe = h.store.subscribe(() => {});
  h.status('SUBSCRIBED');
  h.changed();
  resolvers[0]([row(true)]);
  await expect.poll(() => resolvers.length).toBe(2);
  expect(h.store.getSnapshot().data).toBeNull();
  resolvers[1]([row(false)]);
  await expect.poll(() => h.store.getSnapshot().data?.[0].enabled).toBe(false);
  unsubscribe();
});

test('disconnects fail closed and reconnect refreshes changes missed while offline', async () => {
  let data = [row(true)];
  const h = harness(async () => data);
  const unsubscribe = h.store.subscribe(() => {});
  h.status('SUBSCRIBED');
  await expect.poll(() => h.store.getSnapshot().loading).toBe(false);
  h.status('CHANNEL_ERROR');
  expect(h.store.getSnapshot().error).toContain('disconnected');
  data = [row(false)];
  h.status('SUBSCRIBED');
  expect(h.store.getSnapshot().loading).toBe(true);
  await expect.poll(() => h.store.getSnapshot()).toEqual({ data, loading: false, error: null });
  unsubscribe();
});

test('snapshot failures surface an error and retry automatically without user action', async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) throw new Error('Snapshot unavailable');
    return [row(false)];
  });
  const unsubscribe = h.store.subscribe(() => {});
  h.status('SUBSCRIBED');
  await expect.poll(() => h.store.getSnapshot().error).toBe('Snapshot unavailable');
  await expect.poll(() => h.store.getSnapshot().data?.[0].enabled, { timeout: 5000 }).toBe(false);
  expect(h.store.getSnapshot().error).toBeNull();
  unsubscribe();
});

test('cleanup ignores in-flight snapshots and stale channel callbacks', async () => {
  let resolve!: (value: FeatureFlag[]) => void;
  const h = harness(() => new Promise((done) => { resolve = done; }));
  const unsubscribe = h.store.subscribe(() => {});
  h.status('SUBSCRIBED');
  unsubscribe();
  resolve([row(true)]);
  h.status('CHANNEL_ERROR');
  await new Promise((done) => setTimeout(done, 0));
  expect(h.store.getSnapshot()).toEqual({ data: null, loading: true, error: null });
});
