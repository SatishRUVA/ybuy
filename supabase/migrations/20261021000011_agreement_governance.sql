begin;
create trigger agreement_no_truncate before truncate on public.rental_agreements for each statement execute function public.immutable_rental_document();
create trigger agreement_acceptance_no_truncate before truncate on public.rental_agreement_acceptances for each statement execute function public.immutable_rental_document();
create trigger agreement_template_no_truncate before truncate on public.rental_agreement_templates for each statement execute function public.immutable_rental_document();

create function public.admin_get_agreement_terms()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require('config.manage');
  return (select to_jsonb(t) from public.rental_agreement_templates t order by version desc limit 1);
end;
$$;
revoke all on function public.admin_get_agreement_terms() from public,anon;
grant execute on function public.admin_get_agreement_terms() to authenticated;

create function public.protect_booked_availability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.listings where id=new.listing_id for update;
  if not new.is_available and exists(select 1 from public.bookings where listing_id=new.listing_id
    and status in ('pending_payment','confirmed','active','return_pending') and start_date<=new.date and end_date>new.date
    and (status<>'pending_payment' or checkout_expires_at is null or checkout_expires_at>clock_timestamp())) then
    raise exception 'Approved rental dates cannot be blocked' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger listing_availability_protect_bookings before insert or update on public.listing_availability
  for each row execute function public.protect_booked_availability();
revoke all on function public.protect_booked_availability() from public,anon,authenticated;
commit;
