create or replace function public.get_case_detail(p_case_id uuid)
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
    'assigned_name',case when v_staff then (
      select nullif(btrim(p.full_name), '') from public.profiles p where p.id=v_case.assigned_to
    ) else null end,
    'deadline_policy_unresolved',v_case.kind='dispute',
    'booking',(select jsonb_build_object(
      'id',b.id,'reference',b.booking_reference,'status',b.status,'start_date',b.start_date,'end_date',b.end_date,
      'created_at',b.created_at,'updated_at',b.updated_at
    ) from public.bookings b where b.id=v_case.booking_id),
    'replies',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from public.operations_case_replies r
      where r.case_id=p_case_id and (v_staff or not r.is_private)),'[]'),
    'events',case when v_staff then coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id)
      from public.operations_case_events e where e.case_id=p_case_id),'[]') else '[]'::jsonb end,
    'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id)
      from public.operations_case_evidence e where e.case_id=p_case_id),'[]'));
end;
$$;
