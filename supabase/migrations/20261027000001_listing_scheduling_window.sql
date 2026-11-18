begin;

create function public.enforce_listing_scheduling_window()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_changed boolean; v_publishing boolean; v_days integer;
begin
  v_changed := tg_op = 'INSERT';
  v_publishing := new.status in ('published', 'pending_approval');
  if tg_op = 'UPDATE' then
    v_changed := (new.availability_start, new.availability_end)
      is distinct from (old.availability_start, old.availability_end);
    v_publishing := v_publishing and old.status not in ('published', 'pending_approval');
  end if;
  -- Leave retained historical windows alone unless dates change or a draft publishes.
  if not v_changed and not v_publishing then return new; end if;
  if new.availability_start is null and new.availability_end is null and not v_publishing then return new; end if;
  v_days := least(30, (public.get_listing_flow_policy()->>'listing_duration_days')::integer);
  if new.availability_start is null or new.availability_end is null
    or new.availability_end <= new.availability_start
    or new.availability_end - new.availability_start > v_days then
    raise exception 'Choose between 1 and % consecutive available days', v_days using errcode = '23514';
  end if;
  if new.availability_start < current_date or new.availability_end > current_date + 90 then
    raise exception 'Choose available dates within the next 90 days' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_listing_scheduling_window() from public, anon, authenticated;
create trigger b_listing_scheduling_window before insert or update on public.listings
  for each row execute function public.enforce_listing_scheduling_window();

comment on function public.enforce_listing_scheduling_window() is
  'Owner scheduling: at most 30 available calendar days within the next 90 days. End is exclusive. Existing reservation and inventory guards remain authoritative.';
commit;
