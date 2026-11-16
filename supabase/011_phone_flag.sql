-- Kulkarni Academy: camera monitoring can now flag "phone seen in front of the camera", and a problem that
-- is still going on when the test ends is no longer lost. Run after 010_live_classes.sql (safe to run again).
-- Paste into Supabase → SQL Editor → New query → Run.

-- Allow the new flag type (the old rule only allowed five types).
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.attempt_flags'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.attempt_flags drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.attempt_flags add constraint attempt_flags_kind_check
  check (kind in ('no_face', 'multiple_faces', 'camera_off', 'talking', 'mic_off', 'phone'));

-- Same as in 007_monitoring.sql, with 'phone' added to the allowed flags.
create or replace function public.test_flag(p_test uuid, p_kind text, p_seconds int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare a public.test_attempts%rowtype; pos int; n int;
begin
  if p_kind not in ('no_face', 'multiple_faces', 'camera_off', 'talking', 'mic_off', 'phone') then raise exception 'Unknown flag.'; end if;
  select x.* into a from public.test_attempts x join public.tests t on t.id = x.test_id
    where x.test_id = p_test and x.student_id = auth.uid() and t.monitoring;
  -- Quietly ignore stray flags. Something still happening when the test ends is reported a moment
  -- after it finishes, so flags are accepted for 15 seconds after finishing.
  if not found or (a.finished_at is not null and a.finished_at < now() - interval '15 seconds') then return; end if;
  select count(*) into n from public.attempt_flags where attempt_id = a.id;
  if n >= 300 then return; end if;
  select position into pos from public.attempt_answers
    where attempt_id = a.id and answered_at is null and not timed_out order by position desc limit 1;
  insert into public.attempt_flags (attempt_id, kind, seconds, question_position)
    values (a.id, p_kind, greatest(0, least(coalesce(p_seconds, 0), 7200)), pos);
  update public.test_attempts
    set monitor_summary = jsonb_set(monitor_summary, array[p_kind], to_jsonb(coalesce((monitor_summary ->> p_kind)::int, 0) + 1))
    where id = a.id;
end $$;

revoke execute on function public.test_flag(uuid, text, int) from public, anon;
grant execute on function public.test_flag(uuid, text, int) to authenticated;
