import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const container = 'supabase_db_YBuy';
const database = `ybuy_reference_check_${randomBytes(6).toString('hex')}`;

function query(db, sql, onLine, hold = false) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db], { timeout: 180_000 });
  let output = '';
  let error = '';
  child.stdout.on('data', chunk => {
    output += chunk;
    onLine?.(output);
  });
  child.stderr.on('data', chunk => { error += chunk; });
  const result = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error || `psql exited ${code}`)));
  });
  if (hold) child.stdin.write(`${sql}\n`);
  else child.stdin.end(sql);
  result.commit = () => child.stdin.end('commit;\n');
  return result;
}

let created = false;
try {
  await query('postgres', `create database ${database};`);
  created = true;
  const migration = await readFile('supabase\\migrations\\20261102000006_customer_rental_references.sql', 'utf8');
  await query(database, `
    create table public.bookings(id integer primary key, created_at timestamptz not null);
    create table public.rental_agreements(booking_id integer, snapshot jsonb not null);
    create function public.reference_check_immutable() returns trigger language plpgsql as $$
    begin raise exception 'Immutable'; end $$;
    create trigger bookings_set_updated_at before update on public.bookings
      for each row execute function public.reference_check_immutable();
    create trigger agreement_immutable before update or delete on public.rental_agreements
      for each row execute function public.reference_check_immutable();
    ${migration}
    insert into public.customer_reference_counters values(2087,999998);
  `);
  let firstAllocated;
  const allocated = new Promise(resolve => { firstAllocated = resolve; });
  const first = query(database, `
    begin;
    set local statement_timeout='15s';
    set local idle_in_transaction_session_timeout='120s';
    insert into public.bookings values(1,'2087-01-01T00:00:00Z','YB-00-000001') returning booking_reference;
  `, output => { if (output.includes('YB-87-999999')) firstAllocated(); }, true);
  await Promise.race([allocated, first.then(() => { throw new Error('First allocation was not observed'); })]);
  const second = query(database, `
    begin;
    set local statement_timeout='120s';
    insert into public.bookings values(2,'2087-01-01T00:00:00Z','YB-00-000001') returning booking_reference;
    commit;
  `);
  let blocked = '0';
  for (let attempt = 0; attempt < 20 && blocked === '0'; attempt++) {
    blocked = await query(database, `
      select count(*) from pg_stat_activity
      where datname='${database}' and pid<>pg_backend_pid() and wait_event_type='Lock';
    `);
    if (blocked === '0') await new Promise(resolve => setTimeout(resolve, 50));
  }
  first.commit();
  const results = await Promise.all([first, second]);
  assert.equal(blocked, '1', 'Second allocator must actually wait on the first transaction');
  assert.equal(results[0], 'YB-87-999999');
  assert.equal(results[1], 'YB-87-1000000');
  assert.equal(await query(database, 'select count(distinct booking_reference) from public.bookings;'), '2');
  assert.equal(await query(database, 'select last_number from public.customer_reference_counters where booking_year=2087;'), '1000000');
  console.log('PASS: simultaneous allocator lock, unique references, supplied-number overwrite, six-digit overflow');
} finally {
  if (created) {
    await query('postgres', `drop database ${database} with (force);`);
    assert.equal(await query('postgres', `select count(*) from pg_database where datname='${database}';`), '0');
    console.log('PASS: isolated local database removed; no counters or fixtures persist');
  }
}
