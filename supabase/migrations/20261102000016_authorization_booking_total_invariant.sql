begin;

create function public.enforce_booking_total_by_deposit_model()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deposit_collection_model='authorization' then
    new.total:=new.subtotal+new.service_fee_amount+new.insurance_amount
      +coalesce(new.delivery_fee_amount,0)+new.tax_amount;
  else
    new.total:=new.subtotal+new.service_fee_amount+new.deposit+new.insurance_amount
      +coalesce(new.delivery_fee_amount,0)+new.tax_amount;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_booking_total_by_deposit_model() from public,anon,authenticated;
create trigger zzzzzzz_bookings_total_by_deposit_model
  before insert or update on public.bookings
  for each row execute function public.enforce_booking_total_by_deposit_model();

commit;
