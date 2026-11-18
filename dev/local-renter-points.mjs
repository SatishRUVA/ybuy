import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { podman } from './podman.mjs';

export const localRenterPointsSql = `
do $points$
declare u record; v_claim uuid;
begin
  if not exists(select 1 from public.admin_financial_test_gate where enabled and environment='local_test') then
    raise exception 'Local financial testing must be enabled before seeding renter points';
  end if;
  for u in select id,email from auth.users
    where raw_app_meta_data->>'local_test_fixture'='ybuy-local-profile-picker-v1'
      and email ~ '^renter[1-9][0-9]*@profiles[.]ybuy[.]test$'
    order by id
  loop
    insert into public.reward_wallets(user_id) values(u.id) on conflict do nothing;
    perform 1 from public.reward_wallets where user_id=u.id for update;
    if exists(select 1 from public.reward_transactions where user_id=u.id and kind='signup') then continue; end if;
    insert into public.reward_signup_claims(user_id,email_hash,phone_hash) values(
      u.id,encode(sha256(convert_to(lower(u.email),'UTF8')),'hex'),
      encode(sha256(convert_to('local-renter-fixture:'||u.id::text,'UTF8')),'hex'))
      on conflict do nothing returning user_id into v_claim;
    if v_claim is null then
      raise exception 'Local renter fixture conflicts with an existing signup reward claim';
    end if;
    insert into public.reward_transactions(user_id,points,kind) values(u.id,500,'signup');
    update public.reward_wallets set reward_balance=reward_balance+500 where user_id=u.id;
  end loop;
end;
$points$;
`;

export function seedLocalRenterPoints() {
  const result = spawnSync(podman, ['exec', '-i', 'supabase_db_YBuy', 'psql', '-X',
    '-U', 'postgres', '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], {
    input: `begin;${localRenterPointsSql}commit;`, encoding: 'utf8', timeout: 30_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Could not seed local renter starting points.\n${result.stderr}`);
}
