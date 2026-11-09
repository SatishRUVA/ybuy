begin;

alter table public.listing_flags drop constraint listing_flags_type_check;
alter table public.listing_flags add constraint listing_flags_type_check
  check (type in ('contact_info', 'profanity', 'prohibited_item', 'drug_related', 'other_guideline', 'content_violation'));

create or replace function public.listing_offer_preferences_valid(p public.listings)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (policy->>'offer_below_pct') is not null and (policy->>'offer_above_pct') is not null
    and p.availability_start is not null and p.availability_end is not null
    and p.offer_minimum_daily>=greatest(0.01,round(p.price_per_day*(1-(policy->>'offer_below_pct')::numeric),2))
    and p.offer_maximum_daily<=least(100000,round(p.price_per_day*(1+(policy->>'offer_above_pct')::numeric),2))
    and p.offer_maximum_daily>=p.offer_minimum_daily
    and (p.offer_target_daily is null or p.offer_target_daily between p.offer_minimum_daily and p.offer_maximum_daily)
    and p.offer_start_date>=p.availability_start and p.offer_end_date<=p.availability_end
    and p.offer_end_date>p.offer_start_date
    and p.offer_expiration_hours between 1 and 168
    and not exists(select 1 from public.listing_flags where listing_id=p.id and not resolved
      and confidence='high' and type in ('prohibited_item','drug_related','profanity','content_violation')),false)
  from (select public.get_listing_flow_policy() policy) s;
$$;

create or replace function public.admin_get_listing_publication_review(p_listing_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.admin_require('listings.moderate');
  select to_jsonb(l)-array['location_lat','location_lng'] || jsonb_build_object(
    'images',coalesce((select jsonb_agg(jsonb_build_object('url',url,'sort_order',sort_order) order by sort_order,id)
      from public.listing_images where listing_id=l.id),'[]'::jsonb),
    'blocking_flags',coalesce((select jsonb_agg(jsonb_build_object('type',type,'reason',reason))
      from public.listing_flags where listing_id=l.id and not resolved and confidence='high'
        and type in ('prohibited_item','drug_related','profanity','content_violation')),'[]'::jsonb))
    into v from public.listings l where l.id=p_listing_id and l.status='pending_approval';
  if v is null then raise exception 'Listing is not awaiting approval' using errcode='55000';end if;
  return v;
end;
$$;

create or replace function public.enforce_listing_content_moderation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status not in ('published','pending_approval')
    or (tg_op='UPDATE' and new.status is not distinct from old.status) then
    return new;
  end if;
  if exists(select 1 from public.listing_flags where listing_id=new.id and not resolved
    and confidence='high' and type in ('profanity','content_violation')) then
    raise exception 'This listing requires moderation review before publication' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger listings_content_moderation_guard
  before insert or update on public.listings
  for each row execute function public.enforce_listing_content_moderation();

commit;
