import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dev/configure-local-profiles.mjs', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '');

function configure(apiUrl, failed = false) {
  const calls = [];
  const writes = [];
  let seeds = 0;
  const run = () => runInNewContext(source, {
    assert, URL, process: { execPath: 'node' }, podman: 'local-podman',
    console: { log() {} },
    seedLocalRenterPoints: () => { seeds++; },
    existsSync: () => false,
    readFileSync: () => '',
    writeFileSync: (...args) => writes.push(args),
    spawnSync: (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'node') return { status: 0, stdout: JSON.stringify({
        API_URL: apiUrl, ANON_KEY: 'test-anon', SERVICE_ROLE_KEY: 'test-service',
      }) };
      return { status: failed ? 1 : 0, stdout: failed ? '' : 'local_test|t\n', stderr: failed ? 'Database unavailable' : '' };
    },
  });
  return { calls, writes, run, seedCount: () => seeds };
}

test('local setup enables financial testing only in the fixed local database container', () => {
  const fixture = configure('http://127.0.0.1:54321');
  fixture.run();
  assert.equal(fixture.calls.length, 2);
  const sql = fixture.calls[1];
  assert.equal(sql.command, 'local-podman');
  assert.deepEqual(Array.from(sql.args).slice(0, 4), ['exec', '-i', 'supabase_db_YBuy', 'psql']);
  assert.match(sql.options.input, /environment='local_test',enabled=true/);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.seedCount(), 1);
});

test('hosted, HTTPS and wrong-port URLs cannot enable financial testing', () => {
  for (const url of ['https://project.supabase.co', 'https://localhost:54321', 'http://localhost:54322']) {
    const fixture = configure(url);
    assert.throws(fixture.run, /Only isolated local Supabase is allowed/);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.seedCount(), 0);
  }
});

test('failed local gate updates stop setup instead of reporting success', () => {
  const fixture = configure('http://localhost:54321', true);
  assert.throws(fixture.run, /Could not enable isolated local financial testing/);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.seedCount(), 0);
});
