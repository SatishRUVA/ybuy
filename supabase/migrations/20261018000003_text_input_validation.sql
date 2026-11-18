-- Plain-text enforcement for the remaining stored free-text fields (listing title/description
-- are covered by 20261018000002). The browser can be bypassed, so the database is the authority.
--
-- Trigger arguments: first the maximum length, then the column names to check. A column is
-- checked only on INSERT or when its value changes, so existing rows are never re-validated by
-- unrelated updates. Values are only read, never concatenated into SQL, so this cannot be used
-- for SQL injection; the rejected pattern is script/markup injection.
create or replace function public.reject_unsafe_text()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  max_length constant int := tg_argv[0]::int;
  unsafe_text constant text := '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]';
  new_json constant jsonb := to_jsonb(new);
  old_json constant jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  col text;
  val text;
begin
  for i in 1 .. tg_nargs - 1 loop
    col := tg_argv[i];
    val := new_json ->> col;
    if val is null then
      continue;
    end if;
    if tg_op = 'UPDATE' and val is not distinct from (old_json ->> col) then
      continue;
    end if;
    if char_length(val) > max_length then
      raise exception '% must be % characters or fewer.', col, max_length using errcode = '23514';
    end if;
    if val ~* unsafe_text then
      raise exception '% can only contain plain text.', col using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.reject_unsafe_text() from public, anon, authenticated;

drop trigger if exists messages_reject_unsafe_text on public.messages;
create trigger messages_reject_unsafe_text
  before insert or update on public.messages
  for each row execute function public.reject_unsafe_text('2000', 'body');

drop trigger if exists reviews_reject_unsafe_text on public.reviews;
create trigger reviews_reject_unsafe_text
  before insert or update on public.reviews
  for each row execute function public.reject_unsafe_text('2000', 'body');

drop trigger if exists listing_pickup_locations_reject_unsafe_text on public.listing_pickup_locations;
create trigger listing_pickup_locations_reject_unsafe_text
  before insert or update on public.listing_pickup_locations
  for each row execute function public.reject_unsafe_text(
    '200', 'address', 'street_address', 'city', 'state', 'postal_code', 'country'
  );
