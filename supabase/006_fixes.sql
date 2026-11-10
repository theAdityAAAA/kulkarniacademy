-- Kulkarni Academy: fixes from edge-case testing. Run ONCE, after 005_learning.sql.
-- Paste into Supabase → SQL Editor → New query → Run.

-- 1. Practice answers could not be saved: the rule looked up attempt_answers, which students
--    are not allowed to read, so the check always failed. Check it with a trusted helper instead.
create or replace function public.can_practice(p_question uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.attempt_answers x
    join public.test_attempts a on a.id = x.attempt_id
    join public.tests t on t.id = a.test_id
    where x.question_id = p_question and a.student_id = auth.uid() and t.closes_at < now()
  );
$$;
revoke execute on function public.can_practice(uuid) from public, anon;
grant execute on function public.can_practice(uuid) to authenticated;

drop policy if exists "practice: student logs own" on public.practice_attempts;
create policy "practice: student logs own" on public.practice_attempts
  for insert to authenticated with check (student_id = auth.uid() and public.can_practice(question_id));

-- 2. Double-tapping "Start test" made two start requests; the second failed with "duplicate key".
create or replace function public.test_start(p_test uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tests%rowtype; a_id uuid; created boolean := false;
begin
  select * into t from public.tests where id = p_test and student_id = auth.uid();
  if not found then raise exception 'Test not found.'; end if;
  select id into a_id from public.test_attempts where test_id = p_test;
  if a_id is null then
    if now() < t.opens_at then raise exception 'This test hasn''t opened yet.'; end if;
    if now() > t.closes_at then raise exception 'This test has closed.'; end if;
    insert into public.test_attempts (test_id, student_id) values (p_test, auth.uid())
      on conflict (test_id) do nothing
      returning id into a_id;
    if a_id is null then
      select id into a_id from public.test_attempts where test_id = p_test;   -- the other tap won
    else
      created := true;
    end if;
  end if;
  if created then perform public._test_pick_next(a_id); else perform public._test_settle(a_id); end if;
  return public._test_view(a_id);
end $$;

-- 3. If the current question vanished mid-test (e.g. deleted), the test screen got an empty question.
--    Now the test simply moves on to the next question, or finishes.
create or replace function public._test_view(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  cur public.attempt_answers%rowtype;
  q public.questions%rowtype;
  opts jsonb;
  total int;
begin
  select * into a from public.test_attempts where id = p_attempt;
  select * into t from public.tests where id = a.test_id;
  if a.finished_at is null then
    select * into cur from public.attempt_answers
      where attempt_id = a.id and answered_at is null and not timed_out order by position desc limit 1;
    if not found then
      perform public._test_pick_next(a.id);
      select * into a from public.test_attempts where id = p_attempt;
      select * into cur from public.attempt_answers
        where attempt_id = a.id and answered_at is null and not timed_out order by position desc limit 1;
    end if;
  end if;
  select count(*) into total from public.questions where paper_id = t.paper_id and not archived;
  if a.finished_at is not null then
    return jsonb_build_object('status', 'finished', 'reason', a.finish_reason, 'points', a.points, 'max_points', a.max_points,
      'correct', a.correct_count, 'asked', a.asked_count, 'total', total, 'exits', a.exits, 'max_exits', t.max_exits,
      'pending_marks', a.pending_marks, 'review_at', t.closes_at, 'attempt_id', a.id);
  end if;
  select * into q from public.questions where id = cur.question_id;
  if q.kind = 'mcq' then
    select jsonb_agg(q.options[o + 1] order by ord) into opts from unnest(cur.option_order) with ordinality as u(o, ord);
  end if;
  return jsonb_build_object('status', 'in_progress', 'position', cur.position, 'total', greatest(total, cur.position),
    'exits', a.exits, 'max_exits', t.max_exits, 'attempt_id', a.id,
    'question', jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'image_path', q.image_path,
      'options', opts, 'marks', case when q.kind = 'written' then q.marks end, 'time_limit', cur.time_limit_seconds,
      'seconds_left', greatest(0, cur.time_limit_seconds - extract(epoch from now() - cur.asked_at))::int));
end $$;
revoke execute on function public._test_view(uuid) from public, anon, authenticated;

-- 4. Indexes so results, practice and "what to reteach" stay fast as data grows.
create index if not exists attempt_answers_question on public.attempt_answers (question_id);
create index if not exists tests_paper on public.tests (paper_id);
create index if not exists test_attempts_student on public.test_attempts (student_id);
create index if not exists homework_submissions_student on public.submissions (student_id);
