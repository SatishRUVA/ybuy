create or replace function public.capture_booking_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text:=new.status;v_title text;v_body text;v_recipient uuid;
begin
  if tg_op='UPDATE' and old.status is not distinct from new.status then return new; end if;
  if v_status='requested' then
    perform public.create_notification(new.owner_id,'booking:'||new.id::text||':requested:'||new.owner_id::text,
      'bookings','New booking request','A renter has requested to book your item.','/dashboard');
    return new;
  elsif v_status='pending_payment' then
    perform public.create_notification(new.renter_id,'booking:'||new.id::text||':pending_payment:'||new.renter_id::text,
      'bookings',case when new.booking_mode='instant' then 'Instant booking - payment needed' else 'Complete your booking payment' end,
      case when new.booking_mode='instant' then 'Your instant booking is reserved. Complete payment to confirm the rental.'
        else 'Your booking request was accepted. Complete payment to confirm the rental.' end,'/dashboard');
    if new.booking_mode='instant' then
      perform public.create_notification(new.owner_id,'booking:'||new.id::text||':instant:'||new.owner_id::text,
        'bookings','Instant booking received','A renter booked your item instantly. Payment is still pending.','/dashboard');
    end if;
    return new;
  elsif v_status='confirmed' then
    v_title:='Booking confirmed';v_body:='Payment is confirmed and your rental is booked.';
  elsif v_status='active' then
    v_title:='Rental started';v_body:='The rental is now active.';
  elsif v_status='return_pending' then
    v_title:='Return ready for review';v_body:='The rental return is waiting for the next step.';
  elsif v_status='completed' then
    v_title:='Rental completed';v_body:='Your rental is complete. You can leave a review.';
  elsif v_status='cancelled' then
    v_title:='Booking cancelled';v_body:='The booking was cancelled.';
  elsif v_status='rejected' then
    v_title:='Booking declined';v_body:='The booking request was declined.';
  else return new;
  end if;
  foreach v_recipient in array array[new.renter_id,new.owner_id] loop
    perform public.create_notification(v_recipient,'booking:'||new.id::text||':'||v_status||':'||v_recipient::text,
      'bookings',v_title,v_body,
      case when v_recipient = new.owner_id then '/check-in/'||new.id::text else '/dashboard' end);
  end loop;
  return new;
end;
$$;
revoke all on function public.capture_booking_notification() from public,anon,authenticated;
