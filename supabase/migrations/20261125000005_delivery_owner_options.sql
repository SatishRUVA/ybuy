alter table public.listings
  add column delivery_round_trip_discount numeric(10,2) not null default 0,
  add column delivery_setup_available boolean not null default false,
  add column delivery_setup_fee numeric(10,2) not null default 0,
  add column delivery_guaranteed_windows text[] not null default '{}',
  add constraint listing_delivery_discount_nonnegative check (delivery_round_trip_discount >= 0 and delivery_round_trip_discount::text <> 'NaN'),
  add constraint listing_delivery_setup_fee_nonnegative check (delivery_setup_fee >= 0 and delivery_setup_fee::text <> 'NaN'),
  add constraint listing_delivery_guaranteed_windows_valid check (
    delivery_guaranteed_windows <@ array['morning','afternoon','evening']::text[]
    and array_position(delivery_guaranteed_windows, null) is null
    and cardinality(array_positions(delivery_guaranteed_windows, 'morning')) <= 1
    and cardinality(array_positions(delivery_guaranteed_windows, 'afternoon')) <= 1
    and cardinality(array_positions(delivery_guaranteed_windows, 'evening')) <= 1
  );

-- A save can change the fee and discount in separate updates within one transaction.
create function public.check_listing_delivery_discount()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.listings
    where id = new.id and delivery_round_trip_discount > 2 * delivery_fee) then
    raise exception 'Round-trip discount cannot exceed two delivery trip fees' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger listing_delivery_discount_limit
  after insert or update on public.listings deferrable initially deferred
  for each row execute function public.check_listing_delivery_discount();

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_delivery_options;
revoke all on function public.owner_save_listing_flow_before_delivery_options(uuid,bigint,jsonb,jsonb,boolean)
  from public, anon, authenticated;

create function public.owner_save_listing_flow(
  p_listing_id uuid, p_revision bigint, p_details jsonb, p_pickup jsonb default null, p_publish boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_listing public.listings;
  v_discount numeric;
  v_setup_fee numeric;
  v_setup_available boolean;
  v_windows text[];
  v_key text;
begin
  if jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'Invalid listing details' using errcode = '22023';
  end if;
  foreach v_key in array array['delivery_round_trip_discount','delivery_setup_fee'] loop
    if p_details ? v_key then
      if jsonb_typeof(p_details->v_key) is distinct from 'number'
        or (p_details->>v_key)::numeric < 0
        or (p_details->>v_key)::numeric > 99999999.99
        or (p_details->>v_key)::numeric <> round((p_details->>v_key)::numeric, 2) then
        raise exception 'Delivery amounts must be nonnegative and have at most two decimal places' using errcode = '22023';
      end if;
    end if;
  end loop;
  if p_details ? 'delivery_setup_available' and jsonb_typeof(p_details->'delivery_setup_available') is distinct from 'boolean' then
    raise exception 'Installation availability must be true or false' using errcode = '22023';
  end if;
  if p_details ? 'delivery_guaranteed_windows' then
    if jsonb_typeof(p_details->'delivery_guaranteed_windows') is distinct from 'array' then
      raise exception 'Invalid guaranteed delivery windows' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_details->'delivery_guaranteed_windows') w
      where jsonb_typeof(w) is distinct from 'string' or w #>> '{}' not in ('morning','afternoon','evening'))
      or (select count(*) <> count(distinct w) from jsonb_array_elements_text(p_details->'delivery_guaranteed_windows') w) then
      raise exception 'Invalid guaranteed delivery windows' using errcode = '22023';
    end if;
    select coalesce(array_agg(w), '{}'::text[]) into v_windows
      from jsonb_array_elements_text(p_details->'delivery_guaranteed_windows') w;
  end if;

  v_result := public.owner_save_listing_flow_before_delivery_options(p_listing_id, p_revision,
    p_details - array['delivery_round_trip_discount','delivery_setup_available','delivery_setup_fee','delivery_guaranteed_windows'],
    p_pickup, p_publish);
  select * into v_listing from public.listings where id = p_listing_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Listing not found or not owned' using errcode = '42501'; end if;
  v_discount := case when p_details ? 'delivery_round_trip_discount' then (p_details->>'delivery_round_trip_discount')::numeric else v_listing.delivery_round_trip_discount end;
  v_setup_fee := case when p_details ? 'delivery_setup_fee' then (p_details->>'delivery_setup_fee')::numeric else v_listing.delivery_setup_fee end;
  v_setup_available := case when p_details ? 'delivery_setup_available' then (p_details->>'delivery_setup_available')::boolean else v_listing.delivery_setup_available end;
  v_windows := case when p_details ? 'delivery_guaranteed_windows' then v_windows else v_listing.delivery_guaranteed_windows end;
  if v_discount > 2 * v_listing.delivery_fee then
    raise exception 'Round-trip discount cannot exceed two delivery trip fees' using errcode = '22023';
  end if;
  if (v_discount, v_setup_available, v_setup_fee, v_windows) is distinct from
    (v_listing.delivery_round_trip_discount, v_listing.delivery_setup_available, v_listing.delivery_setup_fee, v_listing.delivery_guaranteed_windows) then
    update public.listings set delivery_round_trip_discount = v_discount, delivery_setup_available = v_setup_available,
      delivery_setup_fee = v_setup_fee, delivery_guaranteed_windows = v_windows
      where id = p_listing_id returning * into v_listing;
    v_result := jsonb_build_object('revision', v_listing.revision, 'status', v_listing.status, 'deposit', v_listing.deposit);
  end if;
  return v_result;
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public, anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;
