begin;

alter table public.bookings add column workflow_version bigint not null default 1 check (workflow_version > 0);

alter table public.booking_inspections
  drop constraint booking_inspections_appearance_condition_check,
  drop constraint booking_inspections_existing_damage_check,
  drop constraint booking_inspections_functional_condition_check,
  alter column appearance_condition drop not null,
  alter column existing_damage drop not null,
  alter column functional_condition drop not null,
  add column revision integer not null default 1 check (revision > 0),
  add column publication_status text not null default 'published'
    check (publication_status in ('draft','published')),
  add column published_at timestamptz,
  add column condition_status text not null default 'pending'
    check (condition_status in ('pending','agreed','disputed','correction_requested')),
  add column review_reason text;

-- System metadata is not a participant edit; preserve evidence timestamps and audit history.
alter table public.booking_inspections disable trigger booking_inspection_audit_record;
alter table public.booking_inspections disable trigger booking_inspections_updated;
update public.booking_inspections set published_at = submitted_at;
update public.booking_inspections set condition_status = 'agreed'
  where owner_acknowledged_at is not null and renter_acknowledged_at is not null;
alter table public.booking_inspections enable trigger booking_inspections_updated;
alter table public.booking_inspections enable trigger booking_inspection_audit_record;
drop policy booking_inspections_participant_read on public.booking_inspections;
create policy booking_inspections_participant_read on public.booking_inspections
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.bookings b where b.id=booking_id
      and auth.uid() in (b.owner_id,b.renter_id)
      and (b.owner_id=auth.uid() or publication_status='published')
  ));
drop policy booking_inspection_photos_participant_read on public.booking_inspection_photos;
create policy booking_inspection_photos_participant_read on public.booking_inspection_photos
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.booking_inspections i join public.bookings b on b.id=i.booking_id
    where i.id=inspection_id and auth.uid() in (b.owner_id,b.renter_id)
      and (b.owner_id=auth.uid() or i.publication_status='published')
  ));
drop policy booking_inspection_audit_participant_read on public.booking_inspection_audit;
create policy booking_inspection_audit_participant_read on public.booking_inspection_audit
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.booking_inspections i join public.bookings b on b.id=i.booking_id
    where i.id=inspection_id and auth.uid() in (b.owner_id,b.renter_id)
      and (b.owner_id=auth.uid() or i.publication_status='published')
  ));
alter table public.booking_inspections add constraint booking_inspections_draft_text_limits check (
  (appearance_condition is null or char_length(appearance_condition) <= 2000)
  and (existing_damage is null or char_length(existing_damage) <= 2000)
  and (functional_condition is null or char_length(functional_condition) <= 1000)
  and char_length(serial_number) <= 120
  and (review_reason is null or char_length(review_reason) <= 1000)
);

alter table public.booking_inspection_photos add column revision integer not null default 1 check (revision > 0);
alter table public.booking_inspection_photos
  drop constraint booking_inspection_photos_object_path_key,
  add constraint booking_inspection_photos_revision_path_key unique(inspection_id,revision,object_path);
alter table public.booking_handoff_otp_challenges add column revision integer not null default 1 check (revision > 0);

create table public.booking_inspection_revisions (
  booking_id uuid not null references public.bookings(id) on delete restrict,
  kind text not null check (kind in ('pickup','return')),
  revision integer not null check (revision > 0),
  inspection jsonb not null,
  photos jsonb not null default '[]',
  published_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (booking_id,kind,revision)
);
alter table public.booking_inspection_revisions enable row level security;
revoke all on public.booking_inspection_revisions from public,anon;
grant select on public.booking_inspection_revisions to authenticated;
create policy booking_inspection_revisions_participant_read on public.booking_inspection_revisions
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.bookings b where b.id=booking_id and auth.uid() in (b.owner_id,b.renter_id)
  ));
create function public.can_read_booking_inspection_photo(p_inspection_id uuid,p_revision integer)
returns boolean language sql stable security definer set search_path='' as $$
  select public.has_active_session() and exists(
    select 1 from public.booking_inspections i join public.bookings b on b.id=i.booking_id
    where i.id=p_inspection_id and auth.uid() in (b.owner_id,b.renter_id)
      and (b.owner_id=auth.uid() or i.publication_status='published' or exists(
        select 1 from public.booking_inspection_revisions r
        where r.booking_id=i.booking_id and r.kind=i.kind and r.revision=p_revision
      ))
  );
$$;
revoke all on function public.can_read_booking_inspection_photo(uuid,integer) from public,anon;
grant execute on function public.can_read_booking_inspection_photo(uuid,integer) to authenticated;
drop policy booking_inspection_photos_participant_read on public.booking_inspection_photos;
create policy booking_inspection_photos_participant_read on public.booking_inspection_photos
  for select to authenticated using (public.can_read_booking_inspection_photo(inspection_id,revision));
drop policy booking_inspection_audit_participant_read on public.booking_inspection_audit;
create policy booking_inspection_audit_owner_read on public.booking_inspection_audit
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.booking_inspections i join public.bookings b on b.id=i.booking_id
    where i.id=inspection_id and b.owner_id=auth.uid()
  ));

create function public.reject_booking_inspection_revision_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Published inspection revisions are immutable' using errcode='55000';
end;
$$;
revoke all on function public.reject_booking_inspection_revision_mutation() from public,anon,authenticated;
create trigger booking_inspection_revisions_immutable
  before update or delete on public.booking_inspection_revisions
  for each row execute function public.reject_booking_inspection_revision_mutation();

insert into public.booking_inspection_revisions(booking_id,kind,revision,inspection,photos,published_at)
select i.booking_id,i.kind,i.revision,to_jsonb(i),
  coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id)
    from public.booking_inspection_photos p where p.inspection_id=i.id and p.revision=i.revision),'[]'::jsonb),
  coalesce(i.published_at,i.submitted_at)
from public.booking_inspections i
where i.publication_status='published';

create table public.booking_handoff_slot_proposals (
  booking_id uuid not null references public.bookings(id) on delete restrict,
  kind text not null check (kind in ('pickup','return')),
  selected_date date not null,
  slot_window text not null check (slot_window in ('morning','afternoon','evening')),
  hour integer not null check (hour between 7 and 19),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at=starts_at+interval '1 hour'),
  time_zone text not null,
  status text not null check (status in ('proposed','approved','declined')),
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete restrict,
  note text not null default '' check (
    char_length(note)<=240 and note !~* '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]'
  ),
  version bigint not null check (version>0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (booking_id,kind)
);
alter table public.booking_handoff_slot_proposals enable row level security;
revoke all on public.booking_handoff_slot_proposals from public,anon;
grant select on public.booking_handoff_slot_proposals to authenticated;
create policy booking_handoff_slot_proposals_participant_read on public.booking_handoff_slot_proposals
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.bookings b where b.id=booking_id and auth.uid() in (b.owner_id,b.renter_id)
  ));

create function public.handoff_plain_text(p_text text,p_min integer,p_max integer)
returns text language plpgsql immutable set search_path='' as $$
declare v text:=coalesce(p_text,'');
begin
  if char_length(v)<p_min or char_length(v)>p_max
    or v ~* '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    raise exception 'Use plain text within the allowed field limits' using errcode='22023';
  end if;
  return btrim(v);
end;
$$;
revoke all on function public.handoff_plain_text(text,integer,integer) from public,anon,authenticated;

create or replace function public.can_access_booking_inspection_photo(p_path text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_booking_id uuid; v_user_id uuid; v_kind text; v_booking public.bookings;
  v_handoff public.booking_handoffs; v_inspection public.booking_inspections;
begin
  if not public.has_active_session()
    or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(pickup|return)/[A-Za-z0-9._-]{1,140}$'
    or split_part(p_path,'/',1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or split_part(p_path,'/',2) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_booking_id:=split_part(p_path,'/',1)::uuid;
  v_user_id:=split_part(p_path,'/',2)::uuid;
  v_kind:=split_part(p_path,'/',3);
  select * into v_booking from public.bookings where id=v_booking_id;
  if not found or auth.uid() not in (v_booking.owner_id,v_booking.renter_id) then return false; end if;
  select * into v_handoff from public.booking_handoffs where booking_id=v_booking_id;
  if not found then return false; end if;
  if p_write then
    if v_user_id<>auth.uid() or auth.uid()<>v_booking.owner_id then return false; end if;
    select * into v_inspection from public.booking_inspections
      where booking_id=v_booking_id and kind=v_kind;
    if found and v_inspection.publication_status<>'draft' then return false; end if;
    return (v_kind='pickup' and v_booking.status='confirmed'
      and v_handoff.status in ('pickup_checkin_started','pickup_inspection'))
      or (v_kind='return' and v_booking.status='return_pending'
      and v_handoff.status='return_inspection');
  end if;
  return exists(select 1 from public.booking_inspection_photos p
    join public.booking_inspections i on i.id=p.inspection_id
    where p.object_path=p_path and i.booking_id=v_booking_id and i.kind=v_kind
      and (v_booking.owner_id=auth.uid() or i.publication_status='published' or exists(
        select 1 from public.booking_inspection_revisions r
        where r.booking_id=i.booking_id and r.kind=i.kind and r.revision=p.revision
      )));
end;
$$;
revoke all on function public.can_access_booking_inspection_photo(text,boolean) from public,anon;
grant execute on function public.can_access_booking_inspection_photo(text,boolean) to authenticated;

create or replace function public.save_booking_inspection_draft(
  p_booking_id uuid,p_kind text,p_expected_version bigint,p_appearance_condition text,
  p_existing_damage text,p_included_accessories text[],p_functional_condition text,p_serial_number text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; h public.booking_handoffs; i public.booking_inspections;
  v_appearance text:=public.handoff_plain_text(p_appearance_condition,0,2000);
  v_damage text:=public.handoff_plain_text(p_existing_damage,0,2000);
  v_functional text:=public.handoff_plain_text(p_functional_condition,0,1000);
  v_serial text:=public.handoff_plain_text(p_serial_number,0,120);
  v_accessories text[]:=coalesce(p_included_accessories,'{}'); v_version bigint;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can document an inspection' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version<>b.workflow_version then
    raise exception 'This handoff changed in another session. Refresh before saving.' using errcode='40001';
  end if;
  select * into h from public.booking_handoffs where booking_id=p_booking_id for update;
  if p_kind is null or p_kind not in ('pickup','return')
    or (p_kind='pickup' and (b.status<>'confirmed' or h.status not in ('pickup_checkin_started','pickup_inspection')))
    or (p_kind='return' and (b.status<>'return_pending' or h.status<>'return_inspection')) then
    raise exception 'This inspection is not open for documentation' using errcode='55000';
  end if;
  if cardinality(v_accessories)>30 or array_ndims(v_accessories)>1
    or exists(select 1 from unnest(v_accessories) item
      where char_length(btrim(item)) not between 1 and 120
        or item ~* '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]') then
    raise exception 'Accessories must be plain text, up to 30 items of 1 to 120 characters' using errcode='22023';
  end if;
  select * into i from public.booking_inspections where booking_id=p_booking_id and kind=p_kind for update;
  if found and i.publication_status<>'draft' then
    raise exception 'Published evidence cannot be edited; request a correction first' using errcode='55000';
  end if;
  update public.bookings set workflow_version=workflow_version+1
    where id=p_booking_id returning workflow_version into v_version;
  if i.id is null then
    insert into public.booking_inspections(booking_id,kind,appearance_condition,existing_damage,
      included_accessories,functional_condition,serial_number,submitted_by,revision,publication_status,
      condition_status,review_reason)
    values(p_booking_id,p_kind,nullif(v_appearance,''),nullif(v_damage,''),v_accessories,
      nullif(v_functional,''),v_serial,auth.uid(),1,'draft','pending',null)
    returning * into i;
  else
    update public.booking_inspections set appearance_condition=nullif(v_appearance,''),
      existing_damage=nullif(v_damage,''),included_accessories=v_accessories,
      functional_condition=nullif(v_functional,''),serial_number=v_serial,
      submitted_by=auth.uid(),submitted_at=clock_timestamp()
    where id=i.id returning * into i;
  end if;
  if h.status in ('pickup_checkin_started','pickup_inspection') then
    update public.booking_handoffs set status='pickup_inspection' where booking_id=p_booking_id;
  end if;
  perform public.record_booking_handoff_event(p_booking_id,p_kind||'_inspection_draft_saved',
    jsonb_build_object('revision',i.revision));
  return to_jsonb(i)||jsonb_build_object('workflow_version',v_version);
end;
$$;
revoke all on function public.save_booking_inspection_draft(uuid,text,bigint,text,text,text[],text,text) from public,anon;
grant execute on function public.save_booking_inspection_draft(uuid,text,bigint,text,text,text[],text,text) to authenticated;

create or replace function public.register_booking_inspection_photo(p_inspection_id uuid,p_object_path text)
returns public.booking_inspection_photos language plpgsql security definer set search_path='' as $$
declare i public.booking_inspections; b public.bookings; p public.booking_inspection_photos;
begin
  perform public.operations_require_session();
  select * into i from public.booking_inspections where id=p_inspection_id for update;
  if not found or i.publication_status<>'draft' then
    raise exception 'Photos can only be attached to a draft inspection' using errcode='55000';
  end if;
  select * into b from public.bookings where id=i.booking_id;
  if b.owner_id<>auth.uid() or split_part(coalesce(p_object_path,''),'/',1)<>i.booking_id::text
    or split_part(p_object_path,'/',2)<>auth.uid()::text or split_part(p_object_path,'/',3)<>i.kind
    or not public.can_access_booking_inspection_photo(p_object_path,true) then
    raise exception 'Not authorized to attach this inspection photo' using errcode='42501';
  end if;
  select * into p from public.booking_inspection_photos
    where inspection_id=i.id and revision=i.revision and object_path=p_object_path;
  if found then
    if p.inspection_id<>i.id or p.revision<>i.revision then
      raise exception 'Photo is already attached to another inspection revision' using errcode='23505';
    end if;
    return p;
  end if;
  if (select count(*) from public.booking_inspection_photos
      where inspection_id=i.id and revision=i.revision)>=12 then
    raise exception 'An inspection can have at most 12 photos' using errcode='22023';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='booking-inspection-evidence' and name=p_object_path) then
    raise exception 'Upload the photo before attaching it to the inspection' using errcode='22023';
  end if;
  insert into public.booking_inspection_photos(inspection_id,uploaded_by,object_path,revision)
    values(i.id,auth.uid(),p_object_path,i.revision) returning * into p;
  perform public.record_booking_handoff_event(i.booking_id,i.kind||'_inspection_photo_added',
    jsonb_build_object('photo_id',p.id,'revision',i.revision));
  return p;
end;
$$;
revoke all on function public.register_booking_inspection_photo(uuid,text) from public,anon;
grant execute on function public.register_booking_inspection_photo(uuid,text) to authenticated;

create or replace function public.publish_booking_inspection(
  p_booking_id uuid,p_kind text,p_expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; h public.booking_handoffs; i public.booking_inspections;
  v_photos jsonb; v_count integer; v_now timestamptz:=clock_timestamp(); v_version bigint;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can publish an inspection' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version<>b.workflow_version then
    raise exception 'This handoff changed in another session. Refresh before publishing.' using errcode='40001';
  end if;
  select * into h from public.booking_handoffs where booking_id=p_booking_id for update;
  select * into i from public.booking_inspections where booking_id=p_booking_id and kind=p_kind for update;
  if not found or p_kind is null or p_kind not in ('pickup','return') or i.publication_status<>'draft'
    or (p_kind='pickup' and (b.status<>'confirmed' or h.status not in ('pickup_checkin_started','pickup_inspection')))
    or (p_kind='return' and (b.status<>'return_pending' or h.status<>'return_inspection')) then
    raise exception 'This draft is not open for publication' using errcode='55000';
  end if;
  if char_length(btrim(coalesce(i.appearance_condition,''))) not between 10 and 2000
    or char_length(btrim(coalesce(i.existing_damage,''))) not between 1 and 2000
    or char_length(btrim(coalesce(i.functional_condition,''))) not between 3 and 1000
    or char_length(i.serial_number)>120 or cardinality(i.included_accessories)>30
    or exists(select 1 from unnest(i.included_accessories) item
      where char_length(btrim(item)) not between 1 and 120) then
    raise exception 'Complete the condition, damage, accessory and functional checklist' using errcode='22023';
  end if;
  select count(*)::integer,coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]'::jsonb)
    into v_count,v_photos from public.booking_inspection_photos p
    where p.inspection_id=i.id and p.revision=i.revision;
  if v_count not between 2 and 12 then
    raise exception 'Publish with two to twelve registered condition photos' using errcode='22023';
  end if;
  update public.booking_inspections set publication_status='published',published_at=v_now,
    owner_acknowledged_at=v_now,renter_acknowledged_at=null,condition_status='pending'
    where id=i.id returning * into i;
  insert into public.booking_inspection_revisions(booking_id,kind,revision,inspection,photos,published_at)
    values(i.booking_id,i.kind,i.revision,to_jsonb(i),v_photos,v_now);
  update public.bookings set workflow_version=workflow_version+1
    where id=p_booking_id returning workflow_version into v_version;
  perform public.record_booking_handoff_event(p_booking_id,p_kind||'_inspection_published',
    jsonb_build_object('revision',i.revision,'photo_count',v_count));
  return jsonb_build_object('inspection',to_jsonb(i),'workflow_version',v_version);
end;
$$;
revoke all on function public.publish_booking_inspection(uuid,text,bigint) from public,anon;
grant execute on function public.publish_booking_inspection(uuid,text,bigint) to authenticated;

create function public.review_booking_inspection(
  p_booking_id uuid,p_kind text,p_revision integer,p_expected_version bigint,p_decision text,p_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; h public.booking_handoffs; i public.booking_inspections;
  v_case jsonb; v_reason text; v_version bigint; v_code public.booking_handoff_otp_challenges;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or auth.uid() not in (b.owner_id,b.renter_id) then
    raise exception 'Booking not found or not authorized' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version<>b.workflow_version then
    raise exception 'This handoff changed in another session. Refresh before responding.' using errcode='40001';
  end if;
  if p_kind is null or p_kind not in ('pickup','return') or p_decision is null
    or p_decision not in ('agree','request_correction','dispute') then
    raise exception 'Choose a valid inspection decision' using errcode='22023';
  end if;
  select * into h from public.booking_handoffs where booking_id=p_booking_id for update;
  select * into i from public.booking_inspections where booking_id=p_booking_id and kind=p_kind for update;
  if not found or p_revision is null or i.revision<>p_revision or i.publication_status<>'published'
    or (p_kind='pickup' and (b.status<>'confirmed' or h.status not in ('pickup_inspection','pickup_otp_pending')))
    or (p_kind='return' and (b.status<>'return_pending' or h.status not in ('return_inspection','return_otp_pending'))) then
    raise exception 'The published inspection changed or is no longer open for review' using errcode='55000';
  end if;
  if p_decision='request_correction' then
    if auth.uid()<>b.renter_id then raise exception 'Only the renter can request an inspection correction' using errcode='42501'; end if;
    if i.condition_status<>'pending' or h.status not in ('pickup_inspection','return_inspection') then
      raise exception 'Corrections must be requested before inspection agreement' using errcode='55000';
    end if;
    v_reason:=public.handoff_plain_text(p_reason,10,1000);
    update public.booking_handoff_otp_challenges set invalidated_at=clock_timestamp(),otp_ciphertext=''::bytea
      where booking_id=p_booking_id and kind=p_kind and used_at is null and invalidated_at is null;
    insert into public.booking_inspection_photos(inspection_id,uploaded_by,object_path,revision)
      select inspection_id,uploaded_by,object_path,i.revision+1
      from public.booking_inspection_photos where inspection_id=i.id and revision=i.revision;
    update public.booking_inspections set revision=revision+1,
      submitted_by=b.owner_id,submitted_at=clock_timestamp(),publication_status='draft',published_at=null,
      owner_acknowledged_at=null,renter_acknowledged_at=null,condition_status='correction_requested',
      review_reason=v_reason
      where id=i.id returning * into i;
    if p_kind='pickup' then update public.booking_handoffs set status='pickup_inspection' where booking_id=p_booking_id;
    else update public.booking_handoffs set status='return_inspection' where booking_id=p_booking_id; end if;
    perform public.record_booking_handoff_event(p_booking_id,p_kind||'_inspection_correction_requested',
      jsonb_build_object('revision',i.revision,'reason',v_reason));
  elsif p_decision='dispute' then
    if p_kind<>'return' or auth.uid()<>b.renter_id then
      raise exception 'Only the renter can dispute a return inspection' using errcode='42501';
    end if;
    if h.status<>'return_inspection' or i.condition_status<>'pending' then
      raise exception 'A return can be disputed only before condition agreement' using errcode='55000';
    end if;
    v_reason:=public.handoff_plain_text(p_reason,10,1000);
    if i.condition_status='disputed' then raise exception 'This return condition is already disputed' using errcode='55000'; end if;
    v_case:=public.operations_create_case('dispute',b.id,b.owner_id,'damaged',
      'Return condition disputed',v_reason,null);
    update public.booking_inspections set condition_status='disputed',review_reason=v_reason
      where id=i.id returning * into i;
    update public.booking_handoff_otp_challenges set invalidated_at=clock_timestamp(),otp_ciphertext=''::bytea
      where booking_id=p_booking_id and kind='return' and used_at is null and invalidated_at is null;
    update public.booking_handoffs set status='return_otp_pending' where booking_id=p_booking_id;
    v_code:=public.issue_booking_handoff_otp(p_booking_id,'return');
    update public.booking_handoff_otp_challenges set revision=i.revision where id=v_code.id;
    perform public.record_booking_handoff_event(p_booking_id,'return_condition_disputed',
      jsonb_build_object('revision',i.revision,'case_id',v_case->>'id'));
  else
    if auth.uid()=b.owner_id then
      update public.booking_inspections set owner_acknowledged_at=coalesce(owner_acknowledged_at,clock_timestamp())
        where id=i.id returning * into i;
    else
      update public.booking_inspections set renter_acknowledged_at=coalesce(renter_acknowledged_at,clock_timestamp())
        where id=i.id returning * into i;
    end if;
    if i.owner_acknowledged_at is not null and i.renter_acknowledged_at is not null then
      update public.booking_inspections set condition_status='agreed' where id=i.id returning * into i;
      if p_kind='pickup' and h.status<>'pickup_otp_pending' then
        update public.booking_handoffs set status='pickup_otp_pending' where booking_id=p_booking_id;
        v_code:=public.issue_booking_handoff_otp(p_booking_id,'pickup');
        update public.booking_handoff_otp_challenges set revision=i.revision where id=v_code.id;
      elsif p_kind='return' and h.status<>'return_otp_pending' then
        update public.booking_handoffs set status='return_otp_pending' where booking_id=p_booking_id;
        v_code:=public.issue_booking_handoff_otp(p_booking_id,'return');
        update public.booking_handoff_otp_challenges set revision=i.revision where id=v_code.id;
      end if;
    end if;
    perform public.record_booking_handoff_event(p_booking_id,p_kind||'_inspection_agreed',
      jsonb_build_object('revision',i.revision));
  end if;
  update public.bookings set workflow_version=workflow_version+1
    where id=p_booking_id returning workflow_version into v_version;
  return jsonb_build_object('inspection',to_jsonb(i),'case',v_case,'workflow_version',v_version,
    'status',(select status from public.booking_handoffs where booking_id=p_booking_id));
end;
$$;
revoke all on function public.review_booking_inspection(uuid,text,integer,bigint,text,text) from public,anon;
grant execute on function public.review_booking_inspection(uuid,text,integer,bigint,text,text) to authenticated;

create or replace function public.save_booking_inspection(
  p_booking_id uuid,p_kind text,p_appearance_condition text,p_existing_damage text,
  p_included_accessories text[],p_functional_condition text,p_serial_number text default ''
) returns public.booking_inspections language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_booking public.bookings;
begin
  perform public.operations_require_session();
  select * into v_booking from public.bookings where id=p_booking_id;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  v_result:=public.save_booking_inspection_draft(p_booking_id,p_kind,v_booking.workflow_version,
    p_appearance_condition,p_existing_damage,p_included_accessories,p_functional_condition,p_serial_number);
  return jsonb_populate_record(null::public.booking_inspections,v_result);
end;
$$;
revoke all on function public.save_booking_inspection(uuid,text,text,text,text[],text,text) from public,anon;
grant execute on function public.save_booking_inspection(uuid,text,text,text,text[],text,text) to authenticated;

create or replace function public.acknowledge_booking_inspection(p_booking_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; i public.booking_inspections;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or auth.uid() not in (b.owner_id,b.renter_id) then
    raise exception 'Booking not found or not authorized' using errcode='42501';
  end if;
  select * into i from public.booking_inspections where booking_id=p_booking_id and kind=p_kind;
  if not found then raise exception 'This inspection is not ready for acknowledgment' using errcode='55000'; end if;
  if i.publication_status='draft' then
    if auth.uid()<>b.owner_id then
      raise exception 'The owner must publish the inspection before the renter can acknowledge it' using errcode='55000';
    end if;
    return public.publish_booking_inspection(p_booking_id,p_kind,b.workflow_version);
  end if;
  return public.review_booking_inspection(p_booking_id,p_kind,i.revision,b.workflow_version,'agree',null);
end;
$$;
revoke all on function public.acknowledge_booking_inspection(uuid,text) from public,anon;
grant execute on function public.acknowledge_booking_inspection(uuid,text) to authenticated;

create or replace function public.propose_booking_handoff_replacement(
  p_booking_id uuid,p_kind text,p_slot_window text,p_hour integer,p_note text,p_expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; l public.listings; v_zone text; v_date date; v_start timestamptz;
  v_end timestamptz; v_version bigint; v_existing public.booking_handoff_slot_proposals;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or auth.uid() not in (b.owner_id,b.renter_id) then
    raise exception 'Booking not found or not authorized' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version<>b.workflow_version then
    raise exception 'This handoff changed in another session. Refresh before proposing.' using errcode='40001';
  end if;
  if p_kind is null or p_kind not in ('pickup','return') then raise exception 'Choose pickup or return scheduling' using errcode='22023'; end if;
  if (p_kind='pickup' and b.status<>'confirmed') or (p_kind='return' and b.status<>'active') then
    raise exception 'Scheduling is not open for this handoff' using errcode='55000';
  end if;
  select * into l from public.listings where id=b.listing_id;
  if p_kind='pickup' then v_date:=b.start_date; else v_date:=b.end_date; end if;
  if p_slot_window is null or p_hour is null then
    raise exception 'Choose an available handoff hour' using errcode='22023';
  end if;
  if p_kind='pickup' and not (p_slot_window=any(l.pickup_windows))
    or p_kind='return' and not (p_slot_window=any(l.return_windows)) then
    raise exception 'This window is not available for this listing' using errcode='22023';
  end if;
  select time_zone into v_zone from public.listing_pickup_locations where listing_id=b.listing_id;
  if v_zone is null then raise exception 'Pickup location timezone is missing' using errcode='55000'; end if;
  select starts_at,ends_at into v_start,v_end from public.handoff_hour_bounds(v_date,p_slot_window,p_hour,v_zone);
  if v_start<=clock_timestamp() then raise exception 'Choose a future handoff hour' using errcode='22023'; end if;
  p_note:=public.handoff_plain_text(p_note,0,240);
  select * into v_existing from public.booking_handoff_slot_proposals
    where booking_id=b.id and kind=p_kind for update;
  if found and v_existing.status='proposed' and v_existing.proposed_by<>auth.uid() then
    raise exception 'Respond to the current proposal before proposing another' using errcode='55000';
  end if;
  update public.bookings set workflow_version=workflow_version+1 where id=b.id returning workflow_version into v_version;
  update public.booking_pickup_slots set status='declined',updated_at=clock_timestamp()
    where booking_id=b.id and kind=p_kind and status='proposed';
  insert into public.booking_handoff_slot_proposals(booking_id,kind,selected_date,slot_window,hour,starts_at,
    ends_at,time_zone,status,proposed_by,approved_by,note,version,updated_at)
  values(b.id,p_kind,v_date,p_slot_window,p_hour,v_start,v_end,v_zone,'proposed',auth.uid(),null,p_note,v_version,clock_timestamp())
  on conflict(booking_id,kind) do update set selected_date=excluded.selected_date,slot_window=excluded.slot_window,
    hour=excluded.hour,starts_at=excluded.starts_at,ends_at=excluded.ends_at,time_zone=excluded.time_zone,
    status='proposed',proposed_by=excluded.proposed_by,approved_by=null,note=excluded.note,
    version=excluded.version,updated_at=excluded.updated_at;
  perform public.record_booking_handoff_event(b.id,p_kind||'_replacement_proposed',
    jsonb_build_object('window',p_slot_window,'hour',p_hour,'selected_date',v_date,'version',v_version));
  return (select to_jsonb(p)||jsonb_build_object('proposed_by_is_owner',p.proposed_by=b.owner_id)
    from public.booking_handoff_slot_proposals p where p.booking_id=b.id and p.kind=p_kind);
end;
$$;
revoke all on function public.propose_booking_handoff_replacement(uuid,text,text,integer,text,bigint) from public,anon;
grant execute on function public.propose_booking_handoff_replacement(uuid,text,text,integer,text,bigint) to authenticated;

create function public.respond_booking_handoff_replacement(
  p_booking_id uuid,p_kind text,p_approve boolean,p_expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; l public.listings; p public.booking_handoff_slot_proposals;
  s public.booking_pickup_slots; v_version bigint; v_actor_is_owner boolean; v_now timestamptz:=clock_timestamp();
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or auth.uid() not in (b.owner_id,b.renter_id) then
    raise exception 'Booking not found or not authorized' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version<>b.workflow_version then
    raise exception 'This handoff changed in another session. Refresh before responding.' using errcode='40001';
  end if;
  if p_kind is null or p_kind not in ('pickup','return') or p_approve is null then
    raise exception 'Choose pickup or return and approve or decline' using errcode='22023';
  end if;
  select * into p from public.booking_handoff_slot_proposals where booking_id=b.id and kind=p_kind for update;
  if not found then
    select * into s from public.booking_pickup_slots where booking_id=b.id and kind=p_kind for update;
    if not found or s.status<>'proposed' or s.starts_at<=v_now
      or s.selected_date<>(case when p_kind='pickup' then b.start_date else b.end_date end)
      or (s.proposed_by=b.owner_id and auth.uid()<>b.renter_id)
      or (s.proposed_by=b.renter_id and auth.uid()<>b.owner_id) then
      raise exception 'This proposal changed or is no longer available' using errcode='55000';
    end if;
    update public.bookings set workflow_version=workflow_version+1 where id=b.id returning workflow_version into v_version;
    update public.booking_pickup_slots set status=case when p_approve then 'approved' else 'declined' end,
      approved_by=case when p_approve then auth.uid() end,updated_at=v_now
      where booking_id=b.id and kind=p_kind returning * into s;
    perform public.record_booking_handoff_event(b.id,p_kind||case when p_approve then '_slot_approved' else '_slot_declined' end,
      jsonb_build_object('window',s.slot_window,'selected_date',s.selected_date,'version',v_version));
    return to_jsonb(s)||jsonb_build_object('version',v_version,'proposed_by_is_owner',s.proposed_by=b.owner_id);
  end if;
  if p.status<>'proposed' or p.version>p_expected_version
    or p.starts_at<=v_now or p.selected_date<>(case when p_kind='pickup' then b.start_date else b.end_date end)
    or (p.proposed_by=b.owner_id and auth.uid()<>b.renter_id)
    or (p.proposed_by=b.renter_id and auth.uid()<>b.owner_id) then
    raise exception 'This proposal changed or is no longer available' using errcode='55000';
  end if;
  select * into l from public.listings where id=b.listing_id;
  if (p_kind='pickup' and not (p.slot_window=any(l.pickup_windows)))
    or (p_kind='return' and not (p.slot_window=any(l.return_windows))) then
    raise exception 'The proposed window is no longer available' using errcode='55000';
  end if;
  update public.bookings set workflow_version=workflow_version+1 where id=b.id returning workflow_version into v_version;
  update public.booking_handoff_slot_proposals set status=case when p_approve then 'approved' else 'declined' end,
    approved_by=case when p_approve then auth.uid() end,version=v_version,updated_at=v_now
    where booking_id=b.id and kind=p_kind returning * into p;
  if p_approve then
    insert into public.booking_pickup_slots(booking_id,kind,selected_date,slot_window,starts_at,ends_at,
      time_zone,status,proposed_by,approved_by,note,updated_at)
    values(b.id,p_kind,p.selected_date,p.slot_window,p.starts_at,p.ends_at,p.time_zone,'approved',
      p.proposed_by,auth.uid(),p.note,v_now)
    on conflict(booking_id,kind) do update set selected_date=excluded.selected_date,slot_window=excluded.slot_window,
      starts_at=excluded.starts_at,ends_at=excluded.ends_at,time_zone=excluded.time_zone,status='approved',
      proposed_by=excluded.proposed_by,approved_by=excluded.approved_by,note=excluded.note,updated_at=excluded.updated_at;
  end if;
  perform public.record_booking_handoff_event(b.id,p_kind||case when p_approve then '_replacement_approved' else '_replacement_declined' end,
    jsonb_build_object('window',p.slot_window,'hour',p.hour,'selected_date',p.selected_date,'version',v_version));
  v_actor_is_owner:=p.proposed_by=b.owner_id;
  return to_jsonb(p)||jsonb_build_object('proposed_by_is_owner',v_actor_is_owner);
end;
$$;
revoke all on function public.respond_booking_handoff_replacement(uuid,text,boolean,bigint) from public,anon;
grant execute on function public.respond_booking_handoff_replacement(uuid,text,boolean,bigint) to authenticated;

create or replace function public.begin_booking_handoff(p_booking_id uuid,p_kind text,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; h public.booking_handoffs; s public.booking_pickup_slots;
  a public.booking_deposit_authorizations; v_now timestamptz:=clock_timestamp(); v_version bigint;
  v_is_owner boolean:=false;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or auth.uid() not in (b.owner_id,b.renter_id) then
    raise exception 'Booking not found or not authorized' using errcode='42501';
  end if;
  v_is_owner:=auth.uid()=b.owner_id;
  if p_expected_version is null or p_expected_version<>b.workflow_version then
    raise exception 'This handoff changed in another session. Refresh before starting.' using errcode='40001';
  end if;
  if p_kind is null or p_kind not in ('pickup','return') then raise exception 'Choose pickup or return' using errcode='22023'; end if;
  select * into h from public.booking_handoffs where booking_id=p_booking_id for update;
  if p_kind='pickup' then
    if not v_is_owner then raise exception 'Only the owner can start pickup inspection' using errcode='42501'; end if;
    if b.status<>'confirmed' or b.confirmation_gate<>'confirmed' then
      raise exception 'A confirmed booking is required before pickup' using errcode='55000';
    end if;
    if (select count(*) from public.payments where booking_id=b.id and status='succeeded'
        and amount=b.total and currency='usd' and stripe_payment_intent_id is not null)<>1
      or (select count(*) from public.payments where booking_id=b.id and status='succeeded')<>1 then
      raise exception 'A verified full rental payment is required before pickup' using errcode='55000';
    end if;
    if h.status in ('pickup_checkin_started','pickup_inspection','pickup_otp_pending') then
      return to_jsonb(h)||jsonb_build_object('workflow_version',b.workflow_version);
    end if;
    select * into s from public.booking_pickup_slots where booking_id=b.id and kind='pickup' for update;
    if not found or s.status<>'approved' or s.selected_date<>b.start_date
      or v_now<s.starts_at or v_now>=s.ends_at then
      raise exception 'Pickup can start only during the approved pickup window' using errcode='55000';
    end if;
    if b.deposit>0 and b.deposit_collection_model='authorization' then
      select * into a from public.booking_deposit_authorizations where booking_id=b.id and not is_claim_authorization
        order by attempt desc limit 1 for update;
      if not found or a.status<>'authorized' or a.authorized_amount<b.deposit or a.capture_before<=s.ends_at then
        raise exception 'The security deposit hold must cover the approved pickup window' using errcode='55000';
      end if;
    end if;
    if h.booking_id is not null and h.status='pickup_checkin_started' then
      return to_jsonb(h)||jsonb_build_object('workflow_version',b.workflow_version);
    end if;
    if h.booking_id is not null and h.status not in ('pickup_ready','pickup_checkin_started') then
      if h.status in ('pickup_inspection','pickup_otp_pending','rental_active') then
        return to_jsonb(h)||jsonb_build_object('workflow_version',b.workflow_version);
      end if;
      raise exception 'Pickup cannot be started from this handoff state' using errcode='55000';
    end if;
    if h.booking_id is null then
      insert into public.booking_handoffs(booking_id,status)
        values(p_booking_id,'pickup_checkin_started') returning * into h;
    elsif h.status='pickup_ready' then
      update public.booking_handoffs set status='pickup_checkin_started'
        where booking_id=p_booking_id returning * into h;
    end if;
    perform public.record_booking_handoff_event(p_booking_id,'pickup_handoff_started',
      jsonb_build_object('arrival_reported',h.pickup_arrived_at is not null));
  else
    if b.status='return_pending' then
      if h.status='return_initiated' and v_is_owner then
        update public.booking_handoffs set status='return_inspection'
          where booking_id=p_booking_id returning * into h;
      elsif h.status in ('return_initiated','return_inspection','return_otp_pending') then
        return to_jsonb(h)||jsonb_build_object('workflow_version',b.workflow_version);
      else
        raise exception 'A return handoff is already in progress' using errcode='55000';
      end if;
    else
      if b.status<>'active' then raise exception 'Booking must be active to start a return' using errcode='55000'; end if;
      if b.return_scheduling_required then
        select * into s from public.booking_pickup_slots where booking_id=b.id and kind='return' for update;
        if not found or s.status<>'approved' or s.selected_date<>b.end_date
          or v_now<s.starts_at or v_now>=s.ends_at then
          raise exception 'Return can start only during the approved return window' using errcode='55000';
        end if;
      end if;
      if h.booking_id is null then
        insert into public.booking_handoffs(booking_id,status,return_initiated_at)
          values(p_booking_id,case when v_is_owner then 'return_inspection' else 'return_initiated' end,v_now)
          returning * into h;
      elsif h.status='rental_active' then
        update public.booking_handoffs set status=case when v_is_owner then 'return_inspection' else 'return_initiated' end,
          return_initiated_at=v_now where booking_id=p_booking_id returning * into h;
      else
        raise exception 'A return handoff is already in progress' using errcode='55000';
      end if;
      update public.bookings set status='return_pending' where id=p_booking_id returning * into b;
      perform public.record_booking_handoff_event(p_booking_id,'return_initiated',
        jsonb_build_object('initiated_by_owner',v_is_owner,'scheduled',b.return_scheduling_required));
    end if;
  end if;
  update public.bookings set workflow_version=workflow_version+1
    where id=p_booking_id returning workflow_version into v_version;
  if p_kind='return' and v_is_owner and h.status='return_inspection' and b.status='return_pending'
    and b.workflow_version=v_version-1 then
    perform public.record_booking_handoff_event(p_booking_id,'return_inspection_started');
  end if;
  return to_jsonb(h)||jsonb_build_object('workflow_version',v_version);
end;
$$;
revoke all on function public.begin_booking_handoff(uuid,text,bigint) from public,anon;
grant execute on function public.begin_booking_handoff(uuid,text,bigint) to authenticated;

create or replace function public.start_booking_handoff(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_version bigint;
begin
  select workflow_version into v_version from public.bookings where id=p_booking_id;
  return public.begin_booking_handoff(p_booking_id,'pickup',v_version);
end;
$$;
revoke all on function public.start_booking_handoff(uuid) from public,anon;
grant execute on function public.start_booking_handoff(uuid) to authenticated;

create or replace function public.start_booking_return(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path='' as $$
declare v_version bigint; b public.bookings;
begin
  select workflow_version into v_version from public.bookings where id=p_booking_id;
  perform public.begin_booking_handoff(p_booking_id,'return',v_version);
  select * into b from public.bookings where id=p_booking_id;
  return b;
end;
$$;
revoke all on function public.start_booking_return(uuid) from public,anon;
grant execute on function public.start_booking_return(uuid) to authenticated;

create or replace function public.begin_booking_return_inspection(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_version bigint;
begin
  select workflow_version into v_version from public.bookings where id=p_booking_id;
  return public.begin_booking_handoff(p_booking_id,'return',v_version);
end;
$$;
revoke all on function public.begin_booking_return_inspection(uuid) from public,anon;
grant execute on function public.begin_booking_return_inspection(uuid) to authenticated;

create or replace function public.report_booking_return_receipt(
  p_booking_id uuid,p_expected_version bigint,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; h public.booking_handoffs; v_reason text; v_case jsonb; v_version bigint;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can report physical receipt for support review' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version<>b.workflow_version then
    raise exception 'This handoff changed in another session. Refresh before reporting.' using errcode='40001';
  end if;
  select * into h from public.booking_handoffs where booking_id=p_booking_id for update;
  if b.status not in ('active','return_pending') or h.status in ('returned','cancelled') or h.actual_return_at is not null then
    raise exception 'This return is not open for a receipt report' using errcode='55000';
  end if;
  v_reason:=public.handoff_plain_text(p_reason,10,1000);
  v_case:=public.operations_create_case('support',b.id,b.renter_id,'pickup_return',
    'Owner reports physical return receipt',v_reason,null);
  update public.bookings set workflow_version=workflow_version+1 where id=b.id returning workflow_version into v_version;
  perform public.record_booking_handoff_event(p_booking_id,'return_receipt_reported',
    jsonb_build_object('case_id',v_case->>'id'));
  return jsonb_build_object('case',v_case,'workflow_version',v_version);
end;
$$;
revoke all on function public.report_booking_return_receipt(uuid,bigint,text) from public,anon;
grant execute on function public.report_booking_return_receipt(uuid,bigint,text) to authenticated;

create function public.booking_handoff_inspection_detail(p_booking_id uuid,p_kind text,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.bookings; i public.booking_inspections; v_inspection jsonb; v_photos jsonb;
  v_history jsonb; v_reason text;
begin
  select * into b from public.bookings where id=p_booking_id;
  select * into i from public.booking_inspections where booking_id=p_booking_id and kind=p_kind;
  select coalesce(jsonb_agg(jsonb_build_object('inspection',r.inspection,'photos',r.photos)
    order by r.revision),'[]'::jsonb) into v_history
  from public.booking_inspection_revisions r where r.booking_id=p_booking_id and r.kind=p_kind;
  if not found then v_history:='[]'::jsonb; end if;
  if i.id is null then
    return jsonb_build_object('inspection',null,'photos','[]'::jsonb,'history',v_history,'review_reason',null);
  end if;
  if i.publication_status='draft' and p_user_id=b.renter_id then
    select r.inspection,r.photos into v_inspection,v_photos from public.booking_inspection_revisions r
      where r.booking_id=p_booking_id and r.kind=p_kind order by r.revision desc limit 1;
    v_reason:=i.review_reason;
  else
    v_inspection:=to_jsonb(i);
    select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]'::jsonb) into v_photos
      from public.booking_inspection_photos p where p.inspection_id=i.id and p.revision=i.revision;
    v_reason:=i.review_reason;
    if i.publication_status='published' and not exists(
      select 1 from public.booking_inspection_revisions r
      where r.booking_id=i.booking_id and r.kind=i.kind and r.revision=i.revision) then
      v_history:=v_history||jsonb_build_array(jsonb_build_object('inspection',v_inspection,'photos',v_photos));
    end if;
  end if;
  return jsonb_build_object('inspection',v_inspection,'photos',coalesce(v_photos,'[]'::jsonb),
    'history',v_history,'review_reason',v_reason);
end;
$$;
revoke all on function public.booking_handoff_inspection_detail(uuid,text,uuid) from public,anon,authenticated;

create or replace function public.get_booking_handoff(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.bookings; h public.booking_handoffs; v_pickup jsonb; v_return jsonb;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id and auth.uid() in (owner_id,renter_id);
  if not found then raise exception 'Booking not found or not authorized' using errcode='42501'; end if;
  select * into h from public.booking_handoffs where booking_id=p_booking_id;
  v_pickup:=public.booking_handoff_inspection_detail(p_booking_id,'pickup',auth.uid());
  v_return:=public.booking_handoff_inspection_detail(p_booking_id,'return',auth.uid());
  return jsonb_build_object('booking_id',p_booking_id,'booking_status',b.status,'start_date',b.start_date,
    'end_date',b.end_date,'is_owner',b.owner_id=auth.uid(),'status',h.status,
    'pickup_arrived_at',h.pickup_arrived_at,'actual_pickup_at',h.actual_pickup_at,
    'return_initiated_at',h.return_initiated_at,'actual_return_at',h.actual_return_at,
    'pickup',v_pickup,'return',v_return,
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id)
      from public.booking_handoff_events e where e.booking_id=p_booking_id),'[]'::jsonb),
    'cases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'category',c.category,
      'subject',c.subject,'status',c.status,'created_at',c.created_at) order by c.created_at desc)
      from public.operations_cases c where c.booking_id=p_booking_id
        and auth.uid() in (c.participant_id,b.owner_id,b.renter_id)),'[]'::jsonb));
end;
$$;
revoke all on function public.get_booking_handoff(uuid) from public,anon;
grant execute on function public.get_booking_handoff(uuid) to authenticated;

create or replace function public.get_booking_precheckin(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.bookings; l public.listings; pickup_slot public.booking_pickup_slots;
  return_slot public.booking_pickup_slots; a public.booking_deposit_authorizations;
  v_now timestamptz:=clock_timestamp(); v_hold_ready boolean; v_pickup_proposal jsonb; v_return_proposal jsonb;
  v_started boolean;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id and auth.uid() in (owner_id,renter_id);
  if not found then raise exception 'Booking not found' using errcode='42501'; end if;
  select * into l from public.listings where id=b.listing_id;
  v_started:=b.status='confirmed' and exists(select 1 from public.booking_handoffs h
    where h.booking_id=b.id and h.status in ('pickup_checkin_started','pickup_inspection','pickup_otp_pending'));
  select * into pickup_slot from public.booking_pickup_slots where booking_id=b.id and kind='pickup';
  select * into return_slot from public.booking_pickup_slots where booking_id=b.id and kind='return';
  select * into a from public.booking_deposit_authorizations where booking_id=b.id and not is_claim_authorization
    order by attempt desc limit 1;
  v_hold_ready:=b.deposit<=0 or b.deposit_collection_model<>'authorization'
    or (a.status='authorized' and a.authorized_amount>=b.deposit
      and a.capture_before>greatest(v_now,coalesce(pickup_slot.ends_at,v_now)));
  select coalesce((select to_jsonb(p)||jsonb_build_object('proposed_by_is_owner',p.proposed_by=b.owner_id)
      from public.booking_handoff_slot_proposals p where p.booking_id=b.id and p.kind='pickup' and p.status='proposed'),
    (select to_jsonb(s)||jsonb_build_object('hour',extract(hour from s.starts_at at time zone s.time_zone)::integer,
      'version',b.workflow_version,'proposed_by_is_owner',s.proposed_by=b.owner_id)
      from public.booking_pickup_slots s where s.booking_id=b.id and s.kind='pickup' and s.status='proposed'))
    into v_pickup_proposal;
  select coalesce((select to_jsonb(p)||jsonb_build_object('proposed_by_is_owner',p.proposed_by=b.owner_id)
      from public.booking_handoff_slot_proposals p where p.booking_id=b.id and p.kind='return' and p.status='proposed'),
    (select to_jsonb(s)||jsonb_build_object('hour',extract(hour from s.starts_at at time zone s.time_zone)::integer,
      'version',b.workflow_version,'proposed_by_is_owner',s.proposed_by=b.owner_id)
      from public.booking_pickup_slots s where s.booking_id=b.id and s.kind='return' and s.status='proposed'))
    into v_return_proposal;
  return jsonb_build_object('payment_first',b.payment_first,
    'slot',case when pickup_slot.booking_id is not null then to_jsonb(pickup_slot) end,
    'pickup_slot',case when pickup_slot.booking_id is not null then to_jsonb(pickup_slot) end,
    'return_slot',case when return_slot.booking_id is not null then to_jsonb(return_slot) end,
    'pickup_proposal',v_pickup_proposal,'return_proposal',v_return_proposal,
    'workflow_version',b.workflow_version,
    'pickup_windows',coalesce(l.pickup_windows,array['morning','afternoon','evening']::text[]),
    'return_windows',coalesce(l.return_windows,array['morning','afternoon','evening']::text[]),
    'return_rules',coalesce(l.return_rules,'{}'::text[]),'return_note',coalesce(l.return_note,''),
    'time_zone',(select time_zone from public.listing_pickup_locations where listing_id=b.listing_id),
    'server_now',v_now,
    'can_authorize',v_started or b.status in ('active','return_pending','completed')
      or coalesce(b.status='confirmed' and pickup_slot.status='approved'
        and v_now>=pickup_slot.starts_at-interval '24 hours' and v_now<pickup_slot.ends_at,false),
    'handoff_ready',coalesce(b.status='confirmed' and v_hold_ready and (v_started
      or (pickup_slot.status='approved' and v_now>=pickup_slot.starts_at and v_now<pickup_slot.ends_at)),false),
    'return_handoff_ready',not b.return_scheduling_required or coalesce(return_slot.status='approved'
      and v_now>=return_slot.starts_at and v_now<return_slot.ends_at,false),
    'deposit_ready',coalesce(v_hold_ready,false),'delivery_mode',b.delivery_mode,
    'consented',b.deposit_hold_consent_at is not null);
end;
$$;
revoke all on function public.get_booking_precheckin(uuid) from public,anon;
grant execute on function public.get_booking_precheckin(uuid) to authenticated;

create function public.booking_handoff_workflow_json(p_booking_id uuid,p_kind text,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.bookings; h public.booking_handoffs; i public.booking_inspections;
  s public.booking_pickup_slots; v_payment boolean; v_deposit boolean; v_schedule boolean;
  v_blockers text[]:='{}'; v_allowed text[]:='{}'; v_stage text; v_actor text; v_action text;
  v_condition text:='pending'; v_owner boolean; v_ready boolean;
  v_closed boolean:=false; v_physical boolean:=false;
begin
  select * into b from public.bookings where id=p_booking_id;
  select * into h from public.booking_handoffs where booking_id=p_booking_id;
  if p_kind='pickup' then select * into s from public.booking_pickup_slots where booking_id=p_booking_id and kind='pickup';
  else select * into s from public.booking_pickup_slots where booking_id=p_booking_id and kind='return'; end if;
  select * into i from public.booking_inspections where booking_id=p_booking_id and kind=p_kind;
  v_owner:=p_user_id=b.owner_id;
  v_payment:=exists(select 1 from public.payments p where p.booking_id=b.id and p.status='succeeded'
    and p.amount=b.total and p.currency='usd' and p.stripe_payment_intent_id is not null)
    and (select count(*) from public.payments p where p.booking_id=b.id and p.status='succeeded')=1;
  v_deposit:=b.deposit<=0 or b.deposit_collection_model<>'authorization' or exists(
    select 1 from public.booking_deposit_authorizations a where a.booking_id=b.id and not a.is_claim_authorization
      and a.status='authorized' and a.authorized_amount>=b.deposit
      and a.capture_before>greatest(clock_timestamp(),
        case when p_kind='pickup' and s.booking_id is not null then s.ends_at else clock_timestamp() end));
  v_schedule:=coalesce(case when p_kind='pickup'
      and h.status in ('pickup_checkin_started','pickup_inspection','pickup_otp_pending') then true
    when p_kind='pickup' then s.status='approved' and s.selected_date=b.start_date
      and clock_timestamp()>=s.starts_at and clock_timestamp()<s.ends_at
    when p_kind='return' and b.status='return_pending' and h.status='return_initiated' then true
    when not b.return_scheduling_required then true
    else s.status='approved' and s.selected_date=b.end_date and clock_timestamp()>=s.starts_at
      and clock_timestamp()<s.ends_at end,false);
  if not v_payment then v_blockers:=array_append(v_blockers,'payment_required'); end if;
  if p_kind='pickup' and not v_schedule or p_kind='return' and b.return_scheduling_required and not v_schedule then
    v_blockers:=array_append(v_blockers,'approved_window_required');
  end if;
  if p_kind='pickup' and not v_deposit then v_blockers:=array_append(v_blockers,'deposit_hold_required'); end if;
  if i.id is not null then v_condition:=i.condition_status; end if;
  v_physical:=coalesce(p_kind='return' and h.actual_return_at is not null,false);
  select exists(
    select 1 from public.rental_settlements settlement
    where settlement.booking_id=b.id
      and b.status='completed' and b.return_confirmed_at is not null
      and settlement.refund_status in ('succeeded','not_required')
      and settlement.transfer_status='succeeded'
      and not exists(select 1 from public.operations_cases c
        where c.booking_id=b.id and c.kind='dispute' and c.status<>'closed')
      and not exists(select 1 from public.booking_deposit_claims claim
        where claim.booking_id=b.id and claim.status not in ('rejected','captured'))
      and not exists(select 1 from public.booking_deposit_authorizations attempt
        where attempt.booking_id=b.id
          and (attempt.status in ('setup_required','scheduled','authorizing','requires_action','authorized','releasing','capturing')
            or (attempt.status='failed' and
              (attempt.stripe_payment_intent_id is not null or attempt.authorization_checkout_session_id is not null))))
      and (b.deposit<=0 or b.deposit_collection_model<>'authorization' or exists(
        select 1 from public.booking_deposit_authorizations hold
        where hold.booking_id=b.id and not hold.is_claim_authorization
          and hold.status in ('released','captured','superseded')
          and hold.attempt=(select max(latest.attempt) from public.booking_deposit_authorizations latest
            where latest.booking_id=b.id and not latest.is_claim_authorization)
      ))
  ) into v_closed;
  v_ready:=v_payment and v_schedule and (p_kind='return' or v_deposit);
  if h.status='cancelled' or b.status='cancelled' then
    v_stage:='cancelled';
  elsif p_kind='pickup' and (h.status='rental_active' or b.status in ('active','return_pending','completed')) then
    v_stage:='active';
  elsif p_kind='return' and (h.status='returned' or b.status='completed') then
    v_stage:='returned';
  elsif h.status in ('pickup_otp_pending','return_otp_pending') then
    v_stage:='verify';
  elsif p_kind='pickup' and h.status in ('pickup_checkin_started','pickup_inspection') then
    v_stage:=case when i.id is null or i.publication_status='draft' then 'inspection' else 'review' end;
  elsif p_kind='return' and h.status='return_initiated' then
    v_stage:='arrange';
  elsif p_kind='return' and h.status='return_inspection' then
    v_stage:=case when i.id is null or i.publication_status='draft' then 'inspection' else 'review' end;
  else
    v_stage:='arrange';
  end if;
  if v_stage='arrange' then
    if p_kind='pickup' then
      if v_owner and v_ready then v_allowed:=array_append(v_allowed,'start_pickup'); end if;
      if not v_deposit and v_payment and v_schedule then
        v_actor:='renter'; v_action:='renew_deposit';
      elsif not v_payment then v_actor:='renter';
      elsif not v_schedule then v_actor:='owner';
      elsif v_owner then v_actor:='owner'; v_action:='start_pickup';
      end if;
    else
      if b.status='return_pending' and h.status='return_initiated' and v_owner then
        v_allowed:=array_append(v_allowed,'start_return'); v_action:='start_return'; v_actor:='owner';
      elsif v_ready and p_user_id in (b.owner_id,b.renter_id) then
        v_allowed:=array_append(v_allowed,'start_return'); v_action:='start_return';
        v_actor:=case when v_owner then 'owner' else 'renter' end;
      elsif not v_schedule then v_actor:='owner';
      else v_actor:='renter';
      end if;
    end if;
  elsif v_stage='inspection' then
    v_actor:='owner';
    if v_owner then
      v_allowed:=array_append(v_allowed,'save_draft');
      if i.id is not null and i.publication_status='draft' then
        v_allowed:=array_append(v_allowed,'publish_inspection');
      end if;
    end if;
    if p_kind='pickup' and not v_deposit then
      v_actor:='renter'; v_action:='renew_deposit';
    end if;
    if p_kind='return' and v_owner then v_allowed:=array_append(v_allowed,'report_receipt'); end if;
  elsif v_stage='review' then
    if v_condition='disputed' then v_actor:='support';
    elsif not v_owner and i.renter_acknowledged_at is null then
      v_actor:='renter'; v_allowed:=array['agree_inspection','request_correction'];
      if p_kind='return' then v_allowed:=array_append(v_allowed,'dispute_condition'); end if;
    elsif v_owner and i.owner_acknowledged_at is null then
      v_actor:='owner'; v_allowed:=array['agree_inspection'];
    end if;
    if p_kind='return' and v_owner then v_allowed:=array_append(v_allowed,'report_receipt'); end if;
  elsif v_stage='verify' then
    v_actor:='owner'; if v_owner then v_allowed:=array_append(v_allowed,'verify_code');
    else v_actor:='renter'; v_allowed:=array_append(v_allowed,'view_code'); end if;
    if p_kind='return' and v_owner then v_allowed:=array_append(v_allowed,'report_receipt'); end if;
  elsif v_stage='returned' then
    if v_condition='disputed' and exists(select 1 from public.operations_cases c
      where c.booking_id=b.id and c.kind='dispute' and c.status<>'closed') then v_actor:='support'; end if;
  elsif v_stage='active' and p_kind='return' then
    v_stage:='arrange';
  end if;
  return jsonb_build_object('version',b.workflow_version,'kind',p_kind,'stage',v_stage,
    'next_actor',v_actor,'action',v_action,'allowed_actions',to_jsonb(v_allowed),'blockers',to_jsonb(v_blockers),
    'payment_ready',v_payment,'deposit_ready',v_deposit,'scheduling_ready',v_schedule,
    'condition_status',v_condition,'physical_return_verified',v_physical,'financially_closed',v_closed);
end;
$$;
revoke all on function public.booking_handoff_workflow_json(uuid,text,uuid) from public,anon,authenticated;

create function public.get_booking_handoff_workflow(p_booking_id uuid,p_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_base jsonb; v_workflow jsonb;
begin
  if p_kind is null or p_kind not in ('pickup','return') then raise exception 'Choose pickup or return' using errcode='22023'; end if;
  v_base:=public.get_booking_handoff(p_booking_id);
  v_workflow:=public.booking_handoff_workflow_json(p_booking_id,p_kind,auth.uid());
  return v_base||jsonb_build_object('workflow',v_workflow);
end;
$$;
revoke all on function public.get_booking_handoff_workflow(uuid,text) from public,anon;
grant execute on function public.get_booking_handoff_workflow(uuid,text) to authenticated;

alter function public.get_booking_handoff_otp(uuid,text) rename to get_booking_handoff_otp_legacy;
revoke all on function public.get_booking_handoff_otp_legacy(uuid,text) from public,anon,authenticated;
create function public.get_booking_handoff_otp(p_booking_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.booking_inspections; c public.booking_handoff_otp_challenges;
begin
  perform public.operations_require_session();
  select * into i from public.booking_inspections where booking_id=p_booking_id and kind=p_kind;
  select * into c from public.booking_handoff_otp_challenges where booking_id=p_booking_id and kind=p_kind
    order by generation desc limit 1;
  if i.id is null or c.id is null or i.publication_status<>'published' or c.revision<>i.revision then
    raise exception 'The verification code is no longer bound to the current inspection' using errcode='55000';
  end if;
  return public.get_booking_handoff_otp_legacy(p_booking_id,p_kind);
end;
$$;
revoke all on function public.get_booking_handoff_otp(uuid,text) from public,anon;
grant execute on function public.get_booking_handoff_otp(uuid,text) to authenticated;

alter function public.regenerate_booking_handoff_otp(uuid,text) rename to regenerate_booking_handoff_otp_legacy;
revoke all on function public.regenerate_booking_handoff_otp_legacy(uuid,text) from public,anon,authenticated;
create function public.regenerate_booking_handoff_otp(p_booking_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; i public.booking_inspections; v_result jsonb; v_version bigint;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  select * into i from public.booking_inspections where booking_id=p_booking_id and kind=p_kind;
  if i.id is null or i.publication_status<>'published' then
    raise exception 'A published inspection is required for verification' using errcode='55000';
  end if;
  v_result:=public.regenerate_booking_handoff_otp_legacy(p_booking_id,p_kind);
  update public.booking_handoff_otp_challenges set revision=i.revision
    where booking_id=p_booking_id and kind=p_kind and generation=(v_result->>'generation')::integer;
  update public.bookings set workflow_version=workflow_version+1
    where id=p_booking_id returning workflow_version into v_version;
  return v_result||jsonb_build_object('workflow_version',v_version);
end;
$$;
revoke all on function public.regenerate_booking_handoff_otp(uuid,text) from public,anon;
grant execute on function public.regenerate_booking_handoff_otp(uuid,text) to authenticated;

alter function public.verify_booking_handoff_otp(uuid,text,text) rename to verify_booking_handoff_otp_legacy;
revoke all on function public.verify_booking_handoff_otp_legacy(uuid,text,text) from public,anon,authenticated;
create function public.verify_booking_handoff_otp(p_booking_id uuid,p_kind text,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; h public.booking_handoffs; i public.booking_inspections; v_payment public.payments;
  c public.booking_handoff_otp_challenges; v_pepper text; v_hash bytea; v_result jsonb;
  v_now timestamptz:=clock_timestamp(); v_error text;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.owner_id is distinct from auth.uid() then
    raise exception 'Only the booking owner can verify a code' using errcode='42501';
  end if;
  select * into h from public.booking_handoffs where booking_id=p_booking_id for update;
  select * into i from public.booking_inspections where booking_id=p_booking_id and kind=p_kind;
  select * into c from public.booking_handoff_otp_challenges where booking_id=p_booking_id and kind=p_kind
    order by generation desc limit 1 for update;
  if p_kind is null or p_kind not in ('pickup','return') or i.id is null or c.id is null or i.publication_status<>'published'
    or c.revision<>i.revision then
    return jsonb_build_object('verified',false,'error','The code is not valid for the current inspection.');
  end if;
  if p_kind='return' and i.condition_status='disputed'
    and b.status='return_pending' and h.status='return_otp_pending' then
    if c.invalidated_at is not null then return jsonb_build_object('verified',false,'error','Request a new verification code.'); end if;
    select decrypted_secret into strict v_pepper from vault.decrypted_secrets where name='booking_handoff_otp_pepper';
    v_hash:=extensions.hmac(convert_to(p_booking_id::text||':'||p_kind||':'||c.generation::text||':'||coalesce(p_code,''),'UTF8'),
      convert_to(v_pepper,'UTF8'),'sha256');
    if c.used_at is not null then
      return jsonb_build_object('verified',c.used_by=auth.uid() and c.otp_hash=v_hash,
        'status',b.status,'idempotent',true);
    end if;
    if c.expires_at<=v_now or c.attempts>=c.max_attempts then
      return jsonb_build_object('verified',false,'error','This code expired or has too many incorrect attempts.',
        'attempts_remaining',0);
    end if;
    if p_code is null or p_code !~ '^[0-9]{6}$' or c.otp_hash<>v_hash then
      update public.booking_handoff_otp_challenges set attempts=attempts+1 where id=c.id returning * into c;
      v_error:=case when p_code is null or p_code !~ '^[0-9]{6}$'
        then 'Enter the six-digit code.' else 'That code is not correct.' end;
      perform public.record_booking_handoff_event(p_booking_id,'return_otp_failed',
        jsonb_build_object('attempts',c.attempts,'attempts_remaining',greatest(c.max_attempts-c.attempts,0)));
      return jsonb_build_object('verified',false,'error',v_error,
        'attempts_remaining',greatest(c.max_attempts-c.attempts,0));
    end if;
    select * into v_payment from public.payments where booking_id=p_booking_id and status='succeeded';
    if not found or v_payment.amount<>b.total or v_payment.currency<>'usd'
      or v_payment.stripe_payment_intent_id is null
      or (select count(*) from public.payments where booking_id=p_booking_id and status='succeeded')<>1 then
      raise exception 'A single verified full payment is required before return receipt verification' using errcode='23514';
    end if;
    update public.bookings set status='completed',return_confirmed_at=v_now,
      workflow_version=workflow_version+1 where id=p_booking_id returning * into b;
    update public.booking_handoffs set status='returned',actual_return_at=v_now where booking_id=p_booking_id;
    insert into public.rental_settlements(booking_id,payment_id,deposit_amount,owner_amount,refund_status)
      values(p_booking_id,v_payment.id,b.deposit,b.subtotal+coalesce(b.delivery_fee_amount,0),
        case when b.deposit_collection_model='authorization' or b.deposit=0 then 'not_required' else 'pending' end)
      on conflict(booking_id) do nothing;
    update public.booking_handoff_otp_challenges set used_at=v_now,used_by=auth.uid(),otp_ciphertext=''::bytea
      where id=c.id;
    perform public.record_booking_handoff_event(p_booking_id,'return_receipt_verified',
      jsonb_build_object('inspection_id',i.id,'revision',i.revision,'condition_disputed',true,'verified_at',v_now));
    return jsonb_build_object('verified',true,'status','completed','verified_at',v_now,'condition_disputed',true);
  end if;
  v_result:=public.verify_booking_handoff_otp_legacy(p_booking_id,p_kind,p_code);
  if v_result->>'verified'='true' and coalesce(v_result->>'idempotent','false')<>'true' then
    update public.bookings set workflow_version=workflow_version+1 where id=p_booking_id;
  end if;
  return v_result;
end;
$$;
revoke all on function public.verify_booking_handoff_otp(uuid,text,text) from public,anon;
grant execute on function public.verify_booking_handoff_otp(uuid,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
