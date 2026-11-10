-- Kulkarni Academy: written answers, shuffled order, marking, practice mode.
-- Run ONCE, after 004_test_papers.sql. Paste into Supabase → SQL Editor → New query → Run.

-- ─── Written-answer questions ("show your working") ─────────────────────────
-- The student types and/or photographs their answer; the teacher marks it out of `marks`.
alter table public.questions drop constraint if exists questions_kind_check;
alter table public.questions add constraint questions_kind_check check (kind in ('mcq', 'number', 'written'));
alter table public.questions drop constraint if exists question_has_answer;
alter table public.questions add constraint question_has_answer check (coalesce(
  (kind = 'mcq' and coalesce(array_length(options, 1), 0) between 2 and 6
     and correct_option is not null and correct_option between 0 and coalesce(array_length(options, 1), 0) - 1)
  or (kind = 'number' and correct_number is not null)
  or kind = 'written', false));
alter table public.questions add column marks int not null default 1 check (marks between 1 and 20);
alter table public.questions drop constraint if exists questions_time_limit_seconds_check;
alter table public.questions add constraint questions_time_limit_seconds_check check (time_limit_seconds between 10 and 3600);

alter table public.attempt_answers
  add column given_text text check (char_length(given_text) <= 5000),
  add column given_files text[],
  add column awarded numeric check (awarded >= 0),
  add column teacher_comment text check (char_length(teacher_comment) <= 2000),
  add column marked_at timestamptz;
alter table public.test_attempts add column pending_marks int not null default 0;

-- Shuffle question order for each student (per test paper).
alter table public.papers add column shuffle_questions boolean not null default false;

-- ─── Easier scheduling ─────────────────────────────────────────────────────
-- Each student's usual Zoom/Meet link, so it doesn't need pasting every time.
alter table public.profiles add column meeting_url text check (meeting_url is null or (meeting_url ~ '^https://' and char_length(meeting_url) <= 500));
-- When a class is moved, remember its original time so the student sees "Moved from …".
alter table public.classes add column rescheduled_from timestamptz;

-- ─── Practice mode: retrying past mistakes (untimed, unscored) ──────────────
create table public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  correct boolean not null,
  created_at timestamptz not null default now()
);
create index practice_student on public.practice_attempts (student_id, question_id);
alter table public.practice_attempts enable row level security;
revoke all on public.practice_attempts from anon;
grant select, insert on public.practice_attempts to authenticated;
create policy "practice: read own or teacher" on public.practice_attempts
  for select to authenticated using (student_id = auth.uid() or public.is_teacher());
-- A student may only log practice for a question from one of their own tests that has closed.
create policy "practice: student logs own" on public.practice_attempts
  for insert to authenticated with check (
    student_id = auth.uid() and exists (
      select 1 from public.attempt_answers x
      join public.test_attempts a on a.id = x.attempt_id
      join public.tests t on t.id = a.test_id
      where x.question_id = practice_attempts.question_id and a.student_id = auth.uid() and t.closes_at < now()
    )
  );

-- ─── Engine ────────────────────────────────────────────────────────────────
-- Recomputes an attempt's score: 1 point per correct choice/number answer + teacher marks on written ones.
create or replace function public._test_recompute(p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.test_attempts a set
    points = coalesce((select sum(case when q.kind = 'written' then coalesce(x.awarded, 0) when x.is_correct then 1 else 0 end)
                       from public.attempt_answers x join public.questions q on q.id = x.question_id where x.attempt_id = a.id), 0),
    max_points = coalesce((select sum(case when q.kind = 'written' then q.marks else 1 end)
                           from public.attempt_answers x join public.questions q on q.id = x.question_id where x.attempt_id = a.id), 0),
    correct_count = (select count(*) from public.attempt_answers x where x.attempt_id = a.id and x.is_correct),
    pending_marks = (select count(*) from public.attempt_answers x join public.questions q on q.id = x.question_id
                     where x.attempt_id = a.id and q.kind = 'written' and x.answered_at is not null and x.awarded is null)
  where a.id = p_attempt;
end $$;

create or replace function public._test_pick_next(p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  shuffle boolean;
  q public.questions%rowtype;
  perm smallint[];
begin
  select * into a from public.test_attempts where id = p_attempt for update;
  select * into t from public.tests where id = a.test_id;
  select shuffle_questions into shuffle from public.papers where id = t.paper_id;
  select qq.* into q from public.questions qq
    where qq.paper_id = t.paper_id and not qq.archived
      and not exists (select 1 from public.attempt_answers x where x.attempt_id = a.id and x.question_id = qq.id)
    order by case when shuffle then random() else 0 end, qq.position, qq.created_at, qq.id
    limit 1;
  if not found then
    update public.test_attempts
      set finished_at = now(), finish_reason = case when a.asked_count = 0 then 'no_questions' else 'completed' end
      where id = a.id;
    return;
  end if;
  if q.kind = 'mcq' then
    select array_agg(i::smallint order by random()) into perm from generate_series(0, array_length(q.options, 1) - 1) as i;
  end if;
  insert into public.attempt_answers (attempt_id, question_id, position, difficulty, time_limit_seconds, option_order)
    values (a.id, q.id, a.asked_count + 1, q.difficulty, q.time_limit_seconds, perm);
  update public.test_attempts set asked_count = asked_count + 1,
    max_points = max_points + case when q.kind = 'written' then q.marks else 1 end
    where id = a.id;
end $$;

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
  select count(*) into total from public.questions where paper_id = t.paper_id and not archived;
  if a.finished_at is not null then
    return jsonb_build_object('status', 'finished', 'reason', a.finish_reason, 'points', a.points, 'max_points', a.max_points,
      'correct', a.correct_count, 'asked', a.asked_count, 'total', total, 'exits', a.exits, 'max_exits', t.max_exits,
      'pending_marks', a.pending_marks, 'review_at', t.closes_at, 'attempt_id', a.id);
  end if;
  select * into cur from public.attempt_answers
    where attempt_id = a.id and answered_at is null and not timed_out order by position desc limit 1;
  select * into q from public.questions where id = cur.question_id;
  if q.kind = 'mcq' then
    select jsonb_agg(q.options[o + 1] order by ord) into opts from unnest(cur.option_order) with ordinality as u(o, ord);
  end if;
  return jsonb_build_object('status', 'in_progress', 'position', cur.position, 'total', total,
    'exits', a.exits, 'max_exits', t.max_exits, 'attempt_id', a.id,
    'question', jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'image_path', q.image_path,
      'options', opts, 'marks', case when q.kind = 'written' then q.marks end, 'time_limit', cur.time_limit_seconds,
      'seconds_left', greatest(0, cur.time_limit_seconds - extract(epoch from now() - cur.asked_at))::int));
end $$;

-- test_answer gains a typed answer and photo paths for written questions.
drop function if exists public.test_answer(uuid, uuid, int, numeric);
create or replace function public.test_answer(p_test uuid, p_question uuid, p_option int default null, p_number numeric default null,
                                              p_text text default null, p_files text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.test_attempts%rowtype;
  cur public.attempt_answers%rowtype;
  q public.questions%rowtype;
  orig smallint;
  ok boolean;
  files text[];
  answered boolean;
begin
  select * into a from public.test_attempts where test_id = p_test and student_id = auth.uid() for update;
  if not found then raise exception 'Start the test first.'; end if;
  if a.finished_at is not null then return public._test_view(a.id); end if;
  select * into cur from public.attempt_answers
    where attempt_id = a.id and answered_at is null and not timed_out order by position desc limit 1;
  -- Written answers get extra grace for the photo upload.
  if not found or cur.question_id <> p_question
     or now() > cur.asked_at + make_interval(secs => cur.time_limit_seconds + 3 + case when p_files is not null then 60 else 0 end) then
    perform public._test_settle(a.id);
    return public._test_view(a.id);
  end if;
  select * into q from public.questions where id = cur.question_id;
  if q.kind = 'written' then
    -- Only photos the student uploaded to their own folder are accepted.
    select array_agg(f) into files from unnest(coalesce(p_files, '{}')) f
      where f like auth.uid()::text || '/submissions/%' and char_length(f) < 300;
    answered := coalesce(trim(p_text), '') <> '' or coalesce(array_length(files, 1), 0) > 0;
    update public.attempt_answers set answered_at = now(), given_text = nullif(left(trim(p_text), 5000), ''),
        given_files = files, timed_out = not answered,
        is_correct = case when answered then null else false end, awarded = case when answered then null else 0 end
      where id = cur.id;
  else
    if q.kind = 'mcq' then
      if p_option is not null and p_option between 0 and array_length(cur.option_order, 1) - 1 then
        orig := cur.option_order[p_option + 1];
      end if;
      ok := orig is not null and orig = q.correct_option;
    else
      ok := p_number is not null and abs(p_number - q.correct_number) <= q.tolerance;
    end if;
    update public.attempt_answers set answered_at = now(), given_option = orig,
        given_number = case when q.kind = 'number' then p_number end, is_correct = ok,
        timed_out = (p_option is null and p_number is null)
      where id = cur.id;
  end if;
  perform public._test_recompute(a.id);
  perform public._test_pick_next(a.id);
  return public._test_view(a.id);
end $$;

create or replace function public._test_settle(p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cur public.attempt_answers%rowtype;
begin
  if exists (select 1 from public.test_attempts where id = p_attempt and finished_at is not null) then return; end if;
  select * into cur from public.attempt_answers
    where attempt_id = p_attempt and answered_at is null and not timed_out order by position desc limit 1;
  if found and now() > cur.asked_at + make_interval(secs => cur.time_limit_seconds + 3) then
    update public.attempt_answers set timed_out = true, is_correct = false, awarded = 0 where id = cur.id;
    perform public._test_recompute(p_attempt);
    perform public._test_pick_next(p_attempt);
  end if;
end $$;

-- Teacher marks one written answer. Returns the attempt's new score.
create or replace function public.mark_written(p_answer uuid, p_awarded numeric, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.attempt_answers%rowtype; q public.questions%rowtype; a public.test_attempts%rowtype;
begin
  if not public.is_teacher() then raise exception 'Only the teacher can mark answers.'; end if;
  select * into x from public.attempt_answers where id = p_answer;
  if not found then raise exception 'Answer not found.'; end if;
  select * into q from public.questions where id = x.question_id;
  if q.kind <> 'written' then raise exception 'Only written answers are marked by hand.'; end if;
  if p_awarded is null or p_awarded < 0 or p_awarded > q.marks then raise exception 'Marks must be between 0 and %.', q.marks; end if;
  update public.attempt_answers set awarded = p_awarded, is_correct = (p_awarded >= q.marks),
      teacher_comment = nullif(left(trim(p_comment), 2000), ''), marked_at = now()
    where id = p_answer;
  perform public._test_recompute(x.attempt_id);
  select * into a from public.test_attempts where id = x.attempt_id;
  return jsonb_build_object('points', a.points, 'max_points', a.max_points, 'pending_marks', a.pending_marks);
end $$;

-- Review after the test closes: now includes written answers and the teacher's marks.
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

-- Mistake notebook: choice/number questions the student got wrong in closed tests,
-- not yet answered correctly in practice. Correct answers are fine to send: the tests have closed.
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
      and not exists (select 1 from public.practice_attempts p where p.student_id = auth.uid() and p.question_id = q.id and p.correct)
    order by q.id, t.closes_at desc
  ) s;
$$;

revoke execute on function public._test_pick_next(uuid), public._test_settle(uuid), public._test_view(uuid), public._test_recompute(uuid) from public, anon, authenticated;
revoke execute on function public.test_answer(uuid, uuid, int, numeric, text, text[]), public.mark_written(uuid, numeric, text), public.practice_items() from public, anon;
grant execute on function public.test_answer(uuid, uuid, int, numeric, text, text[]), public.mark_written(uuid, numeric, text), public.practice_items() to authenticated;
