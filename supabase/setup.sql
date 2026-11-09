-- Kulkarni Academy student portal: database setup.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run once on a fresh project.

-- ─── People ────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 80),
  role text not null default 'student' check (role in ('teacher', 'student')),
  timezone text not null default 'Europe/London',
  grade text check (char_length(grade) <= 60),
  board text check (char_length(board) <= 100),
  created_at timestamptz not null default now()
);

-- Security-definer helper so policies can ask "is the signed-in user the teacher?"
create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

-- ─── Classes ───────────────────────────────────────────────────────────────
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 60),
  topic text check (char_length(topic) <= 200),
  starts_at timestamptz not null,
  duration_minutes int not null default 60 check (duration_minutes between 15 and 240),
  meeting_url text not null check (meeting_url ~ '^https://' and char_length(meeting_url) <= 500),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now()
);
create index classes_student_start on public.classes (student_id, starts_at);

-- ─── Homework ──────────────────────────────────────────────────────────────
-- One row per student. Marking lives here, so only the teacher can write it.
create table public.homework (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 60),
  title text not null check (char_length(title) between 1 and 150),
  instructions text check (char_length(instructions) <= 3000),
  due_at timestamptz,
  attachment_path text,
  score numeric check (score >= 0),
  out_of numeric check (out_of > 0),
  feedback text check (char_length(feedback) <= 3000),
  marked_at timestamptz,
  created_at timestamptz not null default now()
);
create index homework_student on public.homework (student_id, created_at desc);

-- The student's answer. One per homework; editable until it is marked.
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null unique references public.homework (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  file_paths text[] not null default '{}',
  note text check (char_length(note) <= 2000),
  submitted_at timestamptz not null default now()
);

-- ─── Row level security: students only ever see their own rows ─────────────
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.homework enable row level security;
alter table public.submissions enable row level security;

revoke all on public.profiles, public.classes, public.homework, public.submissions from anon;
grant select, insert, update, delete on public.profiles, public.classes, public.homework, public.submissions to authenticated;

create policy "profiles: read own or teacher" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_teacher());
create policy "profiles: teacher updates" on public.profiles
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
-- New student profiles are created by the backend with the secret key, which bypasses RLS.

create policy "classes: read own or teacher" on public.classes
  for select to authenticated using (student_id = auth.uid() or public.is_teacher());
create policy "classes: teacher writes" on public.classes
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "homework: read own or teacher" on public.homework
  for select to authenticated using (student_id = auth.uid() or public.is_teacher());
create policy "homework: teacher writes" on public.homework
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "submissions: read own or teacher" on public.submissions
  for select to authenticated using (student_id = auth.uid() or public.is_teacher());
create policy "submissions: student submits own unmarked homework" on public.submissions
  for insert to authenticated with check (
    student_id = auth.uid()
    and exists (select 1 from public.homework h where h.id = homework_id and h.student_id = auth.uid() and h.marked_at is null)
  );
create policy "submissions: student edits until marked" on public.submissions
  for update to authenticated
  using (student_id = auth.uid() and exists (select 1 from public.homework h where h.id = homework_id and h.marked_at is null))
  with check (student_id = auth.uid() and exists (select 1 from public.homework h where h.id = homework_id and h.student_id = auth.uid() and h.marked_at is null));
create policy "submissions: teacher manages" on public.submissions
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- ─── File storage (worksheets and answers) ─────────────────────────────────
-- Private bucket. Files live under <student id>/assignments/… or <student id>/submissions/…
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('homework', 'homework', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy "homework files: read own folder or teacher" on storage.objects
  for select to authenticated using (
    bucket_id = 'homework' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_teacher())
  );
create policy "homework files: teacher uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'homework' and public.is_teacher());
create policy "homework files: student uploads answers" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'homework'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] = 'submissions'
  );
create policy "homework files: teacher deletes" on storage.objects
  for delete to authenticated using (bucket_id = 'homework' and public.is_teacher());

-- ─── Make yourself the teacher (run AFTER creating your login) ──────────────
-- 1. Supabase → Authentication → Users → Add user → Create new user
--    → kulkarniacademyyy@gmail.com + a strong password (tick "Auto confirm user").
-- 2. In a NEW query, run these lines (without the leading "-- "):
--
-- insert into public.profiles (id, full_name, role, timezone)
-- select id, 'Aditya Kulkarni', 'teacher', 'Asia/Kolkata'
-- from auth.users where email = 'kulkarniacademyyy@gmail.com';
