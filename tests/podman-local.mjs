import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { podman } from '../dev/podman.mjs';

const result = spawnSync(process.execPath, [
  'dev\\supabase-local.mjs', 'status', '--output', 'json',
], {
  encoding: 'utf8',
  timeout: 120_000,
  env: {
    ...process.env,
    DOCKER_HOST: 'tcp://127.0.0.1:1',
    DOCKER_CONTEXT: 'not-a-real-ybuy-context',
  },
});
if (result.error) throw result.error;
assert.equal(result.status, 0, `Podman status must ignore inherited Docker routing:\n${result.stderr}`);
const status = JSON.parse(result.stdout);
assert.equal(status.API_URL, 'http://127.0.0.1:54321');
assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Existing local keys must be available.');
const [logging] = JSON.parse(execFileSync(podman, ['inspect', 'supabase_vector_YBuy'], {
  encoding: 'utf8', timeout: 30_000,
}));
assert.ok(logging.Config.Env.includes('DOCKER_HOST=unix:///var/run/docker.sock'),
  'Vector must use Podman, not the Windows Docker TCP endpoint.');
assert.ok(logging.Mounts.some(mount => mount.Destination === '/var/run/docker.sock'),
  'Vector must have the Podman API socket mounted.');
const response = await fetch(`${status.API_URL}/auth/v1/health`, {
  signal: AbortSignal.timeout(10_000),
});
assert.equal(response.status, 200, 'The copied Auth service must be healthy.');
const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const objects = JSON.parse(execFileSync(podman, [
  'exec', 'supabase_db_YBuy', 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
  '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
  "select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'name',name)),'[]') from storage.objects;",
], { encoding: 'utf8', timeout: 30_000 }));
for (const object of objects) {
  const { data, error } = await client.storage.from(object.bucket).download(object.name);
  assert.equal(error, null, 'Copied Storage metadata must resolve to a downloadable file.');
  assert.ok(data.size > 0, 'Copied fixture files must not be empty.');
}
const edge = await fetch(`${status.API_URL}/functions/v1/create-checkout-session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
  signal: AbortSignal.timeout(10_000),
});
assert.equal(edge.status, 401, 'Edge Functions must resolve and reject signed-out checkout.');
const channel = client.channel(`podman-migration-${Date.now()}`);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timed out.')), 15_000);
    channel.subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`Realtime subscription failed: ${state}`));
      }
    });
  });
} finally {
  await client.removeChannel(channel);
}
console.log(`PASS Podman-only routing, Auth, ${objects.length} stored downloads, Edge auth rejection and Realtime.`);
