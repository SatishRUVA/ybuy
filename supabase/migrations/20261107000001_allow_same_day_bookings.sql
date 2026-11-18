begin;

insert into public.feature_flags (key, enabled, description)
values (
  'ALLOW_SAME_DAY_BOOKINGS',
  true,
  'Allow renters to start a booking on the pickup location''s local current date. Existing bookings remain valid if this is disabled.'
)
on conflict (key) do nothing;

create or replace function public.listing_has_capacity(
  p_listing_id uuid,
  p_start date,
  p_end date,
  p_quantity integer default 1,
  p_exclude_booking uuid default null
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_start is not null and p_end>p_start and p_end-p_start<=366
    and p_quantity between 1 and l.available_quantity
    and (l.availability_start is null or p_start>=l.availability_start)
    and (l.availability_end is null or p_end<=l.availability_end)
    and (
      p_start>=public.listing_local_today(l.id)
        + case when exists (
          select 1 from public.feature_flags
          where key='ALLOW_SAME_DAY_BOOKINGS' and enabled
        ) then 0 else 1 end
      or (
        p_exclude_booking is not null
        and exists (
          select 1 from public.bookings b
          where b.id=p_exclude_booking and b.listing_id=l.id and b.start_date=p_start
        )
      )
    )
    and not exists(
      select 1 from public.listing_availability a
      where a.listing_id=l.id and not a.is_available and a.date>=p_start and a.date<p_end
    )
    and not exists(
      select 1 from generate_series(p_start::timestamp,(p_end-1)::timestamp,interval '1 day') day
      where (
        select coalesce(sum(b.quantity),0) from public.bookings b
        where b.listing_id=l.id
          and (p_exclude_booking is null or b.id<>p_exclude_booking)
          and b.status in ('requested','pending_payment','confirmed','active','return_pending')
          and (b.status<>'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at>now())
          and b.start_date<=day::date and b.end_date>day::date
      )+p_quantity>l.available_quantity
    )
  from public.listings l where l.id=p_listing_id;
$$;

notify pgrst,'reload schema';
commit;
