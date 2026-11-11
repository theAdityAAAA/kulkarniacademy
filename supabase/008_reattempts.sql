-- Kulkarni Academy: give a student another attempt at a test, keeping earlier attempts.
-- Run ONCE, after 007_monitoring.sql. Paste into Supabase → SQL Editor → New query → Run.
--
-- Each new attempt is linked to the first one (retake_of) and numbered (attempt_no).
-- While a newer attempt is open, the student can't see earlier answers or practise those questions,
-- so they can't simply copy the answers into the new attempt.

alter table public.tests
  add column attempt_no int not null default 1 check (attempt_no between 1 and 50),
  add column retake_of uuid references public.tests (id) on delete cascade;
create index if not exists tests_retake on public.tests (retake_of);

-- True if this student has another attempt at the same test paper that is open and not finished yet.
create or replace function public._other_attempt_open(p_student uuid, p_paper uuid, p_except uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tests o
    where o.student_id = p_student and o.paper_id = p_paper and o.id <> p_except and o.closes_at > now()
      and not exists (select 1 from public.test_attempts oa where oa.test_id = o.id and oa.finished_at is not null)
  );
$$;
revoke execute on function public._other_attempt_open(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.test_review(p_test uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tests%rowtype;
begin
  select * into t from public.tests where id = p_test and student_id = auth.uid();
  if not found then raise exception 'Test not found.'; end if;
  if not exists (select 1 from public.test_attempts where test_id = p_test and finished_at is not null) then
    raise exception 'Finish the test first.';
  end if;
  if now() < t.closes_at then raise exception 'Answers are shown after the test closes.'; end if;
  if public._other_attempt_open(auth.uid(), t.paper_id, t.id) then
    raise exception 'Answers are hidden while your next attempt at this test is open.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('position', x.position, 'question_id', q.id, 'prompt', q.prompt,
      'image_path', q.image_path, 'kind', q.kind, 'options', q.options, 'correct_option', q.correct_option,
      'correct_number', q.correct_number, 'tolerance', q.tolerance, 'marks', q.marks,
      'given_option', x.given_option, 'given_number', x.given_number, 'given_text', x.given_text, 'given_files', x.given_files,
      'awarded', x.awarded, 'teacher_comment', x.teacher_comment,
      'is_correct', x.is_correct, 'timed_out', x.timed_out, 'explanation', q.explanation) order by x.position)
    from public.attempt_answers x
    join public.test_attempts a on a.id = x.attempt_id
    join public.questions q on q.id = x.question_id
    where a.test_id = p_test), '[]'::jsonb);
end $$;

create or replace function public.practice_items()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(item order by item->>'closed_at' desc, (item->>'position')::int), '[]'::jsonb)
  from (
    select distinct on (q.id) jsonb_build_object('question_id', q.id, 'test_title', t.title, 'subject', t.subject,
      'closed_at', t.closes_at, 'position', x.position, 'prompt', q.prompt, 'image_path', q.image_path, 'kind', q.kind,
      'options', q.options, 'correct_option', q.correct_option, 'correct_number', q.correct_number, 'tolerance', q.tolerance,
      'explanation', q.explanation) as item
    from public.attempt_answers x
    join public.test_attempts a on a.id = x.attempt_id
    join public.tests t on t.id = a.test_id
    join public.questions q on q.id = x.question_id
    where a.student_id = auth.uid() and a.finished_at is not null and t.closes_at < now()
      and q.kind in ('mcq', 'number') and x.is_correct is false
      and not public._other_attempt_open(auth.uid(), t.paper_id, t.id)
      and not exists (select 1 from public.practice_attempts p where p.student_id = auth.uid() and p.question_id = q.id and p.correct)
    order by q.id, t.closes_at desc
  ) s;
$$;
