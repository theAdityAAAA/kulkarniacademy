-- Kulkarni Academy: adaptive tests.
-- Run AFTER setup.sql. Paste this whole file into Supabase → SQL Editor → New query → Run.
--
-- How it works:
--   • The teacher writes questions into a question bank (students can never read it).
--   • A test is assigned to one student: subject, optional topics/grade, number of questions, open window.
--   • The student's browser only ever receives ONE question at a time, without the answer.
--     Picking the next question, the per-question timer and marking all happen here, in the database.
--   • Adaptive: start at Medium; a correct answer moves up a level, a wrong/timed-out one moves down.
--     Points = difficulty (Easy 1, Medium 2, Hard 3). Score % = points earned / points of questions asked.

-- ─── Tables ────────────────────────────────────────────────────────────────
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (char_length(subject) between 1 and 60),
  topic text not null check (char_length(topic) between 1 and 100),
  grade text check (char_length(grade) <= 60),            -- null = suitable for any grade
  difficulty smallint not null check (difficulty between 1 and 3),
  kind text not null check (kind in ('mcq', 'number')),
  prompt text not null check (char_length(prompt) between 1 and 2000),
  image_path text,
  options text[],
  correct_option smallint,
  correct_number numeric,
  tolerance numeric not null default 0 check (tolerance >= 0),
  explanation text check (char_length(explanation) <= 2000),
  time_limit_seconds int not null default 60 check (time_limit_seconds between 10 and 600),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  constraint question_has_answer check (coalesce(
    (kind = 'mcq' and coalesce(array_length(options, 1), 0) between 2 and 6
       and correct_option is not null and correct_option between 0 and coalesce(array_length(options, 1), 0) - 1)
    or (kind = 'number' and correct_number is not null), false))
);
create index questions_pool on public.questions (subject, difficulty) where not archived;

create table public.tests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 150),
  subject text not null check (char_length(subject) between 1 and 60),
  topics text[] not null default '{}',                     -- empty = all topics in the subject
  grade text,                                              -- null = any grade
  question_count int not null check (question_count between 3 and 40),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  max_exits int not null default 3 check (max_exits between 1 and 10),
  created_at timestamptz not null default now(),
  check (closes_at > opens_at)
);
create index tests_student on public.tests (student_id, opens_at desc);

create table public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null unique references public.tests (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  finish_reason text check (finish_reason in ('completed', 'exits', 'no_questions')),
  current_difficulty smallint not null default 2,
  exits int not null default 0,
  points numeric not null default 0,
  max_points numeric not null default 0,
  correct_count int not null default 0,
  asked_count int not null default 0
);

create table public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete restrict,
  position int not null,
  difficulty smallint not null,
  time_limit_seconds int not null,
  option_order smallint[],                                 -- shuffled order the options were shown in
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  given_option smallint,                                   -- index in the ORIGINAL options
  given_number numeric,
  is_correct boolean,
  timed_out boolean not null default false,
  unique (attempt_id, position)
);

-- ─── Access rules ──────────────────────────────────────────────────────────
alter table public.questions enable row level security;
alter table public.tests enable row level security;
alter table public.test_attempts enable row level security;
alter table public.attempt_answers enable row level security;

revoke all on public.questions, public.tests, public.test_attempts, public.attempt_answers from anon;
grant select, insert, update, delete on public.questions, public.tests, public.test_attempts, public.attempt_answers to authenticated;

-- Question bank and answer details: teacher only. Students get questions one at a time via the functions below.
create policy "questions: teacher only" on public.questions
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "attempt answers: teacher only" on public.attempt_answers
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "tests: read own or teacher" on public.tests
  for select to authenticated using (student_id = auth.uid() or public.is_teacher());
create policy "tests: teacher writes" on public.tests
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- Students can read their own result, but only the functions below can change it.
create policy "attempts: read own or teacher" on public.test_attempts
  for select to authenticated using (student_id = auth.uid() or public.is_teacher());
create policy "attempts: teacher manages" on public.test_attempts
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- ─── Internal helpers (not callable from the browser) ──────────────────────
create or replace function public._test_pick_next(p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  q public.questions%rowtype;
  d int;
  perm smallint[];
begin
  select * into a from public.test_attempts where id = p_attempt for update;
  select * into t from public.tests where id = a.test_id;
  if a.asked_count >= t.question_count then
    update public.test_attempts set finished_at = now(), finish_reason = 'completed' where id = a.id;
    return;
  end if;
  -- Try the current level first, then the nearest other levels.
  foreach d in array case a.current_difficulty when 1 then array[1, 2, 3] when 2 then array[2, 1, 3] else array[3, 2, 1] end loop
    select qq.* into q from public.questions qq
    where not qq.archived
      and qq.subject = t.subject
      and (cardinality(t.topics) = 0 or qq.topic = any (t.topics))
      and (t.grade is null or qq.grade is null or qq.grade = t.grade)
      and qq.difficulty = d
      and not exists (select 1 from public.attempt_answers x where x.attempt_id = a.id and x.question_id = qq.id)
    order by random() limit 1;
    exit when found;
  end loop;
  if q.id is null then
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
  update public.test_attempts set asked_count = asked_count + 1, max_points = max_points + q.difficulty where id = a.id;
end $$;

-- If the current question's time ran out (e.g. the page was closed), mark it and move on.
create or replace function public._test_settle(p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cur public.attempt_answers%rowtype;
begin
  if exists (select 1 from public.test_attempts where id = p_attempt and finished_at is not null) then return; end if;
  select * into cur from public.attempt_answers
    where attempt_id = p_attempt and answered_at is null and not timed_out order by position desc limit 1;
  if found and now() > cur.asked_at + make_interval(secs => cur.time_limit_seconds + 3) then
    update public.attempt_answers set timed_out = true, is_correct = false where id = cur.id;
    update public.test_attempts set current_difficulty = greatest(1, current_difficulty - 1) where id = p_attempt;
    perform public._test_pick_next(p_attempt);
  end if;
end $$;

-- What the student's screen should show right now. Never includes the correct answer.
create or replace function public._test_view(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  cur public.attempt_answers%rowtype;
  q public.questions%rowtype;
  opts jsonb;
begin
  select * into a from public.test_attempts where id = p_attempt;
  select * into t from public.tests where id = a.test_id;
  if a.finished_at is not null then
    return jsonb_build_object('status', 'finished', 'reason', a.finish_reason, 'points', a.points, 'max_points', a.max_points,
      'correct', a.correct_count, 'asked', a.asked_count, 'total', t.question_count, 'exits', a.exits, 'max_exits', t.max_exits,
      'level', a.current_difficulty, 'review_at', t.closes_at);
  end if;
  select * into cur from public.attempt_answers
    where attempt_id = a.id and answered_at is null and not timed_out order by position desc limit 1;
  select * into q from public.questions where id = cur.question_id;
  if q.kind = 'mcq' then
    select jsonb_agg(q.options[o + 1] order by ord) into opts from unnest(cur.option_order) with ordinality as u(o, ord);
  end if;
  return jsonb_build_object('status', 'in_progress', 'position', cur.position, 'total', t.question_count,
    'exits', a.exits, 'max_exits', t.max_exits,
    'question', jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'image_path', q.image_path,
      'options', opts, 'difficulty', q.difficulty, 'time_limit', cur.time_limit_seconds,
      'seconds_left', greatest(0, cur.time_limit_seconds - extract(epoch from now() - cur.asked_at))::int));
end $$;

-- ─── Functions the student's browser calls ─────────────────────────────────
create or replace function public.test_start(p_test uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tests%rowtype; a_id uuid;
begin
  select * into t from public.tests where id = p_test and student_id = auth.uid();
  if not found then raise exception 'Test not found.'; end if;
  select id into a_id from public.test_attempts where test_id = p_test;
  if a_id is null then
    if now() < t.opens_at then raise exception 'This test hasn''t opened yet.'; end if;
    if now() > t.closes_at then raise exception 'This test has closed.'; end if;
    insert into public.test_attempts (test_id, student_id) values (p_test, auth.uid()) returning id into a_id;
    perform public._test_pick_next(a_id);
  else
    perform public._test_settle(a_id);
  end if;
  return public._test_view(a_id);
end $$;

create or replace function public.test_answer(p_test uuid, p_question uuid, p_option int default null, p_number numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.test_attempts%rowtype;
  cur public.attempt_answers%rowtype;
  q public.questions%rowtype;
  orig smallint;
  ok boolean;
begin
  select * into a from public.test_attempts where test_id = p_test and student_id = auth.uid() for update;
  if not found then raise exception 'Start the test first.'; end if;
  if a.finished_at is not null then return public._test_view(a.id); end if;
  select * into cur from public.attempt_answers
    where attempt_id = a.id and answered_at is null and not timed_out order by position desc limit 1;
  -- Stale or late answer: just settle and show the current state.
  if not found or cur.question_id <> p_question
     or now() > cur.asked_at + make_interval(secs => cur.time_limit_seconds + 3) then
    perform public._test_settle(a.id);
    return public._test_view(a.id);
  end if;
  select * into q from public.questions where id = cur.question_id;
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
  update public.test_attempts set
      points = points + case when ok then q.difficulty else 0 end,
      correct_count = correct_count + case when ok then 1 else 0 end,
      current_difficulty = case when ok then least(3, current_difficulty + 1) else greatest(1, current_difficulty - 1) end
    where id = a.id;
  perform public._test_pick_next(a.id);
  return public._test_view(a.id);
end $$;

-- Called when the student leaves full screen or switches tab/app.
create or replace function public.test_exit(p_test uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.test_attempts%rowtype; limit_exits int; n int;
begin
  select * into a from public.test_attempts where test_id = p_test and student_id = auth.uid() for update;
  if not found then raise exception 'Start the test first.'; end if;
  if a.finished_at is not null then return public._test_view(a.id); end if;
  select max_exits into limit_exits from public.tests where id = p_test;
  update public.test_attempts set exits = exits + 1 where id = a.id returning exits into n;
  if n >= limit_exits then
    update public.attempt_answers set timed_out = true, is_correct = false
      where attempt_id = a.id and answered_at is null and not timed_out;
    update public.test_attempts set finished_at = now(), finish_reason = 'exits' where id = a.id;
  end if;
  return public._test_view(a.id);
end $$;

-- Answers and explanations, only after the student finished AND the test window has closed.
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
    select jsonb_agg(jsonb_build_object('position', x.position, 'difficulty', x.difficulty, 'prompt', q.prompt,
      'image_path', q.image_path, 'kind', q.kind, 'options', q.options, 'correct_option', q.correct_option,
      'correct_number', q.correct_number, 'given_option', x.given_option, 'given_number', x.given_number,
      'is_correct', x.is_correct, 'timed_out', x.timed_out, 'explanation', q.explanation) order by x.position)
    from public.attempt_answers x
    join public.test_attempts a on a.id = x.attempt_id
    join public.questions q on q.id = x.question_id
    where a.test_id = p_test), '[]'::jsonb);
end $$;

revoke execute on function public._test_pick_next(uuid), public._test_settle(uuid), public._test_view(uuid) from public, anon, authenticated;
revoke execute on function public.test_start(uuid), public.test_answer(uuid, uuid, int, numeric), public.test_exit(uuid), public.test_review(uuid) from public, anon;
grant execute on function public.test_start(uuid), public.test_answer(uuid, uuid, int, numeric), public.test_exit(uuid), public.test_review(uuid) to authenticated;

-- ─── Images for questions ──────────────────────────────────────────────────
-- Public bucket (random file names) so the student's test can show the diagram. Only the teacher can upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-images', 'question-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "question images: teacher uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'question-images' and public.is_teacher());
create policy "question images: teacher deletes" on storage.objects
  for delete to authenticated using (bucket_id = 'question-images' and public.is_teacher());

-- ─── PDFs uploaded for "Import from PDF" ───────────────────────────────────
-- Private. The teacher uploads; the backend reads it with the secret key, then deletes it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-imports', 'question-imports', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "question imports: teacher only" on storage.objects
  for all to authenticated using (bucket_id = 'question-imports' and public.is_teacher())
  with check (bucket_id = 'question-imports' and public.is_teacher());
