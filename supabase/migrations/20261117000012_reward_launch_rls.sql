begin;

alter table public.reward_launch enable row level security;

commit;
