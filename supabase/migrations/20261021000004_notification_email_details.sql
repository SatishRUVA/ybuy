alter table public.notification_email_jobs add column rendered_email jsonb;
alter table public.notification_email_jobs add column rendered_at timestamptz;

create function public.notification_email_details(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_job public.notification_email_jobs; v_booking public.bookings; v_id uuid;
  v_details jsonb; v_title text; v_owner text; v_renter text; v_settlement public.rental_settlements;
begin
  select * into v_job from public.notification_email_jobs where id=p_job_id;
  if not found then raise exception 'Email job not found'; end if;
  v_details:=jsonb_build_array(
    jsonb_build_object('label','Notification reference','value',v_job.id::text),
    jsonb_build_object('label','Event','value',v_job.subject),
    jsonb_build_object('label','Created (UTC)','value',to_char(v_job.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')));
  if split_part(v_job.event_key,':',1) in ('booking','deposit','transfer','payment','review','message') then
    v_id:=split_part(v_job.event_key,':',2)::uuid;
    case split_part(v_job.event_key,':',1)
      when 'payment' then select booking_id into v_id from public.payments where id=v_id;
      when 'review' then select booking_id into v_id from public.reviews where id=v_id;
      when 'message' then
        select c.booking_id into v_id from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=v_id;
      else null;
    end case;
    select * into v_booking from public.bookings
      where id=v_id and v_job.user_id in (owner_id,renter_id);
    if found then
      select title into v_title from public.listings where id=v_booking.listing_id;
      select full_name into v_owner from public.profiles where id=v_booking.owner_id;
      select full_name into v_renter from public.profiles where id=v_booking.renter_id;
      v_details:=v_details||jsonb_build_array(
        jsonb_build_object('label','Booking reference','value',v_booking.id::text),
        jsonb_build_object('label','Item','value',coalesce(v_title,'Rental')),
        jsonb_build_object('label','Your role','value',case when v_job.user_id=v_booking.owner_id then 'Owner' else 'Renter' end),
        jsonb_build_object('label','Owner','value',v_owner),
        jsonb_build_object('label','Renter','value',v_renter),
        jsonb_build_object('label','Rental dates','value',v_booking.start_date::text||' to '||v_booking.end_date::text),
        jsonb_build_object('label','Quantity / days','value',v_booking.quantity::text||' / '||v_booking.days::text),
        jsonb_build_object('label','Current booking status','value',v_booking.status),
        jsonb_build_object('label','Rental subtotal','value','USD '||v_booking.subtotal::text),
        jsonb_build_object('label','Platform service fee','value','USD '||v_booking.service_fee_amount::text),
        jsonb_build_object('label','Charged security deposit','value','USD '||v_booking.deposit::text),
        jsonb_build_object('label','Checkout total','value','USD '||v_booking.total::text));
      select * into v_settlement from public.rental_settlements where booking_id=v_booking.id;
      if found then
        v_details:=v_details||jsonb_build_array(jsonb_build_object('label','Deposit refund','value',v_settlement.refund_status));
        if v_job.user_id=v_booking.owner_id then
          v_details:=v_details||jsonb_build_array(
            jsonb_build_object('label','Owner earnings transfer','value','USD '||v_settlement.owner_amount::text||' - '||v_settlement.transfer_status),
            jsonb_build_object('label','Bank payout','value','Managed by Stripe; transfer is not bank payout confirmation'));
        end if;
      end if;
    end if;
  end if;
  return v_details;
end;
$$;
revoke all on function public.notification_email_details(uuid) from public,anon,authenticated;
grant execute on function public.notification_email_details(uuid) to service_role;
