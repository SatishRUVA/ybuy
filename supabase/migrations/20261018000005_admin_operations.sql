-- Operational cases are live records. Financial primitives are isolated simulations:
-- they NEVER alter bookings, payments, Stripe, owner receivables or checkout totals.
-- A trusted LOCAL operator may enable tests with:
-- update public.admin_financial_test_gate set environment = 'local_test', enabled = true;
-- No client/service-role grant or RPC can change this database-owned gate.

create or replace function public.admin_grantable_permissions()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'analytics.view','users.manage','listings.moderate','bookings.view','payments.view',
    'payouts.view','reviews.moderate','categories.manage','audit.view','integrations.view',
    'disputes.manage','support.manage','promotions.manage','credits.manage',
    'refunds.issue','refunds.approve','refunds.senior'
  ];
$$;

create table public.operations_cases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dispute','support')),
  booking_id uuid references public.bookings(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  participant_id uuid not null references public.profiles(id) on delete restrict,
  category text not null,
  subject text not null check (length(btrim(subject)) between 3 and 160),
  status text not null default 'open',
  proposed_amount numeric check(proposed_amount>=0 and proposed_amount<1000000 and proposed_amount=round(proposed_amount,2)),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references public.admin_users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'dispute' or booking_id is not null),
  check (
    (kind = 'dispute' and category in ('damaged','missing','incorrect','malfunction','late_return','other'))
    or (kind = 'support' and category in ('booking','cancellation','pickup_return','payment','refund','deposit_release','other'))
  ),
  check (
    (kind='dispute' and status in ('open','investigating','awaiting_evidence','escalated','decided','closed'))
    or (kind='support' and status in ('open','in_progress','awaiting_user','resolved','closed'))
  )
);
create index operations_cases_queue_idx on public.operations_cases(kind,status,updated_at desc);
create index operations_cases_participant_idx on public.operations_cases(participant_id,created_at desc);
create index operations_cases_booking_idx on public.operations_cases(booking_id);
create index operations_cases_assignee_idx on public.operations_cases(assigned_to);
create trigger operations_cases_updated before update on public.operations_cases
  for each row execute function public.set_updated_at();
create trigger operations_cases_safe_text before insert or update on public.operations_cases
  for each row execute function public.reject_unsafe_text('160','subject');

create table public.operations_case_replies (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.operations_cases(id) on delete restrict,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (length(btrim(body)) between 1 and 2000),
  is_private boolean not null default false,
  created_at timestamptz not null default now()
);
create index operations_case_replies_case_idx on public.operations_case_replies(case_id,created_at);
create trigger operations_case_replies_safe_text before insert on public.operations_case_replies
  for each row execute function public.reject_unsafe_text('2000','body');

create table public.operations_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.operations_cases(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index operations_case_events_case_idx on public.operations_case_events(case_id,created_at);
create table public.operations_case_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.operations_cases(id) on delete restrict,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  object_path text not null unique,
  created_at timestamptz not null default now()
);
create index operations_case_evidence_case_idx on public.operations_case_evidence(case_id);
create table public.operations_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  case_id uuid not null references public.operations_cases(id) on delete restrict,
  event_type text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index operations_notifications_user_idx on public.operations_notifications(user_id,created_at desc);

-- Explicit session check is necessary because these RPCs intentionally bypass RLS.
create function public.operations_require_session()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_active_session() then
    raise exception 'Active session required' using errcode = '42501';
  end if;
end;
$$;

create function public.operations_case_staff(p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_kind when 'dispute' then public.has_admin_permission('disputes.manage')
    when 'support' then public.has_admin_permission('support.manage') else false end;
$$;

create function public.operations_case_participant(p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_active_session() and exists (
    select 1 from public.operations_cases c left join public.bookings b on b.id = c.booking_id
    where c.id = p_case_id and
      (c.participant_id = auth.uid() or b.renter_id = auth.uid() or b.owner_id = auth.uid())
  );
$$;

-- Helper is used by private Storage policies. Invalid paths fail closed, never cast arbitrary text.
create function public.can_access_case_evidence(p_name text, p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_case public.operations_cases;
begin
  if not public.has_active_session()
    or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'
    or split_part(p_name,'/',1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return false; end if;
  select * into v_case from public.operations_cases where id = split_part(p_name,'/',1)::uuid;
  if not found then return false; end if;
  return (public.operations_case_staff(v_case.kind) or public.operations_case_participant(v_case.id))
    and (not p_write or (split_part(p_name,'/',2) = auth.uid()::text and v_case.status not in ('decided','resolved','closed')));
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('admin-case-evidence','admin-case-evidence',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
create policy case_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'admin-case-evidence' and public.can_access_case_evidence(name));
create policy case_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'admin-case-evidence' and public.can_access_case_evidence(name,true));
-- No UPDATE/DELETE policy: uploaded evidence cannot be overwritten by a participant.

create function public.operations_record_case_event(p_case_id uuid,p_type text,p_detail jsonb,p_notify boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.operations_case_events(case_id,actor_id,event_type,detail)
    values (p_case_id,auth.uid(),p_type,p_detail);
  if p_notify then
    insert into public.operations_notifications(user_id,case_id,event_type)
    select distinct recipient,p_case_id,p_type from (
      select c.participant_id recipient from public.operations_cases c where c.id = p_case_id
      union select b.renter_id from public.operations_cases c join public.bookings b on b.id=c.booking_id where c.id=p_case_id
      union select b.owner_id from public.operations_cases c join public.bookings b on b.id=c.booking_id where c.id=p_case_id
      union select c.assigned_to from public.operations_cases c where c.id=p_case_id
    ) r where recipient is not null and recipient <> auth.uid();
  end if;
end;
$$;

create function public.operations_create_case(
  p_kind text,p_booking_id uuid,p_participant_id uuid,p_category text,p_subject text,p_body text,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_case public.operations_cases; v_booking public.bookings;
begin
  perform public.operations_require_session();
  if p_booking_id is not null then
    select * into v_booking from public.bookings where id=p_booking_id;
    if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
    if p_participant_id not in (v_booking.renter_id,v_booking.owner_id) then
      raise exception 'Participant must belong to the booking' using errcode='22023';
    end if;
  end if;
  insert into public.operations_cases(kind,booking_id,created_by,participant_id,category,subject)
    values(p_kind,p_booking_id,auth.uid(),p_participant_id,p_category,btrim(p_subject)) returning * into v_case;
  insert into public.operations_case_replies(case_id,author_id,body)
    values(v_case.id,auth.uid(),btrim(p_body));
  perform public.operations_record_case_event(v_case.id,'created','{}');
  perform public.admin_write_audit('case.create','operations_case',v_case.id::text,null,to_jsonb(v_case),p_reason);
  return to_jsonb(v_case);
end;
$$;

create function public.create_case(p_kind text,p_booking_id uuid,p_category text,p_subject text,p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.operations_require_session();
  if p_booking_id is not null and not exists (
    select 1 from public.bookings where id=p_booking_id and auth.uid() in (renter_id,owner_id)
  ) then raise exception 'Not a booking participant' using errcode='42501'; end if;
  return public.operations_create_case(p_kind,p_booking_id,auth.uid(),p_category,p_subject,p_body,null);
end;
$$;

create function public.admin_create_case(
  p_kind text,p_booking_id uuid,p_participant_id uuid,p_category text,p_subject text,p_body text,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.operations_case_staff(p_kind) then raise exception 'Not authorized' using errcode='42501'; end if;
  return public.operations_create_case(p_kind,p_booking_id,p_participant_id,p_category,p_subject,p_body,public.admin_clean_reason(p_reason));
end;
$$;

create function public.admin_list_cases(
  p_kind text default null,p_status text default null,p_limit int default 25,p_offset int default 0,
  p_search text default null,p_priority text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not (public.operations_case_staff('dispute') or public.operations_case_staff('support')) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  with base as (
    select c.* from public.operations_cases c where public.operations_case_staff(c.kind)
      and (p_kind is null or c.kind=p_kind) and (p_status is null or c.status=p_status)
      and (p_priority is null or c.priority=p_priority)
      and (p_search is null or p_search='' or strpos(lower(c.subject),lower(p_search))>0 or c.id::text=p_search
        or c.booking_id::text=p_search)
  ), page as (
    select * from base order by updated_at desc,id limit least(greatest(coalesce(p_limit,25),1),100)
      offset greatest(coalesce(p_offset,0),0)
  ) select jsonb_build_object('total',(select count(*) from base),'rows',
    coalesce((select jsonb_agg(to_jsonb(page) order by updated_at desc,id) from page),'[]')) into v_result;
  return v_result;
end;
$$;

create function public.list_my_cases(
  p_limit int default 25,p_offset int default 0,p_kind text default null,p_status text default null,
  p_search text default null,p_priority text default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.operations_require_session();
  with base as (
    select c.* from public.operations_cases c where public.operations_case_participant(c.id)
      and (p_kind is null or c.kind=p_kind) and (p_status is null or c.status=p_status)
      and (p_priority is null or c.priority=p_priority)
      and (p_search is null or p_search='' or strpos(lower(c.subject),lower(p_search))>0 or c.id::text=p_search
        or c.booking_id::text=p_search)
  ), page as (
    select * from base order by updated_at desc,id limit least(greatest(coalesce(p_limit,25),1),100)
      offset greatest(coalesce(p_offset,0),0)
  ) select jsonb_build_object('total',(select count(*) from base),'rows',
    coalesce((select jsonb_agg(to_jsonb(page) order by updated_at desc,id) from page),'[]')) into v_result;
  return v_result;
end;
$$;

create function public.get_case_detail(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_case public.operations_cases; v_staff boolean;
begin
  perform public.operations_require_session();
  select * into v_case from public.operations_cases where id=p_case_id;
  v_staff := public.operations_case_staff(v_case.kind);
  if not coalesce(v_staff or public.operations_case_participant(p_case_id),false) then
    raise exception 'Case not found or not authorized' using errcode='42501';
  end if;
  return jsonb_build_object('case',to_jsonb(v_case),
    'deadline_policy_unresolved',v_case.kind='dispute',
    'booking',(select jsonb_build_object(
      'id',b.id,'status',b.status,'start_date',b.start_date,'end_date',b.end_date,
      'created_at',b.created_at,'updated_at',b.updated_at
    ) from public.bookings b where b.id=v_case.booking_id),
    'replies',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from public.operations_case_replies r
      where r.case_id=p_case_id and (v_staff or not r.is_private)),'[]'),
    -- Events include internal reasons/assignment changes. Only staff sees the event stream.
    'events',case when v_staff then coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id)
      from public.operations_case_events e where e.case_id=p_case_id),'[]') else '[]'::jsonb end,
    'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id)
      from public.operations_case_evidence e where e.case_id=p_case_id),'[]'));
end;
$$;

create function public.admin_update_case(
  p_case_id uuid,p_status text,p_priority text,p_assigned_to uuid,p_reason text,p_proposed_amount numeric default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old public.operations_cases; v_new public.operations_cases; v_reason text;
begin
  select * into v_old from public.operations_cases where id=p_case_id for update;
  if not found then raise exception 'Case not found' using errcode='P0002'; end if;
  if not public.operations_case_staff(v_old.kind) then raise exception 'Not authorized' using errcode='42501'; end if;
  v_reason := public.admin_clean_reason(p_reason);
  if p_status is null or not (p_status=v_old.status or
    (v_old.kind='dispute' and (
      (v_old.status='open' and p_status in ('investigating','closed')) or
      (v_old.status='investigating' and p_status in ('awaiting_evidence','escalated','decided','closed')) or
      (v_old.status='awaiting_evidence' and p_status in ('investigating','escalated','decided','closed')) or
      (v_old.status='escalated' and p_status in ('investigating','awaiting_evidence','decided','closed')) or
      (v_old.status='decided' and p_status in ('investigating','closed'))
    )) or (v_old.kind='support' and (
      (v_old.status='open' and p_status in ('in_progress','closed')) or
      (v_old.status='in_progress' and p_status in ('awaiting_user','resolved','closed')) or
      (v_old.status='awaiting_user' and p_status in ('in_progress','resolved','closed')) or
      (v_old.status='resolved' and p_status in ('in_progress','closed'))
    ))
  ) then raise exception 'Invalid case transition' using errcode='22023'; end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.admin_users where user_id=p_assigned_to and active
      and (role='super_admin' or (case v_old.kind when 'dispute' then 'disputes.manage' else 'support.manage' end)=any(permissions))
  ) then raise exception 'Assignee lacks case permission' using errcode='22023'; end if;
  update public.operations_cases set status=p_status,priority=p_priority,assigned_to=p_assigned_to,
    proposed_amount=coalesce(p_proposed_amount,proposed_amount)
    where id=p_case_id returning * into v_new;
  perform public.operations_record_case_event(p_case_id,'updated',jsonb_build_object('old',to_jsonb(v_old),'new',to_jsonb(v_new),'reason',v_reason));
  perform public.admin_write_audit('case.update','operations_case',p_case_id::text,to_jsonb(v_old),to_jsonb(v_new),v_reason);
  return to_jsonb(v_new);
end;
$$;

create function public.reply_to_case(p_case_id uuid,p_body text,p_private boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_case public.operations_cases; v_staff boolean; v_reply public.operations_case_replies;
begin
  perform public.operations_require_session();
  select * into v_case from public.operations_cases where id=p_case_id for update;
  v_staff := public.operations_case_staff(v_case.kind);
  if not coalesce(v_staff or public.operations_case_participant(p_case_id),false) or (coalesce(p_private,false) and not v_staff) then
    raise exception 'Not authorized' using errcode='42501'; end if;
  if v_case.status in ('decided','resolved','closed') then raise exception 'Case is not accepting replies' using errcode='22023'; end if;
  insert into public.operations_case_replies(case_id,author_id,body,is_private)
    values(p_case_id,auth.uid(),btrim(p_body),coalesce(p_private,false)) returning * into v_reply;
  update public.operations_cases set updated_at=now() where id=p_case_id;
  perform public.operations_record_case_event(p_case_id,case when p_private then 'private_note' else 'reply' end,
    jsonb_build_object('reply_id',v_reply.id),not coalesce(p_private,false));
  perform public.admin_write_audit(case when p_private then 'case.note' else 'case.reply' end,
    'operations_case',p_case_id::text,null,jsonb_build_object('reply_id',v_reply.id),null);
  return to_jsonb(v_reply);
end;
$$;

create function public.register_case_evidence(p_case_id uuid,p_object_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.operations_case_evidence;
begin
  if not public.can_access_case_evidence(p_object_path,true) or split_part(p_object_path,'/',1)<>p_case_id::text then
    raise exception 'Not authorized' using errcode='42501'; end if;
  if not exists(select 1 from storage.objects where bucket_id='admin-case-evidence' and name=p_object_path) then
    raise exception 'Upload evidence before registering it' using errcode='22023'; end if;
  insert into public.operations_case_evidence(case_id,uploaded_by,object_path)
    values(p_case_id,auth.uid(),p_object_path) returning * into v_row;
  perform public.operations_record_case_event(p_case_id,'evidence_added',jsonb_build_object('evidence_id',v_row.id));
  perform public.admin_write_audit('case.evidence','operations_case',p_case_id::text,null,to_jsonb(v_row),null);
  return to_jsonb(v_row);
end;
$$;

create function public.list_my_notifications(p_limit int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.operations_require_session();
  with base as (select * from public.operations_notifications where user_id=auth.uid()),
  page as (select * from base order by created_at desc,id limit least(greatest(coalesce(p_limit,25),1),100)
    offset greatest(coalesce(p_offset,0),0))
  select jsonb_build_object('total',(select count(*) from base),'rows',
    coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]')) into v_result;
  return v_result;
end;
$$;
create function public.mark_notification_read(p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.operations_require_session();
  update public.operations_notifications set read_at=coalesce(read_at,now())
    where id=p_notification_id and user_id=auth.uid();
  if not found then raise exception 'Notification not found' using errcode='P0002'; end if;
  return '{"ok":true}'::jsonb;
end;
$$;

-- Financial test gate is not an app setting or feature flag. No admin can enable it.
create table public.admin_financial_test_gate (
  singleton boolean primary key default true check(singleton),
  environment text not null default 'disabled' check(environment in ('disabled','local_test')),
  enabled boolean not null default false,
  check(not enabled or environment='local_test')
);
insert into public.admin_financial_test_gate default values;
revoke all on public.admin_financial_test_gate from public,anon,authenticated,service_role;
create function public.operations_require_financial_test()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.operations_require_session();
  if not exists(select 1 from public.admin_financial_test_gate where singleton and environment='local_test' and enabled) then
    raise exception 'Financial test operations are disabled' using errcode='42501';
  end if;
end;
$$;
create function public.admin_operations_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.operations_require_session();
  return jsonb_build_object('financial_test_enabled',
    exists(select 1 from public.admin_financial_test_gate where singleton and environment='local_test' and enabled),
    'refund_execution_enabled',false,'credit_restoration_enabled',false);
end;
$$;

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check(code ~ '^[A-Z0-9_-]{3,40}$'),
  description text not null default '' check(length(description)<=500),
  discount_type text not null check(discount_type in ('fixed','percent')),
  discount_value numeric not null check(discount_value>0 and discount_value<1000000 and discount_value=round(discount_value,2)),
  max_discount numeric check(max_discount>0 and max_discount<1000000 and max_discount=round(max_discount,2)),
  min_subtotal numeric not null default 0 check(min_subtotal>=0 and min_subtotal<1000000 and min_subtotal=round(min_subtotal,2)),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_redemptions int check(max_redemptions>0),
  per_user_limit int not null default 1 check(per_user_limit>0),
  category_ids uuid[] not null default '{}',
  listing_ids uuid[] not null default '{}',
  active boolean not null default false,
  funding text not null default 'platform' check(funding='platform'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at>starts_at),
  check(discount_type<>'percent' or discount_value<=100)
);
create trigger promotions_updated before update on public.promotions for each row execute function public.set_updated_at();
create trigger promotions_safe_text before insert or update on public.promotions
  for each row execute function public.reject_unsafe_text('500','description');
create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  discount_amount numeric not null check(discount_amount>0),
  created_at timestamptz not null default now()
);
create index promotion_redemptions_usage_idx on public.promotion_redemptions(promotion_id,user_id);

create function public.admin_list_promotions(p_limit int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.admin_require('promotions.manage');
  with page as (select p.*,
    (select count(*) from public.promotion_redemptions r where r.promotion_id=p.id) redemptions,
    (select coalesce(sum(r.discount_amount),0) from public.promotion_redemptions r where r.promotion_id=p.id) discount_total
    from public.promotions p order by p.created_at desc,p.id
    limit least(greatest(coalesce(p_limit,25),1),100) offset greatest(coalesce(p_offset,0),0))
  select jsonb_build_object('total',(select count(*) from public.promotions),'rows',
    coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]')) into v_result;
  return v_result;
end;
$$;

-- Full editable object, not an unchecked JSON patch; unknown keys are rejected.
create function public.admin_save_promotion(p_id uuid,p_values jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old public.promotions; v_row public.promotions; v_reason text;
begin
  perform public.admin_require('promotions.manage');
  v_reason := public.admin_clean_reason(p_reason);
  if jsonb_typeof(p_values) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_values) k where k not in
      ('code','description','discount_type','discount_value','max_discount','min_subtotal','starts_at','ends_at',
       'max_redemptions','per_user_limit','category_ids','listing_ids','active','funding')
  ) then raise exception 'Invalid promotion fields' using errcode='22023'; end if;
  if p_id is not null then
    select * into v_old from public.promotions where id=p_id for update;
    if not found then raise exception 'Promotion not found' using errcode='P0002'; end if;
  end if;
  v_row := jsonb_populate_record(null::public.promotions,p_values);
  v_row.id := coalesce(p_id,gen_random_uuid());
  v_row.code := upper(btrim(v_row.code));
  v_row.description := coalesce(v_row.description,'');
  v_row.min_subtotal := coalesce(v_row.min_subtotal,0);
  v_row.per_user_limit := coalesce(v_row.per_user_limit,1);
  v_row.category_ids := coalesce(v_row.category_ids,'{}');
  v_row.listing_ids := coalesce(v_row.listing_ids,'{}');
  v_row.active := coalesce(v_row.active,false);
  v_row.funding := coalesce(v_row.funding,'platform');
  if exists(select 1 from unnest(v_row.category_ids) x where x is null or not exists(select 1 from public.categories where id=x))
    or exists(select 1 from unnest(v_row.listing_ids) x where x is null or not exists(select 1 from public.listings where id=x)) then
    raise exception 'Unknown eligibility category or listing' using errcode='22023';
  end if;
  insert into public.promotions(id,code,description,discount_type,discount_value,max_discount,min_subtotal,
    starts_at,ends_at,max_redemptions,per_user_limit,category_ids,listing_ids,active,funding)
  values(v_row.id,v_row.code,v_row.description,v_row.discount_type,v_row.discount_value,v_row.max_discount,v_row.min_subtotal,
    v_row.starts_at,v_row.ends_at,v_row.max_redemptions,v_row.per_user_limit,v_row.category_ids,v_row.listing_ids,v_row.active,v_row.funding)
  on conflict(id) do update set code=excluded.code,description=excluded.description,discount_type=excluded.discount_type,
    discount_value=excluded.discount_value,max_discount=excluded.max_discount,min_subtotal=excluded.min_subtotal,
    starts_at=excluded.starts_at,ends_at=excluded.ends_at,max_redemptions=excluded.max_redemptions,
    per_user_limit=excluded.per_user_limit,category_ids=excluded.category_ids,listing_ids=excluded.listing_ids,
    active=excluded.active,funding=excluded.funding returning * into v_row;
  perform public.admin_write_audit(case when p_id is null then 'promotion.create' else 'promotion.update' end,
    'promotion',v_row.id::text,case when p_id is not null then to_jsonb(v_old) end,to_jsonb(v_row),v_reason);
  return to_jsonb(v_row);
end;
$$;
create function public.admin_delete_promotion(p_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_reason text;
begin
  perform public.admin_require('promotions.manage');
  v_reason := public.admin_clean_reason(p_reason);
  select to_jsonb(p) into v_old from public.promotions p where id=p_id for update;
  if v_old is null then raise exception 'Promotion not found' using errcode='P0002'; end if;
  if exists(select 1 from public.promotion_redemptions where promotion_id=p_id) then
    raise exception 'Redeemed promotions must be deactivated, not deleted' using errcode='22023'; end if;
  delete from public.promotions where id=p_id;
  perform public.admin_write_audit('promotion.delete','promotion',p_id::text,v_old,null,v_reason);
  return '{"ok":true}'::jsonb;
end;
$$;

create function public.admin_promotion_redemptions(p_promotion_id uuid,p_limit int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.admin_require('promotions.manage');
  with base as (select * from public.promotion_redemptions where promotion_id=p_promotion_id),
  page as (select * from base order by created_at desc,id
    limit least(greatest(coalesce(p_limit,25),1),100) offset greatest(coalesce(p_offset,0),0))
  select jsonb_build_object('total',(select count(*) from base),'rows',
    coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]')) into v_result;
  return v_result;
end;
$$;

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric not null check(amount>0 and amount<1000000 and amount=round(amount,2)),
  kind text not null check(kind in ('signup','manual')),
  idempotency_key text not null check(length(btrim(idempotency_key)) between 3 and 160),
  reason text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '90 days'),
  check(expires_at>created_at),
  unique(user_id,idempotency_key)
);
create unique index credit_ledger_one_signup_idx on public.credit_ledger(user_id) where kind='signup';
create index credit_ledger_user_idx on public.credit_ledger(user_id,created_at desc);
create table public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  amount numeric not null check(amount>0 and amount<1000000 and amount=round(amount,2)),
  status text not null default 'reserved' check(status in ('reserved','released')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  check ((status='released')=(released_at is not null))
);
create index credit_reservations_user_idx on public.credit_reservations(user_id,status);

create function public.operations_credit_balance(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with sums as (
    select coalesce((select sum(amount) from public.credit_ledger where user_id=p_user_id and expires_at>now()),0) balance,
      coalesce((select sum(amount) from public.credit_reservations where user_id=p_user_id and status='reserved'),0) reserved
  ) select jsonb_build_object('balance',balance,'reserved',reserved,'available',greatest(balance-reserved,0)) from sums;
$$;
create function public.admin_list_credit_accounts(p_limit int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.admin_require('credits.manage');
  with page as (select p.id user_id,p.email,p.full_name,public.operations_credit_balance(p.id) amounts
    from public.profiles p order by p.created_at desc,p.id
    limit least(greatest(coalesce(p_limit,25),1),100) offset greatest(coalesce(p_offset,0),0))
  select jsonb_build_object('total',(select count(*) from public.profiles),'rows',
    coalesce((select jsonb_agg((to_jsonb(page)-'amounts')||amounts) from page),'[]')) into v_result;
  return v_result;
end;
$$;
create function public.admin_credit_history(p_user_id uuid,p_limit int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.admin_require('credits.manage');
  with page as (select * from public.credit_ledger where user_id=p_user_id order by created_at desc,id
    limit least(greatest(coalesce(p_limit,25),1),100) offset greatest(coalesce(p_offset,0),0))
  select jsonb_build_object('total',(select count(*) from public.credit_ledger where user_id=p_user_id),'rows',
    coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]')) into v_result;
  return v_result || public.operations_credit_balance(p_user_id);
end;
$$;
create function public.get_my_credits()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.operations_require_session();
  return public.operations_credit_balance(auth.uid()) || jsonb_build_object('history',coalesce((
    select jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id) from (
      select * from public.credit_ledger where user_id=auth.uid() order by created_at desc,id limit 100
    ) l),'[]'));
end;
$$;
create function public.admin_grant_credit(p_user_id uuid,p_amount numeric,p_kind text,p_idempotency_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.credit_ledger; v_reason text;
begin
  perform public.admin_require('credits.manage');
  perform public.operations_require_financial_test();
  v_reason:=public.admin_clean_reason(p_reason);
  perform 1 from public.profiles where id=p_user_id for update;
  if not found then raise exception 'User not found' using errcode='P0002'; end if;
  if exists(select 1 from public.user_restrictions where user_id=p_user_id) then
    raise exception 'Restricted accounts are not eligible for credit grants' using errcode='42501'; end if;
  if p_kind='signup' and p_amount is distinct from 5::numeric then
    raise exception 'Test signup credit must be exactly USD 5' using errcode='22023'; end if;
  select * into v_row from public.credit_ledger where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_row.amount is distinct from p_amount or v_row.kind is distinct from p_kind then
      raise exception 'Idempotency key already used for different credit' using errcode='22023'; end if;
    return to_jsonb(v_row);
  end if;
  if p_kind='signup' and exists(select 1 from public.credit_ledger where user_id=p_user_id and kind='signup') then
    raise exception 'Account has already received signup credit' using errcode='22023'; end if;
  insert into public.credit_ledger(user_id,amount,kind,idempotency_key,reason,created_by)
    values(p_user_id,p_amount,p_kind,p_idempotency_key,v_reason,auth.uid()) returning * into v_row;
  perform public.admin_write_audit('credit.grant.test','credit_ledger',v_row.id::text,null,to_jsonb(v_row),v_reason);
  return to_jsonb(v_row);
end;
$$;

-- Quotes derive from booking snapshots, not caller-supplied amounts. Deposits are ineligible.
-- Stacking is off for promotions AND credits. Existing checkout is intentionally untouched.
create function public.quote_test_promotion(p_booking_id uuid,p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_b public.bookings; v_p public.promotions; v_category uuid; v_discount numeric;
begin
  perform public.operations_require_financial_test();
  select * into v_b from public.bookings where id=p_booking_id and renter_id=auth.uid();
  if not found then raise exception 'Booking not found or not authorized' using errcode='42501'; end if;
  if v_b.status not in ('requested','pending_payment') then raise exception 'Booking is not eligible' using errcode='22023'; end if;
  select * into v_p from public.promotions where code=upper(btrim(p_code));
  select category_id into v_category from public.listings where id=v_b.listing_id;
  if v_p.id is null or not v_p.active or now()<v_p.starts_at or now()>=v_p.ends_at
    or v_b.subtotal<v_p.min_subtotal
    or (cardinality(v_p.category_ids)>0 and not coalesce(v_category=any(v_p.category_ids),false))
    or (cardinality(v_p.listing_ids)>0 and not (v_b.listing_id=any(v_p.listing_ids)))
    or (v_p.max_redemptions is not null and (select count(*) from public.promotion_redemptions where promotion_id=v_p.id)>=v_p.max_redemptions)
    or (select count(*) from public.promotion_redemptions where promotion_id=v_p.id and user_id=auth.uid())>=v_p.per_user_limit
    then raise exception 'Promotion is not eligible' using errcode='22023'; end if;
  if exists(select 1 from public.promotion_redemptions where booking_id=p_booking_id)
    or exists(select 1 from public.credit_reservations where booking_id=p_booking_id and status='reserved') then
    raise exception 'Discount stacking is disabled' using errcode='22023'; end if;
  v_discount:=least(v_b.subtotal,coalesce(v_p.max_discount,v_b.subtotal),
    case v_p.discount_type when 'fixed' then v_p.discount_value else round(v_b.subtotal*v_p.discount_value/100,2) end);
  if v_discount<=0 then raise exception 'No eligible rental subtotal' using errcode='22023'; end if;
  return jsonb_build_object('promotion_id',v_p.id,'booking_id',p_booking_id,'discount_amount',v_discount,'test_only',true);
end;
$$;
create function public.redeem_test_promotion(p_booking_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_quote jsonb; v_row public.promotion_redemptions;
begin
  perform public.operations_require_financial_test();
  -- Always lock booking then promotion: limits and stacking are checked under the same locks.
  perform 1 from public.bookings where id=p_booking_id for update;
  perform 1 from public.promotions where code=upper(btrim(p_code)) for update;
  select * into v_row from public.promotion_redemptions where booking_id=p_booking_id and user_id=auth.uid();
  if found then
    if not exists(select 1 from public.promotions where id=v_row.promotion_id and code=upper(btrim(p_code))) then
      raise exception 'Discount stacking is disabled' using errcode='22023'; end if;
    return to_jsonb(v_row)||'{"test_only":true}'::jsonb;
  end if;
  v_quote:=public.quote_test_promotion(p_booking_id,p_code);
  insert into public.promotion_redemptions(promotion_id,booking_id,user_id,discount_amount)
    values((v_quote->>'promotion_id')::uuid,p_booking_id,auth.uid(),(v_quote->>'discount_amount')::numeric) returning * into v_row;
  perform public.admin_write_audit('promotion.redeem.test','promotion_redemption',v_row.id::text,null,to_jsonb(v_row),null);
  return to_jsonb(v_row)||'{"test_only":true}'::jsonb;
end;
$$;
create function public.quote_test_credit(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_b public.bookings; v_available numeric;
begin
  perform public.operations_require_financial_test();
  select * into v_b from public.bookings where id=p_booking_id and renter_id=auth.uid();
  if not found then raise exception 'Booking not found or not authorized' using errcode='42501'; end if;
  if v_b.status not in ('requested','pending_payment') then raise exception 'Booking is not eligible' using errcode='22023'; end if;
  if exists(select 1 from public.promotion_redemptions where booking_id=p_booking_id)
    or exists(select 1 from public.credit_reservations where booking_id=p_booking_id and status='reserved') then
    raise exception 'Discount stacking is disabled' using errcode='22023'; end if;
  v_available:=(public.operations_credit_balance(auth.uid())->>'available')::numeric;
  return jsonb_build_object('booking_id',p_booking_id,'available',v_available,
    'credit_amount',least(v_available,v_b.subtotal+v_b.service_fee_amount),'test_only',true);
end;
$$;
create function public.reserve_test_credit(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_quote jsonb; v_row public.credit_reservations;
begin
  perform public.operations_require_financial_test();
  perform 1 from public.bookings where id=p_booking_id for update;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into v_row from public.credit_reservations where booking_id=p_booking_id and user_id=auth.uid();
  if found then return to_jsonb(v_row)||'{"test_only":true}'::jsonb; end if;
  v_quote:=public.quote_test_credit(p_booking_id);
  if (v_quote->>'credit_amount')::numeric<=0 then raise exception 'No available credit' using errcode='22023'; end if;
  insert into public.credit_reservations(user_id,booking_id,amount)
    values(auth.uid(),p_booking_id,(v_quote->>'credit_amount')::numeric) returning * into v_row;
  perform public.admin_write_audit('credit.reserve.test','credit_reservation',v_row.id::text,null,to_jsonb(v_row),null);
  return to_jsonb(v_row)||'{"test_only":true}'::jsonb;
end;
$$;
create function public.release_test_credit(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old public.credit_reservations; v_new public.credit_reservations;
begin
  perform public.operations_require_financial_test();
  perform 1 from public.bookings where id=p_booking_id for update;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into v_old from public.credit_reservations where booking_id=p_booking_id and user_id=auth.uid() for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  if v_old.status='released' then return to_jsonb(v_old)||'{"test_only":true}'::jsonb; end if;
  update public.credit_reservations set status='released',released_at=now() where id=v_old.id returning * into v_new;
  perform public.admin_write_audit('credit.release.test','credit_reservation',v_new.id::text,to_jsonb(v_old),to_jsonb(v_new),null);
  -- This releases an unused simulation reservation; refund credit restoration is NOT implemented/enabled.
  return to_jsonb(v_new)||'{"test_only":true}'::jsonb;
end;
$$;

-- Policy is intentionally not a setting. Until allocation/restoration is approved there
-- is no valid append to the ledger, even in a locally enabled financial simulation.
create function public.restore_test_credit(p_reservation_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require('credits.manage');
  perform public.operations_require_financial_test();
  perform public.admin_clean_reason(p_reason);
  if p_reservation_id is null then
    raise exception 'Reservation ID is required' using errcode='22023';
  end if;
  raise exception 'Credit restoration policy is not approved' using errcode='42501';
end;
$$;

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  amount numeric not null check(amount>0 and amount<1000000 and amount=round(amount,2)),
  currency text not null default 'usd' check(currency='usd'),
  status text not null default 'requested' check(status in ('requested','approved')),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text check(idempotency_key is null or length(btrim(idempotency_key)) between 3 and 160),
  approved_by uuid references public.profiles(id) on delete restrict,
  reason text not null,
  approval_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  execution_enabled boolean not null default false check(not execution_enabled),
  -- Only a trusted LOCAL operator can bind a sandbox provider reference. No execution RPC exists.
  provider_ref text unique,
  provider_status text check(provider_status in ('pending','succeeded','failed','canceled')),
  unique(requested_by,idempotency_key),
  check(approved_by is null or approved_by<>requested_by),
  check((status='approved')=(approved_by is not null and approved_at is not null and approval_reason is not null))
);
create index refund_requests_payment_idx on public.refund_requests(payment_id);
create index refund_requests_created_idx on public.refund_requests(created_at desc);
create table public.refund_provider_events (
  event_id text primary key check(length(event_id) between 3 and 200),
  provider_ref text not null check(length(provider_ref) between 3 and 200),
  payment_intent_id text not null check(length(payment_intent_id) between 3 and 200),
  amount numeric not null check(amount>0 and amount<1000000 and amount=round(amount,2)),
  currency text not null check(currency='usd'),
  status text not null check(status in ('pending','succeeded','failed','canceled','requires_action')),
  livemode boolean not null check(not livemode),
  refund_request_id uuid references public.refund_requests(id) on delete restrict,
  processing_status text not null check(processing_status in ('matched','unmatched','exception')),
  exception_reason text,
  created_at timestamptz not null default now()
);
create index refund_provider_events_created_idx on public.refund_provider_events(created_at desc);
create function public.operations_can_view_refunds()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_admin_permission('refunds.issue') or public.has_admin_permission('refunds.approve') or public.has_admin_permission('refunds.senior');
$$;
create function public.admin_list_refund_requests(p_limit int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.operations_can_view_refunds() then raise exception 'Not authorized' using errcode='42501'; end if;
  with page as (select * from public.refund_requests order by created_at desc,id
    limit least(greatest(coalesce(p_limit,25),1),100) offset greatest(coalesce(p_offset,0),0))
  select jsonb_build_object('total',(select count(*) from public.refund_requests),'rows',
    coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]')) into v_result;
  return v_result;
end;
$$;
create function public.admin_request_refund(p_payment_id uuid,p_amount numeric,p_reason text,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payment public.payments; v_row public.refund_requests; v_reason text;
begin
  perform public.admin_require('refunds.issue');
  perform public.operations_require_financial_test();
  v_reason:=public.admin_clean_reason(p_reason);
  select * into v_payment from public.payments where id=p_payment_id for update;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
  if p_idempotency_key is not null then
    select * into v_row from public.refund_requests where requested_by=auth.uid() and idempotency_key=p_idempotency_key;
    if found then
      if v_row.payment_id is distinct from p_payment_id or v_row.amount is distinct from p_amount then
        raise exception 'Idempotency key already used for different refund' using errcode='22023'; end if;
      return to_jsonb(v_row);
    end if;
  end if;
  if v_payment.status<>'succeeded' or lower(v_payment.currency)<>'usd' then
    raise exception 'Refund requires a verified USD payment' using errcode='22023'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>=1000000
    or p_amount+(select coalesce(sum(amount),0) from public.refund_requests where payment_id=p_payment_id)>v_payment.amount then
    raise exception 'Invalid or excessive refund amount' using errcode='22023'; end if;
  insert into public.refund_requests(payment_id,booking_id,amount,requested_by,reason,idempotency_key)
    values(p_payment_id,v_payment.booking_id,p_amount,auth.uid(),v_reason,p_idempotency_key) returning * into v_row;
  perform public.admin_write_audit('refund.request.test','refund_request',v_row.id::text,null,to_jsonb(v_row),v_reason);
  return to_jsonb(v_row);
end;
$$;
create function public.admin_approve_refund(p_refund_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old public.refund_requests; v_new public.refund_requests; v_reason text; v_total numeric;
begin
  perform public.operations_require_financial_test();
  select * into v_old from public.refund_requests where id=p_refund_id for update;
  if not found then raise exception 'Refund request not found' using errcode='P0002'; end if;
  -- Tier uses total requested against the payment, preventing threshold bypass by splitting.
  perform 1 from public.payments where id=v_old.payment_id and status='succeeded' and lower(currency)='usd' for update;
  if not found then raise exception 'Payment is no longer eligible' using errcode='22023'; end if;
  select sum(amount) into v_total from public.refund_requests where payment_id=v_old.payment_id;
  if not (
    public.has_admin_permission('refunds.senior')
    or (v_total<=1000 and public.has_admin_permission('refunds.approve'))
    or (v_total<=250 and public.has_admin_permission('refunds.issue'))
  ) then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_old.requested_by=auth.uid() then raise exception 'A different administrator must approve' using errcode='42501'; end if;
  if v_old.status<>'requested' then raise exception 'Refund request is already approved' using errcode='22023'; end if;
  v_reason:=public.admin_clean_reason(p_reason);
  update public.refund_requests set status='approved',approved_by=auth.uid(),approved_at=now(),approval_reason=v_reason
    where id=p_refund_id returning * into v_new;
  perform public.admin_write_audit('refund.approve.test','refund_request',v_new.id::text,to_jsonb(v_old),to_jsonb(v_new),v_reason);
  return to_jsonb(v_new);
end;
$$;

-- Only call this after verifying Stripe's webhook signature. This is a sandbox receipt
-- reconciler, NOT a refund executor. Unmatched/mismatched receipts are durable exceptions.
create function public.reconcile_test_refund_event(
  p_event_id text,p_provider_ref text,p_payment_intent_id text,p_amount numeric,
  p_currency text,p_status text,p_livemode boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing public.refund_provider_events; v_row public.refund_provider_events;
  v_refund public.refund_requests; v_processing text:='unmatched'; v_error text:='No approved request is bound to this provider reference';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if p_livemode is distinct from false or not exists(
    select 1 from public.admin_financial_test_gate where singleton and environment='local_test' and enabled
  ) then raise exception 'Financial test operations are disabled' using errcode='42501'; end if;
  -- Serialize duplicate event deliveries without granting a client-chosen lock to public callers.
  perform pg_advisory_xact_lock(hashtextextended('refund_event:'||p_event_id,0));
  select * into v_existing from public.refund_provider_events where event_id=p_event_id;
  if found then
    if (v_existing.provider_ref,v_existing.payment_intent_id,v_existing.amount,v_existing.currency,v_existing.status)
      is distinct from (p_provider_ref,p_payment_intent_id,p_amount,lower(p_currency),p_status) then
      raise exception 'Event ID payload mismatch' using errcode='22023'; end if;
    return to_jsonb(v_existing);
  end if;
  select * into v_refund from public.refund_requests where provider_ref=p_provider_ref for update;
  if found then
    v_processing:='exception'; v_error:='Receipt does not match an approved request and verified payment';
    if p_status<>'requires_action' and v_refund.status='approved' and v_refund.amount=p_amount and v_refund.currency=lower(p_currency)
      and exists(select 1 from public.payments where id=v_refund.payment_id and status='succeeded'
        and stripe_payment_intent_id=p_payment_intent_id)
      and (v_refund.provider_status is null or v_refund.provider_status='pending' or v_refund.provider_status=p_status)
    then
      v_processing:='matched'; v_error:=null;
      update public.refund_requests set provider_status=p_status where id=v_refund.id;
    end if;
  end if;
  if p_status='requires_action' then
    v_processing:='exception';
    v_error:='Provider refund requires action; manual reconciliation is required';
  end if;
  insert into public.refund_provider_events(
    event_id,provider_ref,payment_intent_id,amount,currency,status,livemode,refund_request_id,processing_status,exception_reason
  ) values(p_event_id,p_provider_ref,p_payment_intent_id,p_amount,lower(p_currency),p_status,p_livemode,
    v_refund.id,v_processing,v_error) returning * into v_row;
  insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,new_value,reason,outcome)
    values('00000000-0000-0000-0000-000000000000','refund.provider_event.test','refund_provider_event',
      p_event_id,to_jsonb(v_row),'Verified sandbox provider event; system actor',
      case when v_processing='matched' then 'success' else 'failed' end);
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.reconcile_test_refund_event(text,text,text,numeric,text,text,boolean) from public,anon,authenticated;
grant execute on function public.reconcile_test_refund_event(text,text,text,numeric,text,text,boolean) to service_role;

create function public.admin_list_refund_events(p_limit int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.operations_can_view_refunds() then raise exception 'Not authorized' using errcode='42501'; end if;
  with page as (select * from public.refund_provider_events order by created_at desc,event_id
    limit least(greatest(coalesce(p_limit,25),1),100) offset greatest(coalesce(p_offset,0),0))
  select jsonb_build_object('total',(select count(*) from public.refund_provider_events),'rows',
    coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,event_id) from page),'[]')) into v_result;
  return v_result;
end;
$$;

-- All records remain private behind RPCs; RLS has no permissive client policies.
do $$
declare t text; f text;
begin
  foreach t in array array[
    'operations_cases','operations_case_replies','operations_case_events','operations_case_evidence','operations_notifications',
    'admin_financial_test_gate','promotions','promotion_redemptions','credit_ledger','credit_reservations','refund_requests','refund_provider_events'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
  foreach t in array array['operations_case_replies','operations_case_events','operations_case_evidence','credit_ledger','promotion_redemptions','refund_provider_events'] loop
    execute format('create trigger append_only before update or delete on public.%I for each row execute function public.forbid_audit_mutation()',t);
  end loop;
  -- Revoke the implicit PUBLIC execution privilege from EVERY new helper and endpoint.
  for f in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (
      p.proname like 'operations_%' or p.proname=any(array[
        'can_access_case_evidence','create_case','admin_create_case','admin_list_cases','list_my_cases','get_case_detail',
        'admin_update_case','reply_to_case','register_case_evidence','list_my_notifications','mark_notification_read',
        'admin_operations_status','admin_list_promotions','admin_save_promotion','admin_delete_promotion','admin_promotion_redemptions',
        'admin_list_credit_accounts','admin_credit_history','get_my_credits','admin_grant_credit',
        'quote_test_promotion','redeem_test_promotion','quote_test_credit','reserve_test_credit','release_test_credit','restore_test_credit',
        'admin_list_refund_requests','admin_request_refund','admin_approve_refund','admin_list_refund_events'
      ]))
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f); end loop;
  foreach f in array array[
    'can_access_case_evidence(text,boolean)','create_case(text,uuid,text,text,text)',
    'admin_create_case(text,uuid,uuid,text,text,text,text)','admin_list_cases(text,text,int,int,text,text)','list_my_cases(int,int,text,text,text,text)',
    'get_case_detail(uuid)','admin_update_case(uuid,text,text,uuid,text,numeric)','reply_to_case(uuid,text,boolean)',
    'register_case_evidence(uuid,text)','list_my_notifications(int,int)','mark_notification_read(uuid)',
    'admin_operations_status()','admin_list_promotions(int,int)','admin_save_promotion(uuid,jsonb,text)',
    'admin_delete_promotion(uuid,text)','admin_promotion_redemptions(uuid,int,int)','admin_list_credit_accounts(int,int)','admin_credit_history(uuid,int,int)',
    'get_my_credits()','admin_grant_credit(uuid,numeric,text,text,text)',
    'quote_test_promotion(uuid,text)','redeem_test_promotion(uuid,text)','quote_test_credit(uuid)',
    'reserve_test_credit(uuid)','release_test_credit(uuid)','restore_test_credit(uuid,text)','admin_list_refund_requests(int,int)',
    'admin_request_refund(uuid,numeric,text,text)','admin_approve_refund(uuid,text)','admin_list_refund_events(int,int)'
  ] loop execute format('grant execute on function public.%s to authenticated',f); end loop;
end;
$$;
