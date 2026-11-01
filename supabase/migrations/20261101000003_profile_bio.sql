begin;

alter table public.profiles add column bio text
  constraint profiles_bio_length check (char_length(bio)<=500);
create trigger profiles_bio_reject_unsafe_text
  before insert or update on public.profiles
  for each row execute function public.reject_unsafe_text('500','bio');

commit;
