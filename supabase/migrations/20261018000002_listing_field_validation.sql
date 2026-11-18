-- Server-side listing field rules. They mirror src/lib/listing-rules.ts, which only mirrors these
-- as defaults: the browser can be bypassed, so the database is the authority.
--
-- A trigger (not CHECK constraints) is used so existing rows are never re-validated by unrelated
-- updates such as archiving: a field is checked only on INSERT or when that column changes.
-- Changing a limit later is a new migration that replaces this function.
create or replace function public.validate_listing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- Plain text only: no tags, script URLs or control characters. Rejected, never silently cleaned.
  unsafe_text constant text := '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]';
begin
  if tg_op = 'INSERT' or new.title is distinct from old.title then
    if char_length(new.title) > 100 then
      raise exception 'Title must be 100 characters or fewer.' using errcode = '23514';
    end if;
    if new.title ~* unsafe_text then
      raise exception 'Title can only contain plain text.' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' or new.description is distinct from old.description then
    if char_length(coalesce(new.description, '')) > 2000 then
      raise exception 'Description must be 2000 characters or fewer.' using errcode = '23514';
    end if;
    if coalesce(new.description, '') ~* unsafe_text then
      raise exception 'Description can only contain plain text.' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' or new.price_per_day is distinct from old.price_per_day then
    if new.price_per_day < 1 or new.price_per_day > 5000 then
      raise exception 'Price per day must be between 1 and 5000.' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' or new.deposit is distinct from old.deposit then
    if new.deposit < 0 or new.deposit > 10000 then
      raise exception 'Security deposit must be between 0 and 10000.' using errcode = '23514';
    end if;
  end if;

  -- Drafts start with an empty title (photo upload creates the row first); published listings need one.
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published' or new.title is distinct from old.title) then
    if char_length(btrim(new.title)) < 3 then
      raise exception 'A published listing needs a title of at least 3 characters.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_listing_fields() from public, anon, authenticated;

drop trigger if exists listings_validate_fields on public.listings;
create trigger listings_validate_fields
  before insert or update on public.listings
  for each row execute function public.validate_listing_fields();
