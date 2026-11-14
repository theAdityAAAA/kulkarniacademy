-- Kulkarni Academy: syllabus tracker + board/grade chosen from lists.
-- Run ONCE, after 008_reattempts.sql. Paste into Supabase → SQL Editor → New query → Run.
--
-- The syllabus topic lists themselves are not stored here. They ship with the portal
-- (frontend/public/curricula), taken from each exam board's official specification.
-- The database only remembers which syllabus each student follows and which topics are done.

-- ─── Which syllabus each student follows ──────────────────────────────────
create table public.student_syllabi (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  curriculum_id text not null check (curriculum_id ~ '^[a-z0-9-]{3,80}$'),
  exam_date date,
  created_at timestamptz not null default now(),
  unique (student_id, curriculum_id)
);
create index student_syllabi_student on public.student_syllabi (student_id);

-- ─── Topic progress: "taught" (covered in class) or "mastered" (student is secure) ───
create table public.topic_progress (
  student_id uuid not null references public.profiles (id) on delete cascade,
  curriculum_id text not null check (curriculum_id ~ '^[a-z0-9-]{3,80}$'),
  topic_code text not null check (char_length(topic_code) between 1 and 30),
  status text not null check (status in ('taught', 'mastered')),
  updated_at timestamptz not null default now(),
  primary key (student_id, curriculum_id, topic_code)
);

revoke all on public.student_syllabi, public.topic_progress from anon;
grant select, insert, update, delete on public.student_syllabi, public.topic_progress to authenticated;
alter table public.student_syllabi enable row level security;
alter table public.topic_progress enable row level security;

-- The teacher manages everything; a student can only read their own.
create policy "student_syllabi: teacher all" on public.student_syllabi
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "student_syllabi: student reads own" on public.student_syllabi
  for select to authenticated using (student_id = auth.uid());
create policy "topic_progress: teacher all" on public.topic_progress
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "topic_progress: student reads own" on public.topic_progress
  for select to authenticated using (student_id = auth.uid());

-- ─── A student picks their own board and year ───────────────────────────
-- Students can't edit their profile directly (it holds their role), so this only changes those two fields.
create or replace function public.set_my_board(p_board text, p_grade text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_student() then raise exception 'Only students can use this.'; end if;
  p_board := nullif(btrim(p_board), '');
  p_grade := nullif(btrim(p_grade), '');
  if p_board is null or p_grade is null then raise exception 'Choose your board and your year.'; end if;
  if char_length(p_board) > 100 or char_length(p_grade) > 60 then raise exception 'That choice is too long.'; end if;
  update public.profiles set board = p_board, grade = p_grade where id = auth.uid();
end;
$$;
revoke execute on function public.set_my_board(text, text) from public, anon;
grant execute on function public.set_my_board(text, text) to authenticated;
