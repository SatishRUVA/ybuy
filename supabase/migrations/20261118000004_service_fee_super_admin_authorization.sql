-- Reapply the write guard for databases that already installed the fee RPC.
create or replace function public.admin_schedule_service_fee_configuration(
  p_total_fee_percent numeric,
  p_renter_share_percent integer,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_previous public.service_fee_configurations;
  v_next public.service_fee_configurations;
  v_created public.service_fee_configurations;
  v_continuation public.service_fee_configurations;
begin
  perform public.admin_require('config.manage');
  if not exists(select 1 from public.admin_users where user_id=auth.uid() and active and role='super_admin') then
    raise exception 'Only a Super Admin can change service fee configurations' using errcode='42501';
  end if;
  v_reason:=public.admin_clean_reason(p_reason);
  if p_total_fee_percent is null or p_total_fee_percent::text in ('NaN','Infinity','-Infinity')
    or p_total_fee_percent<0 or p_total_fee_percent>30
    or p_renter_share_percent is null or p_renter_share_percent not between 0 and 100
    or p_effective_from is null or p_effective_from<transaction_timestamp()
    or (p_effective_to is not null and p_effective_to<=p_effective_from) then
    raise exception 'Enter a total fee from 0 to 30 percent, an integer renter share from 0 to 100 percent, and a valid non-retroactive effective period'
      using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('service_fee_configurations',0));
  if exists(select 1 from public.service_fee_configurations c
    where tstzrange(c.effective_from,c.effective_to,'[)') && tstzrange(p_effective_from,p_effective_to,'[)')
      and not (c.effective_from<p_effective_from and c.effective_to is null)) then
    raise exception 'The requested service fee period overlaps an existing configuration' using errcode='23P01';
  end if;

  select * into v_previous from public.service_fee_configurations
    where effective_from<=p_effective_from and (effective_to is null or effective_to>p_effective_from)
    order by effective_from desc limit 1 for update;
  if found then
    update public.service_fee_configurations set effective_to=p_effective_from,
      updated_by=auth.uid(),updated_reason=v_reason
      where id=v_previous.id and effective_from<p_effective_from;
    if not found then
      raise exception 'A service fee configuration already starts at that time' using errcode='23P01';
    end if;
    perform public.admin_write_audit('service_fee.close_period','service_fee_configuration',v_previous.id::text,
      jsonb_build_object('effective_to',v_previous.effective_to),
      jsonb_build_object('effective_to',p_effective_from),v_reason);
  else
    raise exception 'No prior service fee configuration is available for this period' using errcode='55000';
  end if;

  insert into public.service_fee_configurations(total_fee_pct,renter_share_percent,effective_from,effective_to,created_by,reason)
    values(p_total_fee_percent/100,p_renter_share_percent,p_effective_from,p_effective_to,auth.uid(),v_reason)
    returning * into v_created;
  perform public.admin_write_audit('service_fee.schedule','service_fee_configuration',v_created.id::text,null,to_jsonb(v_created),v_reason);

  if p_effective_to is not null and not exists(
    select 1 from public.service_fee_configurations where effective_from=p_effective_to
  ) then
    select * into v_next from public.service_fee_configurations where effective_from>p_effective_to
      order by effective_from limit 1;
    insert into public.service_fee_configurations(
      total_fee_pct,renter_share_percent,effective_from,effective_to,created_by,reason
    ) values(v_previous.total_fee_pct,v_previous.renter_share_percent,p_effective_to,
      v_next.effective_from,auth.uid(),'Continuation after scheduled service fee period: '||v_reason)
    returning * into v_continuation;
    perform public.admin_write_audit('service_fee.continue_period','service_fee_configuration',
      v_continuation.id::text,null,to_jsonb(v_continuation),v_reason);
  end if;
  return to_jsonb(v_created);
exception when exclusion_violation then
  raise exception 'The requested service fee period overlaps an existing configuration' using errcode='23P01';
end;
$$;
revoke all on function public.admin_schedule_service_fee_configuration(numeric,integer,timestamptz,timestamptz,text)
  from public, anon;
grant execute on function public.admin_schedule_service_fee_configuration(numeric,integer,timestamptz,timestamptz,text)
  to authenticated;
