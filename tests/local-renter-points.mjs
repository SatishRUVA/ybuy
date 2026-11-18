import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { localRenterPointsSql } from '../dev/local-renter-points.mjs';
import { podman } from '../dev/podman.mjs';

const ids = Array.from({ length: 4 }, () => randomUUID());
const suffix = Date.now();
function sql(input) {
  const result = spawnSync(podman, ['exec', '-i', 'supabase_db_YBuy', 'psql', '-X',
    '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input, encoding: 'utf8', timeout: 30_000,
  });
  if (result.error) throw result.error;
  return result;
}

const result = sql(`
begin;
update public.admin_financial_test_gate set environment='local_test',enabled=true;
insert into auth.users(id,email,created_at,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) values
 ('${ids[0]}','renter${suffix}@profiles.ybuy.test',clock_timestamp(),now(),'{"full_name":"Local renter seed fixture"}','{"local_test_fixture":"ybuy-local-profile-picker-v1"}'),
 ('${ids[1]}','owner${suffix}@profiles.ybuy.test',clock_timestamp(),now(),'{"full_name":"Local owner seed fixture"}','{"local_test_fixture":"ybuy-local-profile-picker-v1"}'),
 ('${ids[2]}','renter${suffix + 1}@profiles.ybuy.test',clock_timestamp(),now(),'{"full_name":"Unmarked seed fixture"}','{}'),
 ('${ids[3]}','renter${suffix + 2}@profiles.ybuy.test',clock_timestamp(),now(),'{"full_name":"Hosted seed fixture"}','{"local_test_fixture":"ybuy-local-lifecycle-v1"}');
${localRenterPointsSql}
${localRenterPointsSql}
do $assert$
begin
  if (select reward_balance from public.reward_wallets where user_id='${ids[0]}') is distinct from 500 then
    raise exception 'Local renter must start with exactly 500 points';
  end if;
  if (select count(*) from public.reward_transactions where user_id='${ids[0]}' and kind='signup')<>1 then
    raise exception 'Repeated seeding must create only one signup grant';
  end if;
  if exists(select 1 from public.reward_wallets where user_id in ('${ids[1]}','${ids[2]}','${ids[3]}')) then
    raise exception 'Owner, unmarked and hosted fixtures must not receive points';
  end if;
  if exists(select 1 from auth.users where id='${ids[0]}' and phone_confirmed_at is not null) then
    raise exception 'Seeding must not fake phone verification';
  end if;
end;
$assert$;
update public.reward_wallets set reward_balance=0 where user_id='${ids[0]}';
${localRenterPointsSql}
select reward_balance from public.reward_wallets where user_id='${ids[0]}';
rollback;
`);
assert.equal(result.status, 0, `Local renter points checks failed:\n${result.stderr}`);
assert.equal(result.stdout.trim(), '0', 'Restarting local setup must not refill an already-used balance.');

const disabled = sql(`begin;update public.admin_financial_test_gate set enabled=false;${localRenterPointsSql}rollback;`);
assert.notEqual(disabled.status, 0);
assert.match(disabled.stderr, /Local financial testing must be enabled/);
console.log('PASS local renter 500-point grant, idempotency, spent balance preservation, fixture isolation, unchanged verification and disabled-gate rejection. Fixtures rolled back.');
