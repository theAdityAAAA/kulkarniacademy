-- Kulkarni Academy: live classes inside the portal (video goes directly between teacher and student).
-- Run ONCE, after 009_syllabus.sql. Paste into Supabase → SQL Editor → New query → Run.
--
-- Supabase only carries the short "how to reach me" messages that start a call (Realtime),
-- never the video itself. Only the class's own student and the teacher can enter its room,
-- and only around the class time.

-- An outside Zoom/Meet link is now optional: classes happen in the portal by default.
alter table public.classes alter column meeting_url drop not null;

-- ─── Who may be in a class room right now ────────────────────────────────
-- 'teacher' | 'student' | null. Teacher: from 30 min before; student: from 15 min before;
-- both until 60 min after the class should have ended. Cancelled classes are closed.
create or replace function public._live_role(p_class uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_teacher() and now() >= c.starts_at - interval '30 minutes' then 'teacher'
    when c.student_id = auth.uid() and now() >= c.starts_at - interval '15 minutes' then 'student'
  end
  from public.classes c
  where c.id = p_class
    and c.status = 'scheduled'
    and now() <= c.starts_at + make_interval(mins => c.duration_minutes + 60);
$$;

-- Realtime room names look like "class:<class id>".
create or replace function public._live_topic_allowed(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_topic is null or p_topic !~ '^class:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public._live_role(substring(p_topic from 7)::uuid) is not null;
end;
$$;
revoke execute on function public._live_role(uuid), public._live_topic_allowed(text) from public, anon;
grant execute on function public._live_role(uuid), public._live_topic_allowed(text) to authenticated;

-- Private Realtime rooms: receiving and sending are both checked against the class.
drop policy if exists "live class: room members receive" on realtime.messages;
drop policy if exists "live class: room members send" on realtime.messages;
create policy "live class: room members receive" on realtime.messages
  for select to authenticated using (public._live_topic_allowed(realtime.topic()));
create policy "live class: room members send" on realtime.messages
  for insert to authenticated with check (public._live_topic_allowed(realtime.topic()));

-- ─── Opening a class: everything the class screen needs, in one safe call ─
create or replace function public.live_join(p_class uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.classes%rowtype;
  v_role text;
  v_opens timestamptz;
  v_closes timestamptz;
begin
  select * into c from public.classes where id = p_class;
  if not found then raise exception 'Class not found.'; end if;
  v_role := case when public.is_teacher() then 'teacher' when c.student_id = auth.uid() then 'student' end;
  if v_role is null then raise exception 'Class not found.'; end if;
  v_opens := c.starts_at - case when v_role = 'teacher' then interval '30 minutes' else interval '15 minutes' end;
  v_closes := c.starts_at + make_interval(mins => c.duration_minutes + 60);
  return jsonb_build_object(
    'role', v_role,
    'state', case when c.status = 'cancelled' then 'cancelled' when now() < v_opens then 'early' when now() > v_closes then 'ended' else 'open' end,
    'server_now', now(),
    'opens_at', v_opens,
    'closes_at', v_closes,
    'class', jsonb_build_object('id', c.id, 'subject', c.subject, 'topic', c.topic, 'starts_at', c.starts_at,
      'duration_minutes', c.duration_minutes, 'meeting_url', c.meeting_url),
    'student', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'timezone', p.timezone) from public.profiles p where p.id = c.student_id),
    'teacher_name', (select full_name from public.profiles where role = 'teacher' order by created_at limit 1)
  );
end;
$$;
revoke execute on function public.live_join(uuid) from public, anon;
grant execute on function public.live_join(uuid) to authenticated;

-- ─── Attendance: who was in the class room, and for how long ─────────────
create table public.class_attendance (
  class_id uuid not null references public.classes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  first_joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seconds int not null default 0 check (seconds between 0 and 86400),
  primary key (class_id, user_id)
);
create index class_attendance_user on public.class_attendance (user_id);
revoke all on public.class_attendance from anon;
grant select on public.class_attendance to authenticated;  -- written only by live_heartbeat below
alter table public.class_attendance enable row level security;
create policy "class_attendance: teacher reads" on public.class_attendance
  for select to authenticated using (public.is_teacher());
create policy "class_attendance: student reads own" on public.class_attendance
  for select to authenticated using (user_id = auth.uid());

-- Called about once a minute while someone is in the class room. Time only counts between
-- heartbeats that are close together, so leaving and coming back never adds the gap.
create or replace function public.live_heartbeat(p_class uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public._live_role(p_class) is null then raise exception 'This class room is closed.'; end if;
  insert into public.class_attendance (class_id, user_id) values (p_class, auth.uid())
  on conflict (class_id, user_id) do update set
    seconds = least(86400, public.class_attendance.seconds
      + case when now() - public.class_attendance.last_seen_at <= interval '150 seconds'
             then greatest(0, extract(epoch from now() - public.class_attendance.last_seen_at)::int) else 0 end),
    last_seen_at = now();
end;
$$;
revoke execute on function public.live_heartbeat(uuid) from public, anon;
grant execute on function public.live_heartbeat(uuid) to authenticated;
