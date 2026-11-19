begin;

create function public.admin_apply_service_fee_configuration_now(
  p_total_fee_percent numeric,
  p_renter_share_percent integer,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_effective_from timestamptz := transaction_timestamp();
  v_effective_to timestamptz;
  v_reason text;
  v_configuration jsonb;
begin
  perform public.admin_require('config.manage');
  if not exists(
    select 1 from public.admin_users
    where user_id=auth.uid() and active and role='super_admin'
  ) then
    raise exception 'Only a Super Admin can change service fee configurations' using errcode='42501';
  end if;

  v_reason:=public.admin_clean_reason(p_reason);
  perform pg_advisory_xact_lock(hashtextextended('service_fee_configurations',0));
  select min(effective_from) into v_effective_to
    from public.service_fee_configurations
    where effective_from>v_effective_from;

  v_configuration:=public.admin_schedule_service_fee_configuration(
    p_total_fee_percent,p_renter_share_percent,v_effective_from,v_effective_to,v_reason
  );
  perform public.admin_write_audit(
    'service_fee.apply_now','service_fee_configuration',v_configuration->>'id',
    null,v_configuration,v_reason
  );
  return v_configuration;
end;
$$;

revoke all on function public.admin_apply_service_fee_configuration_now(numeric,integer,text)
  from public, anon;
grant execute on function public.admin_apply_service_fee_configuration_now(numeric,integer,text)
  to authenticated;

commit;
