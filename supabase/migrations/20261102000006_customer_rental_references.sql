begin;

lock table public.bookings, public.rental_agreements in access exclusive mode;

create table public.customer_reference_counters (
  booking_year integer primary key check (booking_year between 1 and 9999),
  last_number bigint not null check (last_number > 0)
);
alter table public.customer_reference_counters enable row level security;
revoke all on public.customer_reference_counters from public, anon, authenticated, service_role;

create function public.format_customer_rental_reference(p_prefix text, p_year integer, p_number bigint)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_prefix is null or p_prefix not in ('YB','RA') or p_year is null or p_year not between 1 and 9999
    or p_number is null or p_number < 1 then
    raise exception 'Invalid customer rental reference parts' using errcode='22023';
  end if;
  return p_prefix || '-' || lpad((p_year % 100)::text,2,'0') || '-'
    || repeat('0',greatest(0,6-length(p_number::text))) || p_number::text;
end;
$$;
revoke all on function public.format_customer_rental_reference(text,integer,bigint) from public, anon, authenticated, service_role;

alter table public.bookings add column booking_reference text;

-- Reference backfills must preserve the booking's last operational update.
alter table public.bookings disable trigger bookings_set_updated_at;
with numbered as (
  select id,
    extract(year from created_at at time zone 'UTC')::integer as booking_year,
    row_number() over (
      partition by extract(year from created_at at time zone 'UTC')
      order by created_at,id
    )::bigint as reference_number
  from public.bookings
)
update public.bookings b
set booking_reference=public.format_customer_rental_reference('YB',n.booking_year,n.reference_number)
from numbered n
where n.id=b.id;
alter table public.bookings enable trigger bookings_set_updated_at;

with numbered as (
  select extract(year from created_at at time zone 'UTC')::integer as booking_year,
    row_number() over (
      partition by extract(year from created_at at time zone 'UTC')
      order by created_at,id
    )::bigint as reference_number
  from public.bookings
)
insert into public.customer_reference_counters(booking_year,last_number)
select booking_year,max(reference_number) from numbered group by booking_year;

alter table public.bookings
  alter column booking_reference set not null,
  add constraint bookings_booking_reference_unique unique (booking_reference),
  add constraint bookings_booking_reference_format check (booking_reference ~ '^YB-[0-9]{2}-[0-9]{6,}$');

create function public.assign_customer_booking_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_year integer; v_number bigint;
begin
  v_year:=extract(year from coalesce(new.created_at,clock_timestamp()) at time zone 'UTC')::integer;
  if v_year not between 1 and 9999 then
    raise exception 'Booking year is outside the supported range' using errcode='22023';
  end if;
  insert into public.customer_reference_counters as counter(booking_year,last_number)
  values(v_year,1)
  on conflict (booking_year) do update set last_number=counter.last_number+1
  returning last_number into v_number;
  new.booking_reference:=public.format_customer_rental_reference('YB',v_year,v_number);
  return new;
end;
$$;
create trigger booking_customer_reference_assign before insert on public.bookings
  for each row execute function public.assign_customer_booking_reference();

create function public.prevent_customer_booking_reference_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.booking_reference is distinct from old.booking_reference then
    raise exception 'Booking reference is immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger booking_customer_reference_immutable before update of booking_reference on public.bookings
  for each row execute function public.prevent_customer_booking_reference_change();

alter table public.rental_agreements add column agreement_reference text;
alter table public.rental_agreements disable trigger agreement_immutable;
update public.rental_agreements a
set agreement_reference='RA-' || substring(b.booking_reference from 4)
from public.bookings b
where b.id=a.booking_id;

update public.rental_agreements a
set snapshot=jsonb_set(
  jsonb_set(a.snapshot,'{booking_reference}',to_jsonb(b.booking_reference),true),
  '{agreement_reference}',to_jsonb(a.agreement_reference),true
)
from public.bookings b
where b.id=a.booking_id;
alter table public.rental_agreements enable trigger agreement_immutable;

alter table public.rental_agreements
  alter column agreement_reference set not null,
  add constraint rental_agreements_reference_unique unique (agreement_reference),
  add constraint rental_agreements_reference_format check (agreement_reference ~ '^RA-[0-9]{2}-[0-9]{6,}$');

create function public.assign_customer_agreement_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_booking_reference text;
begin
  select booking_reference into v_booking_reference
  from public.bookings where id=new.booking_id;
  if not found then
    raise exception 'Booking not found for rental agreement' using errcode='23503';
  end if;
  new.agreement_reference:='RA-' || substring(v_booking_reference from 4);
  new.snapshot:=jsonb_set(
    jsonb_set(coalesce(new.snapshot,'{}'::jsonb),'{booking_reference}',to_jsonb(v_booking_reference),true),
    '{agreement_reference}',to_jsonb(new.agreement_reference),true
  );
  return new;
end;
$$;
create trigger rental_agreement_customer_reference before insert on public.rental_agreements
  for each row execute function public.assign_customer_agreement_reference();

revoke all on function public.assign_customer_booking_reference(),
  public.prevent_customer_booking_reference_change(),
  public.assign_customer_agreement_reference()
  from public, anon, authenticated, service_role;

commit;
