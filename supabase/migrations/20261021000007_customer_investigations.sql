begin;
create or replace function public.admin_grantable_permissions()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'analytics.view','users.manage','listings.moderate','bookings.view','payments.view',
    'payouts.view','reviews.moderate','categories.manage','audit.view','integrations.view',
    'disputes.manage','support.manage','promotions.manage','credits.manage',
    'refunds.issue','refunds.approve','refunds.senior','fraud.investigate'
  ];
$$;

create index if not exists admin_investigation_rate_idx on public.admin_audit_log(actor_id,created_at)
  where action='customer.investigate';

create or replace function public.admin_investigate_customers(
  p_customer_ids text[], p_from timestamptz, p_to timestamptz, p_reason text,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_result jsonb;
begin
  perform public.admin_require('fraud.investigate');
  v_reason := public.admin_clean_reason(p_reason);
  if p_customer_ids is null or cardinality(p_customer_ids) not between 1 and 100
    or exists (select 1 from unnest(p_customer_ids) value where length(coalesce(value,'')) > 64)
    or p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days'
    or p_limit is null or p_limit not between 1 and 25 or p_offset is null or p_offset not between 0 and 99 then
    raise exception 'Use 1-100 identifiers, a valid date range of at most 366 days and bounded pagination' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-investigation:' || auth.uid()::text,0));
  if (select count(*) from public.admin_audit_log where actor_id=auth.uid()
    and action='customer.investigate' and created_at > clock_timestamp()-interval '1 minute') >= 10 then
    raise exception 'Investigation rate limit reached; retry after one minute' using errcode = 'P0001';
  end if;

  with requested as (
    select upper(btrim(coalesce(value,''))) as customer_id,min(ordinality) as position
      from unnest(p_customer_ids) with ordinality input(value,ordinality) group by upper(btrim(coalesce(value,'')))
  ), page as (
    select r.customer_id,r.position,p.id,
      case when r.customer_id !~ '^YB-[0-9]{10}$' then 'invalid'
        when p.id is null then 'unknown' else 'found' end as result_status
    from requested r left join public.profiles p on p.customer_id=r.customer_id
    order by r.position limit p_limit offset p_offset
  ), activity as (
    select p.customer_id,'booking'::text as kind,b.id as record_id,b.created_at,b.status,
      jsonb_build_object('booking_id',b.id,'role',case when b.renter_id=p.id then 'Renter' else 'Owner' end) detail
    from page p join public.bookings b on p.id in (b.renter_id,b.owner_id)
    where b.created_at >= p_from and b.created_at < p_to
    union all
    select p.customer_id,'payment',pay.id,pay.created_at,pay.status,
      jsonb_build_object('booking_id',b.id,'amount',pay.amount,'currency',pay.currency,
        'role',case when b.renter_id=p.id then 'Renter' else 'Owner' end)
    from page p join public.bookings b on p.id in (b.renter_id,b.owner_id)
      join public.payments pay on pay.booking_id=b.id
    where pay.created_at >= p_from and pay.created_at < p_to
    union all
    select p.customer_id,'dispute',c.id,c.created_at,c.status,
      jsonb_build_object('booking_id',c.booking_id,'category',c.category)
    from page p join public.operations_cases c on p.id in (c.created_by,c.participant_id)
    where c.kind='dispute' and c.created_at >= p_from and c.created_at < p_to
    union all
    select p.customer_id,'refund_request',r.id,r.created_at,r.status,
      jsonb_build_object('booking_id',r.booking_id,'amount',r.amount,'currency',r.currency,'provider_status',r.provider_status)
    from page p join public.bookings b on p.id in (b.renter_id,b.owner_id)
      join public.refund_requests r on r.booking_id=b.id
    where r.created_at >= p_from and r.created_at < p_to
    union all
    select p.customer_id,'deposit_refund',s.booking_id,s.created_at,s.refund_status,
      jsonb_build_object('booking_id',s.booking_id,'amount',s.deposit_amount,'currency',pay.currency)
    from page p join public.bookings b on p.id in (b.renter_id,b.owner_id)
      join public.rental_settlements s on s.booking_id=b.id
      join public.payments pay on pay.id=s.payment_id
    where s.created_at >= p_from and s.created_at < p_to
  ), results as (
    select p.customer_id,p.position,p.result_status,
      (select count(*) from activity a where a.customer_id=p.customer_id) as event_count,
      (select count(*) from activity a where a.customer_id=p.customer_id and a.kind='payment' and a.status='failed') as failed_payments,
      (select count(*) from activity a where a.customer_id=p.customer_id and a.kind='booking' and a.status='cancelled') as cancellations,
      (select count(*) from activity a where a.customer_id=p.customer_id and a.kind='dispute' and a.status<>'closed') as unresolved_disputes,
      coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.record_id) from (
        select kind,record_id,created_at,status,detail from activity a where a.customer_id=p.customer_id
        order by created_at desc,record_id limit 20
      ) e),'[]'::jsonb) as events
    from page p
  )
  select jsonb_build_object('total',(select count(*) from requested),
    'duplicate_count',cardinality(p_customer_ids)-(select count(*) from requested),
    'rows',coalesce((select jsonb_agg(to_jsonb(r)-'position' order by r.position) from results r),'[]'::jsonb),
    'limitations',jsonb_build_array(
      'Current record states for events created within the selected period, not historical status transitions.',
      'Only persisted payment records are available; unrecorded attempts and chargebacks are not inferred.',
      'Historical transaction locations and shared payment/device identifiers are not collected.',
      'Indicators are counts for human review, not fraud verdicts or automatic restrictions.',
      'At most 20 newest events per customer are included; event_count reports the total.'
    )) into v_result;
  perform public.admin_write_audit('customer.investigate','customer_batch',null,null,
    jsonb_build_object('customer_ids',(select jsonb_agg(distinct upper(btrim(coalesce(value,'')))) from unnest(p_customer_ids) value),
      'count',cardinality(p_customer_ids),'from',p_from,'to',p_to,'limit',p_limit,'offset',p_offset),v_reason);
  return v_result;
end;
$$;
revoke all on function public.admin_investigate_customers(text[],timestamptz,timestamptz,text,integer,integer) from public,anon;
grant execute on function public.admin_investigate_customers(text[],timestamptz,timestamptz,text,integer,integer) to authenticated;
commit;
