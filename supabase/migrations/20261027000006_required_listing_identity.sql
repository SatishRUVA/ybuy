begin;

create function public.require_listing_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('published','pending_approval') then
    if tg_op='INSERT' or new.status is distinct from old.status
      or (new.brand,new.model) is distinct from (old.brand,old.model) then
      if new.brand is null or new.brand ~ '^[[:space:]]*$' then
        raise exception 'Enter the item brand before publishing' using errcode='23514';
      end if;
      if new.model is null or new.model ~ '^[[:space:]]*$' then
        raise exception 'Enter the item model before publishing' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.require_listing_identity() from public,anon,authenticated;
create trigger z_listing_required_identity before insert or update on public.listings
  for each row execute function public.require_listing_identity();

commit;
