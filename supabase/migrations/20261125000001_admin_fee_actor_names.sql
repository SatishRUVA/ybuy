create or replace function public.admin_list_service_fee_configurations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require('config.manage');
  return coalesce((
    select jsonb_agg(
      to_jsonb(c) || jsonb_build_object(
        'created_by_name', nullif(btrim(creator.full_name), ''),
        'updated_by_name', nullif(btrim(updater.full_name), '')
      )
      order by c.effective_from desc, c.created_at desc
    )
    from public.service_fee_configurations c
    left join public.profiles creator on creator.id = c.created_by
    left join public.profiles updater on updater.id = c.updated_by
  ), '[]'::jsonb);
end;
$$;
