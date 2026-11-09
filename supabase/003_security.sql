-- Kulkarni Academy: security hardening.
-- Run AFTER setup.sql and 002_tests.sql. Paste into Supabase → SQL Editor → New query → Run.
--
-- Fixes: a person who manages to create a login without being added by the teacher
-- (e.g. if public sign-ups are ever left on) could upload/read files in their own
-- "homework" storage folder. Storage access now requires a real student profile.

create or replace function public.is_student()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'student');
$$;

drop policy if exists "homework files: student uploads answers" on storage.objects;
create policy "homework files: student uploads answers" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'homework'
    and public.is_student()
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] = 'submissions'
  );

drop policy if exists "homework files: read own folder or teacher" on storage.objects;
create policy "homework files: read own folder or teacher" on storage.objects
  for select to authenticated using (
    bucket_id = 'homework'
    and ((public.is_student() and (storage.foldername(name))[1] = auth.uid()::text) or public.is_teacher())
  );

-- The role helpers are only needed inside the rules above, not as public API calls.
-- (Signed-in users keep access because the access rules call them on their behalf.)
revoke execute on function public.is_teacher(), public.is_student() from public, anon;
grant execute on function public.is_teacher(), public.is_student() to authenticated;
