begin;

create temporary table listing_window_probe (
  id integer,
  availability_start date,
  availability_end date,
  status text
);
insert into listing_window_probe values (1, current_date - 20, current_date + 60, 'published');
create trigger scheduling_window before insert or update on listing_window_probe
  for each row execute function public.enforce_listing_scheduling_window();

do $$
begin
  insert into listing_window_probe values (2, current_date, current_date + 30, 'published');
  insert into listing_window_probe values (3, current_date + 179, current_date + 180, 'pending_approval');
  insert into listing_window_probe values (4, null, null, 'draft');
  update listing_window_probe set id = 5 where id = 1;

  begin
    insert into listing_window_probe values (6, current_date, current_date + 31, 'published');
    raise exception 'A 31-day availability window was accepted';
  exception when check_violation then
    if sqlerrm not like '%30 consecutive%' then raise; end if;
  end;
  begin
    update listing_window_probe set availability_end = current_date + 31 where id = 2;
    raise exception 'Editing to a 31-day window was accepted';
  exception when check_violation then
    if sqlerrm not like '%30 consecutive%' then raise; end if;
  end;
  begin
    update listing_window_probe set status = 'published' where id = 4;
    raise exception 'Publishing without availability was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into listing_window_probe values (7, current_date + 180, current_date + 181, 'published');
    raise exception 'Availability beyond the scheduling horizon was accepted';
  exception when check_violation then null;
  end;
end;
$$;

select '30-day boundary, edits, drafts, historical windows and scheduling horizon passed' as result;
rollback;
