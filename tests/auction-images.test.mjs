import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
after(() => server.close());
const { getListingAuctionFeed, getTopListingBids } = await server.ssrLoadModule('/src/lib/listing-auctions.ts');
const { supabase } = await server.ssrLoadModule('/src/lib/supabase.ts');
const originalRpc = supabase.rpc;
const originalStorageFrom = supabase.storage.from;
after(() => { supabase.rpc = originalRpc; supabase.storage.from = originalStorageFrom; });
const item = {
  listing_id: '30000000-0000-4000-8000-000000000001', title: 'Camera',
  category_id: '40000000-0000-4000-8000-000000000001', category_name: 'Cameras',
  daily_rate: 20, has_bids: true, start_date: '2026-11-24', end_date: '2026-11-25',
  expires_at: '2026-11-23T12:00:00Z',
};
const sources = [
  { name: 'private photo stored as public URL', url: 'https://example.supabase.co/storage/v1/object/public/listing-images/listing/camera%20photo.jpg', signed: true },
  { name: 'expired signed photo', url: 'https://example.supabase.co/storage/v1/object/sign/listing-images/listing/camera%20photo.jpg?token=expired', signed: true },
  { name: 'external photo', url: 'https://images.example.com/camera.jpg' },
  { name: 'no photo', url: null },
];
for (const feed of ['ticker', 'auction']) {
  for (const source of sources) {
    test(`${feed}: ${source.name}`, async () => {
      let signingCalls = 0;
      supabase.storage.from = bucket => {
        assert.equal(bucket, 'listing-images');
        return { createSignedUrl: async (path, ttl) => {
          signingCalls++;
          assert.equal(path, 'listing/camera photo.jpg');
          assert.equal(ttl, 3600);
          return { data: { signedUrl: 'https://signed.example.com/photo.jpg' }, error: null };
        } };
      };
      const row = { ...item, image_url: source.url };
      supabase.rpc = async () => ({ error: null, data: feed === 'ticker' ? [row]
        : { items: [row], categories: [], total: 1 } });
      const rows = feed === 'ticker' ? await getTopListingBids() : (await getListingAuctionFeed(null)).items;
      assert.equal(rows[0].image_url, source.signed ? 'https://signed.example.com/photo.jpg' : source.url);
      assert.equal(signingCalls, source.signed ? 1 : 0);
      assert.equal(row.image_url, source.url);
    });
  }
  test(`${feed}: signing failures surface instead of broken images`, async () => {
    supabase.storage.from = () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'Access denied' } }) });
    supabase.rpc = async () => ({ error: null, data: feed === 'ticker' ? [{ ...item, image_url: sources[0].url }]
      : { items: [{ ...item, image_url: sources[0].url }], categories: [], total: 1 } });
    await assert.rejects(feed === 'ticker' ? getTopListingBids() : getListingAuctionFeed(null), /Could not load a listing photo: Access denied/);
  });
}
