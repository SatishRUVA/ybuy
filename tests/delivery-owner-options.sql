begin;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_other_session uuid := gen_random_uuid();
  v_listing uuid;
  v_revision bigint;
  v_result jsonb;
  v_bad jsonb;
begin
  insert into auth.users(id, email) values (v_owner, v_owner::text || '@example.test'), (v_other, v_other::text || '@example.test');
  insert into auth.sessions(id, user_id) values (v_session, v_owner), (v_other_session, v_other);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_owner,'role','authenticated','session_id',v_session,
    'exp',extract(epoch from now() + interval '1 hour'))::text, true);
  insert into public.listings(owner_id, category_id, title, description, price_per_day, estimated_value, item_condition)
    select v_owner, id, 'Delivery options test', 'Delivery options test fixture', 10, 100, 'good'
    from public.categories limit 1 returning id, revision into v_listing, v_revision;
  if v_listing is null then raise exception 'A category is required for the test'; end if;
  if not exists (select 1 from public.listings where id=v_listing and delivery_round_trip_discount=0
    and not delivery_setup_available and delivery_setup_fee=0 and delivery_guaranteed_windows='{}') then
    raise exception 'Delivery option defaults are incorrect';
  end if;

  v_result := public.owner_save_listing_flow(v_listing, v_revision,
    '{"delivery_available":true,"delivery_fee":10,"delivery_round_trip_discount":15,"delivery_setup_available":true,"delivery_setup_fee":5.50,"delivery_guaranteed_windows":["morning","evening"]}'::jsonb);
  v_revision := (v_result->>'revision')::bigint;
  if not exists (select 1 from public.listings where id=v_listing and delivery_round_trip_discount=15
    and delivery_setup_available and delivery_setup_fee=5.50 and delivery_guaranteed_windows=array['morning','evening']) then
    raise exception 'Delivery settings were not saved';
  end if;
  v_result := public.owner_save_listing_flow(v_listing, v_revision, '{"delivery_fee":5,"delivery_round_trip_discount":8}'::jsonb);
  v_revision := (v_result->>'revision')::bigint;
  if not exists (select 1 from public.listings where id=v_listing and delivery_fee=5 and delivery_round_trip_discount=8
    and delivery_setup_available and delivery_guaranteed_windows=array['morning','evening']) then
    raise exception 'Partial save did not preserve settings';
  end if;
  v_result := public.owner_save_listing_flow(v_listing, v_revision, '{}'::jsonb);
  if (v_result->>'revision')::bigint <> v_revision then raise exception 'Unchanged settings advanced the revision'; end if;
  for v_bad in select value from jsonb_array_elements('[
    {"delivery_round_trip_discount":11},
    {"delivery_round_trip_discount":-1},
    {"delivery_setup_fee":1.001},
    {"delivery_setup_available":null},
    {"delivery_guaranteed_windows":["morning","morning"]},
    {"delivery_guaranteed_windows":["night"]},
    {"delivery_guaranteed_windows":[null]}
  ]'::jsonb) loop
    begin
      perform public.owner_save_listing_flow(v_listing, v_revision, v_bad);
      raise exception 'Invalid settings were accepted: %', v_bad;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.owner_save_listing_flow(v_listing, v_revision - 1, '{"delivery_setup_fee":1}'::jsonb);
    raise exception 'Stale revision was accepted';
  exception when serialization_failure then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_other,'role','authenticated','session_id',v_other_session,
    'exp',extract(epoch from now() + interval '1 hour'))::text, true);
  begin
    perform public.owner_save_listing_flow(v_listing, v_revision, '{"delivery_setup_fee":1}'::jsonb);
    raise exception 'Non-owner save was accepted';
  exception when insufficient_privilege then null;
  end;
  set constraints listing_delivery_discount_limit immediate;
  begin
    update public.listings set delivery_round_trip_discount=11 where id=v_listing;
    raise exception 'Direct update bypassed the discount limit';
  exception when check_violation then null;
  end;
  begin
    update public.listings set delivery_guaranteed_windows=array['evening','evening'] where id=v_listing;
    raise exception 'Direct update accepted duplicate windows';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
