begin;

-- Interpret listing date-only boundaries in the owner's browser timezone for this save
-- transaction. The timezone is stripped before forwarding to the persistence functions.
alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_local_dates;
revoke all on function public.owner_save_listing_flow_before_local_dates(uuid,bigint,jsonb,jsonb,boolean)
  from public,anon,authenticated;

create function public.owner_save_listing_flow(
  p_listing_id uuid,
  p_revision bigint,
  p_details jsonb,
  p_pickup jsonb default null,
  p_publish boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_details jsonb := p_details;
  v_timezone text;
begin
  if p_details ? 'availability_timezone' then
    if jsonb_typeof(p_details->'availability_timezone') is distinct from 'string' then
      raise exception 'Invalid availability timezone' using errcode='22023';
    end if;
    v_timezone := p_details->>'availability_timezone';
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then
      raise exception 'Invalid availability timezone' using errcode='22023';
    end if;
    perform pg_catalog.set_config('TimeZone',v_timezone,true);
    v_details := p_details - 'availability_timezone';
  end if;
  return public.owner_save_listing_flow_before_local_dates(p_listing_id,p_revision,v_details,p_pickup,p_publish);
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

commit;
