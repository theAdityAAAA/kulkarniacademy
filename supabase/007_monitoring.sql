-- Kulkarni Academy: camera & microphone monitoring during tests. Run ONCE, after 006_fixes.sql.
-- Paste into Supabase → SQL Editor → New query → Run.
--
-- Privacy by design: NO photos, video or audio are ever stored or sent. The checks run on the
-- student's own device; only short text flags are saved ("no face for 25 s at question 4").
-- Flag details are deleted after 10 days; a small per-result summary (counts) is kept.

-- Per test: is monitoring on? (Copied onto each student's test so their screen knows before starting.)
alter table public.papers add column monitoring boolean not null default false;
alter table public.tests add column monitoring boolean not null default false;

-- When the student (with their parent's knowledge) agreed to monitoring for this attempt,
-- and a running summary of flags, e.g. {"no_face": 2, "talking": 1}.
alter table public.test_attempts
  add column monitoring_agreed_at timestamptz,
  add column monitor_summary jsonb not null default '{}'::jsonb;

create table public.attempt_flags (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_attempts (id) on delete cascade,
  kind text not null check (kind in ('no_face', 'multiple_faces', 'camera_off', 'talking', 'mic_off')),
  seconds int not null default 0 check (seconds between 0 and 7200),
  question_position int,
  created_at timestamptz not null default now()
);
create index attempt_flags_attempt on public.attempt_flags (attempt_id, created_at);
create index attempt_flags_created on public.attempt_flags (created_at);
alter table public.attempt_flags enable row level security;
revoke all on public.attempt_flags from anon;
grant select, delete on public.attempt_flags to authenticated;
-- Only the teacher reads flags. Students write them only through test_flag() below.
create policy "flags: teacher reads and deletes" on public.attempt_flags
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- Student agrees to monitoring at the start of a monitored test.
create or replace function public.test_monitoring_agree(p_test uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.test_attempts set monitoring_agreed_at = coalesce(monitoring_agreed_at, now())
    where test_id = p_test and student_id = auth.uid();
end $$;

-- Student's device reports one flag. Only for their own unfinished, monitored test; at most 300 per attempt.
create or replace function public.test_flag(p_test uuid, p_kind text, p_seconds int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare a public.test_attempts%rowtype; pos int; n int;
begin
  if p_kind not in ('no_face', 'multiple_faces', 'camera_off', 'talking', 'mic_off') then raise exception 'Unknown flag.'; end if;
  select x.* into a from public.test_attempts x join public.tests t on t.id = x.test_id
    where x.test_id = p_test and x.student_id = auth.uid() and t.monitoring;
  if not found or a.finished_at is not null then return; end if;   -- quietly ignore late or stray flags
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

revoke execute on function public.test_monitoring_agree(uuid), public.test_flag(uuid, text, int) from public, anon;
grant execute on function public.test_monitoring_agree(uuid), public.test_flag(uuid, text, int) to authenticated;
