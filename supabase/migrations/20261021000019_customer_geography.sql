begin;
alter table public.profiles add column country_code text references public.reference_countries(code),
  add column state_region_code text,
  add constraint profile_country_region_valid foreign key(country_code,state_region_code) references public.reference_regions(country_code,code),
  add constraint profile_region_requires_country check(state_region_code is null or country_code is not null);
revoke select(country_code,state_region_code) on public.profiles from public,anon,authenticated;

alter table public.bookings add column currency text not null default 'USD' check(currency='USD'),
  add column owner_country_code text,add column owner_state_region_code text,
  add column renter_country_code text,add column renter_state_region_code text;
create function public.snapshot_booking_geography()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    select country_code,state_region_code into new.owner_country_code,new.owner_state_region_code from public.profiles where id=new.owner_id;
    select country_code,state_region_code into new.renter_country_code,new.renter_state_region_code from public.profiles where id=new.renter_id;
  elsif (new.owner_country_code,new.owner_state_region_code,new.renter_country_code,new.renter_state_region_code,new.currency)
    is distinct from (old.owner_country_code,old.owner_state_region_code,old.renter_country_code,old.renter_state_region_code,old.currency) then
    raise exception 'Transaction geography and currency are immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger booking_geography_snapshot before insert or update on public.bookings for each row execute function public.snapshot_booking_geography();
create function public.snapshot_agreement_geography()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.snapshot:=new.snapshot||(select jsonb_build_object('currency',b.currency,
    'owner_country_code',b.owner_country_code,'owner_state_region_code',b.owner_state_region_code,
    'renter_country_code',b.renter_country_code,'renter_state_region_code',b.renter_state_region_code)
    from public.bookings b where b.id=new.booking_id);
  return new;
end;
$$;
create trigger agreement_geography_snapshot before insert on public.rental_agreements for each row execute function public.snapshot_agreement_geography();
revoke all on function public.snapshot_booking_geography(),public.snapshot_agreement_geography() from public,anon,authenticated;
commit;
