begin;

alter table public.app_settings drop constraint app_settings_value_type_check;
alter table public.app_settings add constraint app_settings_value_type_check
  check (value_type in ('number','integer','boolean','country_codes'));

insert into public.app_settings(key,value,value_type,description,is_public)
values ('marketplace_country_codes','["US"]','country_codes',
  'Countries allowed for city search, location detection, pickup addresses and new item requests. Use ISO country codes. Existing rentals are unchanged.',true)
on conflict(key) do nothing;

create or replace function public.admin_update_setting(p_key text,p_value jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reason text;v_s public.app_settings;v_error text;v_num numeric;
begin
  perform public.admin_require('config.manage');
  v_reason:=public.admin_clean_reason(p_reason);
  select * into v_s from public.app_settings where key=p_key for update;
  if not found then raise exception 'Unknown setting' using errcode='P0002';end if;
  if p_value is null or jsonb_typeof(p_value)='null' then
    v_error:='Value cannot be null';
  elsif v_s.value_type='country_codes' then
    if jsonb_typeof(p_value)<>'array' then
      v_error:='Choose at least one valid country';
    elsif jsonb_array_length(p_value)=0 or jsonb_array_length(p_value)>249 then
      v_error:='Choose at least one valid country';
    elsif exists(select 1 from jsonb_array_elements(p_value) x
      where jsonb_typeof(x)<>'string' or not exists(
        select 1 from public.reference_countries c where c.code=x #>> '{}'))
      or (select count(distinct x) from jsonb_array_elements(p_value) x)<>jsonb_array_length(p_value) then
      v_error:='Choose valid, unique ISO country codes';
    end if;
  elsif v_s.value_type='boolean' then
    if jsonb_typeof(p_value)<>'boolean' then v_error:='Value must be true or false';end if;
  elsif jsonb_typeof(p_value)<>'number' then
    v_error:='Value must be a number';
  else
    v_num:=(p_value #>> '{}')::numeric;
    if v_s.value_type='integer' and v_num<>trunc(v_num) then v_error:='Value must be a whole number';
    elsif v_s.min_value is not null and v_num<v_s.min_value then v_error:=format('Value must be at least %s',v_s.min_value);
    elsif v_s.max_value is not null and v_num>v_s.max_value then v_error:=format('Value must be at most %s',v_s.max_value);
    end if;
  end if;
  if v_error is not null then
    perform public.admin_write_audit('setting.update','setting',p_key,
      jsonb_build_object('value',v_s.value),jsonb_build_object('value',p_value,'error',v_error),v_reason,'failed');
    return jsonb_build_object('ok',false,'error',v_error);
  end if;
  update public.app_settings set value=p_value,updated_by=auth.uid(),updated_at=now() where key=p_key;
  perform public.admin_write_audit('setting.update','setting',p_key,
    jsonb_build_object('value',v_s.value),jsonb_build_object('value',p_value),v_reason);
  return jsonb_build_object('ok',true);
end;
$$;

create function public.marketplace_country_allowed(p_country text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_settings s
    join public.reference_countries c on s.value ? c.code
    where s.key='marketplace_country_codes'
      and (c.code=upper(btrim(p_country)) or lower(c.name)=lower(btrim(p_country))));
$$;
revoke all on function public.marketplace_country_allowed(text) from public,anon,authenticated;

create function public.guard_pickup_country()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.country,new.address,new.city,new.state,new.postal_code,new.latitude,new.longitude)
    is not distinct from (old.country,old.address,old.city,old.state,old.postal_code,old.latitude,old.longitude) then
    return new;
  end if;
  if not public.marketplace_country_allowed(new.country) then
    raise exception 'Choose a pickup address in an enabled marketplace country' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_pickup_country() from public,anon,authenticated;
create trigger pickup_country_policy before insert or update on public.listing_pickup_locations
  for each row execute function public.guard_pickup_country();

create function public.guard_publication_country()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status not in ('published','pending_approval') then return new;end if;
  if tg_op='UPDATE' and new.status=old.status then return new;end if;
  if not exists(select 1 from public.listing_pickup_locations p
    where p.listing_id=new.id and public.marketplace_country_allowed(p.country)) then
    raise exception 'Choose a pickup address in an enabled marketplace country before publishing' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_publication_country() from public,anon,authenticated;
create trigger listing_publication_country_policy before insert or update on public.listings
  for each row execute function public.guard_publication_country();

alter table public.item_requests add column location_country_code text references public.reference_countries(code);

alter function public.create_located_item_request(jsonb,double precision,double precision,integer)
  rename to create_located_item_request_before_country_policy;
revoke all on function public.create_located_item_request_before_country_policy(jsonb,double precision,double precision,integer)
  from public,anon,authenticated;
revoke all on function public.create_item_request(uuid,uuid,uuid,text,text,text,date,date,text,numeric,integer,text,text,text,text[])
  from public,anon,authenticated;

create function public.create_located_item_request(p_request jsonb,p_latitude double precision,p_longitude double precision,p_radius_miles integer default 5)
returns public.item_requests language plpgsql security definer set search_path = '' as $$
declare v_country text;v_request public.item_requests;
begin
  perform public.marketplace_require_user();
  v_country:=p_request->>'p_country_code';
  if not exists(select 1 from public.reference_countries where code=v_country)
    or not public.marketplace_country_allowed(v_country) then
    raise exception 'Choose a request location in an enabled marketplace country' using errcode='22023';
  end if;
  v_request:=public.create_located_item_request_before_country_policy(
    p_request-'p_country_code',p_latitude,p_longitude,p_radius_miles);
  if v_request.location_country_code is not null and v_request.location_country_code<>v_country then
    raise exception 'Request retry has a different country' using errcode='22023';
  end if;
  update public.item_requests set location_country_code=v_country where id=v_request.id returning * into v_request;
  return v_request;
end;
$$;
revoke all on function public.create_located_item_request(jsonb,double precision,double precision,integer) from public,anon;
grant execute on function public.create_located_item_request(jsonb,double precision,double precision,integer) to authenticated;

commit;
