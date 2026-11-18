import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import tzLookup from 'tz-lookup';
import { podman } from '../dev/podman.mjs';

const projectRef = process.argv[2];
assert.ok(!projectRef || projectRef === 'jzyjmsixfuwzfnntewqn',
  'This backfill supports only local Podman or the explicitly authorized YBuy test project.');

function query(sql) {
  if (projectRef) {
    const directory = mkdtempSync(join(tmpdir(), 'ybuy-timezone-'));
    try {
      const file = join(directory, 'query.sql');
      writeFileSync(file, `set extra_float_digits=3;\n${sql}`);
      const output = execFileSync(process.execPath, [resolve('node_modules', 'supabase', 'dist', 'supabase.js'),
        'db', 'query', '--linked', '--project-ref', projectRef, '--file', file, '--output', 'json'], {
        encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      });
      return JSON.parse(output).rows;
    } finally {
      rmSync(join(directory, 'query.sql'), { force: true });
      rmdirSync(directory);
    }
  }
  return execFileSync(podman, ['exec', '-i', 'supabase_db_YBuy', 'psql',
    '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8', input: `set extra_float_digits=3;\n${sql}`,
  }).trim();
}

const rows = query(`select coalesce(jsonb_agg(jsonb_build_object(
  'id',listing_id,'latitude',latitude::text,'longitude',longitude::text)),'[]') as locations
  from public.listing_pickup_locations where time_zone is null;`);
const locations = projectRef ? rows[0].locations : JSON.parse(rows);
assert.ok(Array.isArray(locations), 'Invalid pickup location response.');
const updates = locations.map(location => {
  assert.match(location.id, /^[a-f0-9-]{36}$/i);
  assert.match(location.latitude ?? '', /^-?\d+(\.\d+)?$/);
  assert.match(location.longitude ?? '', /^-?\d+(\.\d+)?$/);
  assert.ok(Number(location.latitude) >= -90 && Number(location.latitude) <= 90);
  assert.ok(Number(location.longitude) >= -180 && Number(location.longitude) <= 180);
  const zone = tzLookup(Number(location.latitude), Number(location.longitude));
  assert.match(zone, /^[A-Za-z0-9_+/-]+$/);
  return `update public.listing_pickup_locations set time_zone='${zone}'
    where listing_id='${location.id}' and time_zone is null
    and latitude::text='${location.latitude}' and longitude::text='${location.longitude}';`;
});
query(`begin;\n${updates.join('\n')}\ncommit;`);
const remaining = query('select count(*) as remaining from public.listing_pickup_locations where time_zone is null;');
assert.equal(projectRef ? Number(remaining[0].remaining) : Number(remaining), 0,
  'Some pickup locations changed during the backfill. Run it again.');
console.log(`Resolved ${locations.length} pickup timezone(s) from coordinates in ${projectRef ?? 'local Podman'}.`);
