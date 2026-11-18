begin;

drop trigger z_listing_required_identity on public.listings;
drop function public.require_listing_identity();

update public.app_settings set value='180'::jsonb,
  description='Owner availability can extend from today through 180 days from today; return date is exclusive.'
where key='listing_duration_days';

create or replace function public.enforce_listing_scheduling_window()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_changed boolean; v_publishing boolean;
begin
  v_changed:=tg_op='INSERT';
  v_publishing:=new.status in ('published','pending_approval');
  if tg_op='UPDATE' then
    v_changed:=(new.availability_start,new.availability_end) is distinct from (old.availability_start,old.availability_end);
    v_publishing:=v_publishing and old.status not in ('published','pending_approval');
  end if;
  if not v_changed and not v_publishing then return new;end if;
  if new.availability_start is null and new.availability_end is null and not v_publishing then return new;end if;
  if new.availability_start is null or new.availability_end is null or new.availability_end<=new.availability_start then
    raise exception 'Choose a start date and an end date for your availability' using errcode='23514';
  end if;
  if new.availability_start<current_date or new.availability_end>current_date+180 then
    raise exception 'Choose dates from today through 180 days from today' using errcode='23514';
  end if;
  return new;
end;
$$;
comment on function public.enforce_listing_scheduling_window() is
 'Owner availability: today through today + 180 days, with an exclusive return date. Existing reservation, inventory and auction guards remain authoritative.';
commit;
