alter table public.rental_settlements add column refund_confirmed_at timestamptz;
alter table public.rental_settlements add column transfer_confirmed_at timestamptz;
create function public.set_settlement_receipt_times()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.refund_status='succeeded' and new.refund_confirmed_at is null then new.refund_confirmed_at=now(); end if;
  if new.transfer_status='succeeded' and new.transfer_confirmed_at is null then new.transfer_confirmed_at=now(); end if;
  return new;
end;
$$;
create trigger rental_settlement_receipt_times before update on public.rental_settlements
  for each row execute function public.set_settlement_receipt_times();

create or replace function public.admin_list_payouts(p_status text default null,p_limit int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.admin_require('payouts.view');
  with records as (
    select s.booking_id id,s.booking_id,s.owner_amount amount,s.transfer_status status,
      s.transfer_confirmed_at paid_at,s.last_error notes,s.created_at,
      o.full_name owner_name,o.email owner_email,'stripe_connect' source,s.transfer_id provider_ref,
      s.deposit_amount,s.refund_status
    from public.rental_settlements s join public.bookings b on b.id=s.booking_id
      join public.profiles o on o.id=b.owner_id
    union all
    select p.id,p.booking_id,p.amount,p.status,p.paid_at,p.notes,p.created_at,
      o.full_name,o.email,'legacy_manual',null,null,null
    from public.payouts p join public.profiles o on o.id=p.owner_id
  ), base as (select * from records where p_status is null or p_status='' or status=p_status),
  page as (select * from base order by created_at desc,id limit least(greatest(coalesce(p_limit,25),1),100)
    offset greatest(coalesce(p_offset,0),0))
  select jsonb_build_object('total',(select count(*) from base),
    'rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id) from page),'[]'::jsonb)) into v;
  return v;
end;
$$;

create or replace function public.admin_overview(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.admin_require('analytics.view');
  if p_from is null or p_to is null or p_to<=p_from then raise exception 'Invalid date range' using errcode='22023'; end if;
  select jsonb_build_object(
    'period',jsonb_build_object('from',p_from,'to',p_to),
    'users_total',(select count(*) from public.profiles),
    'users_new',(select count(*) from public.profiles where created_at>=p_from and created_at<p_to),
    'listings_published',(select count(*) from public.listings where status='published'),
    'listings_suspended',(select count(*) from public.listings where status='suspended'),
    'bookings_by_status',coalesce((select jsonb_object_agg(status,n) from (
      select status,count(*) n from public.bookings where created_at>=p_from and created_at<p_to group by status) s),'{}'::jsonb),
    'gross_rental',coalesce((select sum(subtotal) from public.bookings
      where status in ('confirmed','active','return_pending','completed') and created_at>=p_from and created_at<p_to),0),
    'platform_fees',coalesce((select sum(service_fee_amount) from public.bookings
      where status in ('confirmed','active','return_pending','completed') and created_at>=p_from and created_at<p_to),0),
    'refunds',coalesce((select sum(amount) from public.payments where status='refunded' and created_at>=p_from and created_at<p_to),0)
      +coalesce((select sum(s.deposit_amount) from public.rental_settlements s join public.payments p on p.id=s.payment_id
        where s.refund_status='succeeded' and p.status<>'refunded' and s.refund_confirmed_at>=p_from and s.refund_confirmed_at<p_to),0),
    'deposit_liability',coalesce((select sum(b.deposit) from public.bookings b
      where exists(select 1 from public.payments p where p.booking_id=b.id and p.status='succeeded')
        and not exists(select 1 from public.rental_settlements s where s.booking_id=b.id and s.refund_status='succeeded')),0),
    'payables_outstanding',coalesce((select sum(b.subtotal) from public.bookings b where b.status='completed'
      and not exists(select 1 from public.payouts p where p.booking_id=b.id and p.status='paid')
      and not exists(select 1 from public.rental_settlements s where s.booking_id=b.id and s.transfer_status='succeeded')),0),
    'recent_actions',coalesce((select jsonb_agg(to_jsonb(a)) from (
      select id,actor_email,action,entity_type,entity_id,outcome,created_at from public.admin_audit_log
      order by created_at desc limit 8) a),'[]'::jsonb)
  ) into v;
  return v;
end;
$$;
