-- Kulkarni Academy: tests own their questions ("test papers"). No shared question bank.
-- Run ONCE, after 002_tests.sql and 003_security.sql. Paste into Supabase → SQL Editor → New query → Run.
--
--   papers          a test you made: title, subject, grade, and its questions in order
--   questions       now belong to exactly one paper (paper_id) with a position (1, 2, 3 …)
--   tests           a paper given to one student, with an open/close window
--
-- Students get every question of the paper, one at a time, in the paper's order.
-- Each correct answer is 1 point, so the score is simply correct ÷ total.
-- Existing questions are moved into one paper per subject; existing tests and results keep working.

-- ─── Papers ────────────────────────────────────────────────────────────────
create table public.papers (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 150),
  subject text not null check (char_length(subject) between 1 and 60),
  grade text check (char_length(grade) <= 60),
  created_at timestamptz not null default now()
);
alter table public.papers enable row level security;
revoke all on public.papers from anon;
grant select, insert, update, delete on public.papers to authenticated;
create policy "papers: teacher only" on public.papers
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- ─── Questions belong to a paper ───────────────────────────────────────────
alter table public.questions
  add column paper_id uuid references public.papers (id) on delete cascade,
  add column position int;
alter table public.questions alter column topic drop not null;   -- topic is optional now
create index questions_paper_order on public.questions (paper_id, position);

-- Tests point at the paper they were made from; any number of questions is allowed.
alter table public.tests add column paper_id uuid references public.papers (id) on delete cascade;
alter table public.tests drop constraint if exists tests_question_count_check;
alter table public.tests add constraint tests_question_count_check check (question_count between 1 and 500);

-- Deleting a paper deletes its tests, results and questions together.
alter table public.attempt_answers drop constraint if exists attempt_answers_question_id_fkey;
alter table public.attempt_answers add constraint attempt_answers_question_id_fkey
  foreign key (question_id) references public.questions (id) on delete cascade;

-- ─── Move existing questions and tests into papers (one per subject) ────────
insert into public.papers (title, subject)
select s.subject || ' questions', s.subject
from (select subject from public.questions union select subject from public.tests) s;

update public.questions q set paper_id = p.id from public.papers p where p.subject = q.subject and q.paper_id is null;
update public.questions q set position = r.n
from (select id, row_number() over (partition by paper_id order by created_at, id) as n from public.questions) r
where r.id = q.id;
update public.tests t set paper_id = p.id from public.papers p where p.subject = t.subject and t.paper_id is null;

alter table public.questions alter column paper_id set not null, alter column position set not null;
alter table public.tests alter column paper_id set not null;

-- ─── Test engine: fixed order, every question, 1 point each ────────────────
create or replace function public._test_pick_next(p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  q public.questions%rowtype;
  perm smallint[];
begin
  select * into a from public.test_attempts where id = p_attempt for update;
  select * into t from public.tests where id = a.test_id;
  select qq.* into q from public.questions qq
    where qq.paper_id = t.paper_id and not qq.archived
      and not exists (select 1 from public.attempt_answers x where x.attempt_id = a.id and x.question_id = qq.id)
    order by qq.position, qq.created_at, qq.id
    limit 1;
  if not found then
    update public.test_attempts
      set finished_at = now(), finish_reason = case when a.asked_count = 0 then 'no_questions' else 'completed' end
      where id = a.id;
    return;
  end if;
  if q.kind = 'mcq' then   -- answer options are still shuffled for each student
    select array_agg(i::smallint order by random()) into perm from generate_series(0, array_length(q.options, 1) - 1) as i;
  end if;
  insert into public.attempt_answers (attempt_id, question_id, position, difficulty, time_limit_seconds, option_order)
    values (a.id, q.id, a.asked_count + 1, q.difficulty, q.time_limit_seconds, perm);
  update public.test_attempts set asked_count = asked_count + 1, max_points = max_points + 1 where id = a.id;
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
      'review_at', t.closes_at);
  end if;
  select * into cur from public.attempt_answers
    where attempt_id = a.id and answered_at is null and not timed_out order by position desc limit 1;
  select * into q from public.questions where id = cur.question_id;
  if q.kind = 'mcq' then
    select jsonb_agg(q.options[o + 1] order by ord) into opts from unnest(cur.option_order) with ordinality as u(o, ord);
  end if;
  return jsonb_build_object('status', 'in_progress', 'position', cur.position, 'total', total,
    'exits', a.exits, 'max_exits', t.max_exits,
    'question', jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'image_path', q.image_path,
      'options', opts, 'time_limit', cur.time_limit_seconds,
      'seconds_left', greatest(0, cur.time_limit_seconds - extract(epoch from now() - cur.asked_at))::int));
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
      points = points + case when ok then 1 else 0 end,
      correct_count = correct_count + case when ok then 1 else 0 end
    where id = a.id;
  perform public._test_pick_next(a.id);
  return public._test_view(a.id);
end $$;

-- Timed-out questions simply move on (no difficulty change any more).
create or replace function public._test_settle(p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cur public.attempt_answers%rowtype;
begin
  if exists (select 1 from public.test_attempts where id = p_attempt and finished_at is not null) then return; end if;
  select * into cur from public.attempt_answers
    where attempt_id = p_attempt and answered_at is null and not timed_out order by position desc limit 1;
  if found and now() > cur.asked_at + make_interval(secs => cur.time_limit_seconds + 3) then
    update public.attempt_answers set timed_out = true, is_correct = false where id = cur.id;
    perform public._test_pick_next(p_attempt);
  end if;
end $$;

revoke execute on function public._test_pick_next(uuid), public._test_settle(uuid), public._test_view(uuid) from public, anon, authenticated;
