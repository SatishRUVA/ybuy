create function public.admin_get_booking_360(
  p_booking_id uuid, p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_booking jsonb;
begin
  perform public.admin_require('bookings.view');

  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'start_date', b.start_date, 'end_date', b.end_date,
    'quantity', b.quantity, 'daily_rate', b.daily_rate, 'days', b.days, 'subtotal', b.subtotal,
    'service_fee_amount', b.service_fee_amount, 'deposit', b.deposit, 'total', b.total,
    'deposit_collection_model', b.deposit_collection_model, 'created_at', b.created_at, 'updated_at', b.updated_at,
    'listing', jsonb_build_object('id', l.id, 'title', l.title, 'status', l.status),
    'renter', jsonb_build_object('id', r.id, 'customer_id', r.customer_id, 'full_name', r.full_name, 'email', r.email),
    'owner', jsonb_build_object('id', o.id, 'customer_id', o.customer_id, 'full_name', o.full_name, 'email', o.email),
    'handoff', (
      select jsonb_build_object(
        'status', h.status, 'pickup_arrived_at', h.pickup_arrived_at, 'actual_pickup_at', h.actual_pickup_at,
        'return_initiated_at', h.return_initiated_at, 'actual_return_at', h.actual_return_at,
        'support_exception_pickup_at', h.support_exception_pickup_at,
        'support_exception_return_at', h.support_exception_return_at
      ) from public.booking_handoffs h where h.booking_id = b.id
    ),
    'inspections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', i.kind, 'appearance_condition', i.appearance_condition, 'existing_damage', i.existing_damage,
        'included_accessories', i.included_accessories, 'functional_condition', i.functional_condition,
        'serial_number', i.serial_number, 'submitted_by', i.submitted_by, 'submitted_at', i.submitted_at,
        'owner_acknowledged_at', i.owner_acknowledged_at, 'renter_acknowledged_at', i.renter_acknowledged_at
      ) order by i.submitted_at, i.kind)
      from public.booking_inspections i where i.booking_id = b.id
    ), '[]'::jsonb)
  ) into v_booking
  from public.bookings b
  join public.listings l on l.id = b.listing_id
  join public.profiles r on r.id = b.renter_id
  join public.profiles o on o.id = b.owner_id
  where b.id = p_booking_id;

  if v_booking is null then raise exception 'Booking not found' using errcode = 'P0002'; end if;

  return jsonb_build_object('booking', v_booking) || jsonb_build_object(
    'payments', case when public.has_admin_permission('payments.view') then (
      select jsonb_build_object('total', (select count(*) from public.payments p where p.booking_id = p_booking_id),
        'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id)
          from (select id, amount, currency, status, stripe_payment_intent_id, created_at
            from public.payments where booking_id = p_booking_id
            order by created_at desc, id limit v_limit offset v_offset) page), '[]'::jsonb))
    ) else null end,
    'refund_requests', case when public.operations_can_view_refunds() then (
      select jsonb_build_object('total', (select count(*) from public.refund_requests r where r.booking_id = p_booking_id),
        'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id)
          from (select id, payment_id, amount, currency, status, reason, requested_by, approved_by,
              approval_reason, execution_enabled, created_at, approved_at
            from public.refund_requests where booking_id = p_booking_id
            order by created_at desc, id limit v_limit offset v_offset) page), '[]'::jsonb))
    ) else null end,
    'deposit_authorizations', case when public.has_admin_permission('payments.view') then (
      select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id), '[]'::jsonb)
      from (
        select a.id, a.attempt, a.authorized_amount, a.captured_amount, a.status, a.authorization_at,
          a.capture_before, a.released_at, a.captured_at, a.failure_reason, a.is_claim_authorization,
          a.created_at, a.updated_at,
          (select coalesce(jsonb_agg(jsonb_build_object(
            'event_type', e.event_type, 'status', e.status, 'amount', e.amount, 'created_at', e.created_at
          ) order by e.created_at, e.id), '[]'::jsonb)
            from public.booking_deposit_authorization_events e where e.authorization_id = a.id) as events
        from public.booking_deposit_authorizations a
        where a.booking_id = p_booking_id order by a.created_at desc, a.id limit v_limit offset v_offset
      ) page
    ) else null end,
    'settlement', case when public.has_admin_permission('payouts.view') then (
      select jsonb_build_object(
        'deposit_amount', s.deposit_amount, 'owner_amount', s.owner_amount,
        'refund_status', s.refund_status, 'transfer_status', s.transfer_status,
        'created_at', s.created_at, 'updated_at', s.updated_at
      ) from public.rental_settlements s where s.booking_id = p_booking_id
    ) else null end,
    'legacy_payouts', case when public.has_admin_permission('payouts.view') then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'amount', p.amount, 'status', p.status, 'paid_at', p.paid_at,
        'notes', p.notes, 'created_at', p.created_at
      ) order by p.created_at desc, p.id), '[]'::jsonb)
      from public.payouts p where p.booking_id = p_booking_id
    ) else null end,
    'cases', case when public.has_admin_permission('disputes.manage')
      or public.has_admin_permission('support.manage') then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'subject', c.subject, 'category', c.category, 'status', c.status,
        'priority', c.priority, 'assigned_to', c.assigned_to, 'created_at', c.created_at, 'updated_at', c.updated_at
      ) order by c.updated_at desc, c.id), '[]'::jsonb)
      from public.operations_cases c where c.booking_id = p_booking_id and
        ((c.kind = 'dispute' and public.has_admin_permission('disputes.manage'))
          or (c.kind = 'support' and public.has_admin_permission('support.manage')))
    ) else null end,
    'reviews', case when public.has_admin_permission('reviews.moderate') then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', rv.id, 'rating', rv.rating, 'body', rv.body, 'reviewer_id', rv.reviewer_id,
        'reviewee_id', rv.reviewee_id, 'created_at', rv.created_at
      ) order by rv.created_at desc, rv.id), '[]'::jsonb)
      from public.reviews rv where rv.booking_id = p_booking_id
    ) else null end,
    'promotion_redemption', case when public.has_admin_permission('promotions.manage') then (
      select jsonb_build_object('promotion_id', pr.promotion_id, 'code', p.code,
        'discount_amount', pr.discount_amount, 'created_at', pr.created_at)
      from public.promotion_redemptions pr join public.promotions p on p.id = pr.promotion_id
      where pr.booking_id = p_booking_id
    ) else null end,
    'credit_reservation', case when public.has_admin_permission('credits.manage') then (
      select jsonb_build_object('amount', cr.amount, 'status', cr.status, 'created_at', cr.created_at, 'released_at', cr.released_at)
      from public.credit_reservations cr where cr.booking_id = p_booking_id
    ) else null end,
    'timeline', (
      select coalesce(jsonb_agg(page.event order by page.created_at desc, page.source, page.id), '[]'::jsonb)
      from (
        select e.event, e.created_at, e.source, e.id
        from (
          select b.created_at, 'booking'::text source, b.id::text id,
            jsonb_build_object('type', 'booking_created', 'created_at', b.created_at) event
          from public.bookings b where b.id = p_booking_id
          union all
          select h.created_at, 'handoff', h.id::text,
            jsonb_build_object('type', h.event_type, 'actor_id', h.actor_id, 'created_at', h.created_at)
          from public.booking_handoff_events h where h.booking_id = p_booking_id
          union all
          select e.created_at, 'inspection', e.id::text,
            jsonb_build_object('type', 'inspection_' || e.event_type, 'actor_id', e.actor_id, 'created_at', e.created_at)
          from public.booking_inspection_audit e
          join public.booking_inspections i on i.id = e.inspection_id
          where i.booking_id = p_booking_id
          union all
          select e.created_at, 'deposit', e.id::text,
            jsonb_build_object('type', 'deposit_' || e.event_type, 'status', e.status, 'created_at', e.created_at)
          from public.booking_deposit_authorization_events e
          join public.booking_deposit_authorizations a on a.id = e.authorization_id
          where a.booking_id = p_booking_id and public.has_admin_permission('payments.view')
          union all
          select e.created_at, 'case', e.id::text,
            jsonb_build_object('type', c.kind || '_' || e.event_type, 'actor_id', e.actor_id, 'created_at', e.created_at)
          from public.operations_case_events e
          join public.operations_cases c on c.id = e.case_id
          where c.booking_id = p_booking_id and
            ((c.kind = 'dispute' and public.has_admin_permission('disputes.manage'))
              or (c.kind = 'support' and public.has_admin_permission('support.manage')))
        ) e
        order by e.created_at desc, e.source, e.id limit v_limit offset v_offset
      ) page
    )
  );
end;
$$;

create function public.admin_get_customer_360(
  p_user_id uuid, p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_customer jsonb;
begin
  perform public.admin_require('users.manage');

  select jsonb_build_object(
    'id', p.id, 'customer_id', p.customer_id, 'full_name', p.full_name, 'email', p.email,
    'phone', p.phone, 'created_at', p.created_at,
    'restriction', case when r.user_id is null then null
      else jsonb_build_object('reason', r.reason, 'restricted_at', r.restricted_at) end
  ) into v_customer
  from public.profiles p left join public.user_restrictions r on r.user_id = p.id
  where p.id = p_user_id;

  if v_customer is null then raise exception 'User not found' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'customer', v_customer,
    'bookings', case when public.has_admin_permission('bookings.view') then (
      select jsonb_build_object('total', (select count(*) from public.bookings b where p_user_id in (b.renter_id, b.owner_id)),
        'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id)
          from (
            select b.id, b.status, b.start_date, b.end_date, b.total, b.created_at,
              case when b.renter_id = p_user_id then 'renter' else 'owner' end as role,
              l.id as listing_id, l.title as listing_title
            from public.bookings b join public.listings l on l.id = b.listing_id
            where p_user_id in (b.renter_id, b.owner_id)
            order by b.created_at desc, b.id limit v_limit offset v_offset
          ) page), '[]'::jsonb))
    ) else null end,
    'cases', case when public.has_admin_permission('disputes.manage')
      or public.has_admin_permission('support.manage') then (
      select jsonb_build_object('total', (select count(*) from public.operations_cases c
          where p_user_id in (c.participant_id, c.created_by)
            and ((c.kind = 'dispute' and public.has_admin_permission('disputes.manage'))
              or (c.kind = 'support' and public.has_admin_permission('support.manage')))),
        'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.updated_at desc, page.id)
          from (
            select c.id, c.kind, c.subject, c.status, c.priority, c.booking_id, c.assigned_to, c.created_at, c.updated_at
            from public.operations_cases c
            where p_user_id in (c.participant_id, c.created_by)
              and ((c.kind = 'dispute' and public.has_admin_permission('disputes.manage'))
                or (c.kind = 'support' and public.has_admin_permission('support.manage')))
            order by c.updated_at desc, c.id limit v_limit offset v_offset
          ) page), '[]'::jsonb))
    ) else null end,
    'reviews', case when public.has_admin_permission('reviews.moderate') then (
      select jsonb_build_object('total', (select count(*) from public.reviews rv where p_user_id in (rv.reviewer_id, rv.reviewee_id)),
        'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id)
          from (
            select rv.id, rv.booking_id, rv.reviewer_id, rv.reviewee_id, rv.rating, rv.body, rv.created_at
            from public.reviews rv where p_user_id in (rv.reviewer_id, rv.reviewee_id)
            order by rv.created_at desc, rv.id limit v_limit offset v_offset
          ) page), '[]'::jsonb))
    ) else null end,
    'credits', case when public.has_admin_permission('credits.manage')
      then public.admin_credit_history(p_user_id, v_limit, v_offset) else null end,
    'promotion_redemptions', case when public.has_admin_permission('promotions.manage') then (
      select jsonb_build_object('total', (select count(*) from public.promotion_redemptions pr where pr.user_id = p_user_id),
        'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'booking_id', page.booking_id, 'promotion_code', page.code,
          'discount_amount', page.discount_amount, 'created_at', page.created_at
        ) order by page.created_at desc, page.booking_id)
          from (
            select pr.booking_id, p.code, pr.discount_amount, pr.created_at
            from public.promotion_redemptions pr join public.promotions p on p.id = pr.promotion_id
            where pr.user_id = p_user_id
            order by pr.created_at desc, pr.booking_id limit v_limit offset v_offset
          ) page), '[]'::jsonb))
    ) else null end
  );
end;
$$;

revoke all on function public.admin_get_booking_360(uuid, integer, integer) from public, anon;
revoke all on function public.admin_get_customer_360(uuid, integer, integer) from public, anon;
grant execute on function public.admin_get_booking_360(uuid, integer, integer) to authenticated;
grant execute on function public.admin_get_customer_360(uuid, integer, integer) to authenticated;
