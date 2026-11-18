begin;

alter table public.bookings drop constraint bookings_sandbox_tax_snapshot;
alter table public.bookings add constraint bookings_tax_snapshot check (
  (not sandbox_tax and tax_rate = 0 and tax_amount = 0)
  or (tax_rate = 0.07
    and tax_amount = round((subtotal + service_fee_amount) * tax_rate, 2))
);

create or replace function public.apply_sandbox_booking_tax()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.sandbox_tax := false;
    new.tax_rate := 0.07;
    new.tax_amount := round((new.subtotal + new.service_fee_amount) * new.tax_rate, 2);
  elsif new.tax_amount is distinct from old.tax_amount
    or new.tax_rate is distinct from old.tax_rate
    or new.sandbox_tax is distinct from old.sandbox_tax then
    raise exception 'Booking tax snapshot is immutable' using errcode = '42501';
  end if;
  -- Insurance recomputes the tax-exclusive total on every update.
  new.total := new.total + new.tax_amount;
  return new;
end;
$$;

comment on table public.sandbox_booking_tax_gate is
  'Deprecated: new bookings always charge 7% tax. Historical sandbox snapshots remain immutable.';

commit;
