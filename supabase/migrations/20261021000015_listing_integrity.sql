begin;
alter table public.listing_change_history add column owner_id uuid;
update public.listing_change_history h set owner_id=coalesce(
  (h.old_value->>'owner_id')::uuid,(select owner_id from public.listings l where l.id=h.listing_id));
create function public.set_listing_history_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.owner_id:=coalesce((new.old_value->>'owner_id')::uuid,
    (select owner_id from public.listings where id=new.listing_id));
  return new;
end;
$$;
create trigger listing_history_owner before insert on public.listing_change_history
  for each row execute function public.set_listing_history_owner();
alter policy listing_history_owner on public.listing_change_history
  using (public.has_active_session() and owner_id=auth.uid());

create function public.protect_listing_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role()='authenticated' and
    ((tg_op='INSERT' and new.owner_verified) or (tg_op='UPDATE' and new.owner_verified is distinct from old.owner_verified)) then
    raise exception 'Owner verification can only be assigned by the trusted verification service' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger listing_verification_protection before insert or update on public.listings
  for each row execute function public.protect_listing_verification();
alter table public.listings add constraint listing_offer_guardrail_feasible check (
  offer_guardrail_pct is null or offer_minimum_daily is null
  or offer_minimum_daily<=round(price_per_day*(1+offer_guardrail_pct),2));
revoke all on function public.set_listing_history_owner(),public.protect_listing_verification() from public,anon,authenticated;
commit;
