import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ClipboardList, RotateCcw, ShieldPlus, Trash2, X } from 'lucide-react';
import { firstOf, must, supabase } from './supabase';
import { Empty, Notice, useAction } from './shared';
import { dateTimeLabel } from './time';
import { LEVELS } from './TestRunner';

const toInput = (date) => {
  const d = new Date(date); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function poolFor(questions, subject, topics, grade) {
  return questions.filter((q) => !q.archived && q.subject === subject && (!topics.length || topics.includes(q.topic)) && (!grade || !q.grade || q.grade === grade));
}

function CreateTest({ students, questions, reload }) {
  const subjects = useMemo(() => [...new Set(questions.filter((q) => !q.archived).map((q) => q.subject))].sort(), [questions]);
  const [form, setForm] = useState({ studentIds: [], title: '', subject: subjects[0] ?? '', topics: [], matchGrade: true, count: 10, opens: toInput(Date.now()), closes: toInput(Date.now() + 7 * 86400000) });
  const { busy, error, setError, run } = useAction();
  const [saved, setSaved] = useState('');
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));
  const topics = useMemo(() => [...new Set(questions.filter((q) => !q.archived && q.subject === form.subject).map((q) => q.topic))].sort(), [questions, form.subject]);
  const toggle = (field, value) => setForm((f) => ({ ...f, [field]: f[field].includes(value) ? f[field].filter((x) => x !== value) : [...f[field], value] }));

  if (!students.length) return <Empty icon={ShieldPlus} title="Add a student first">Create a student login, then set tests here.</Empty>;
  if (!subjects.length) return <Empty icon={ShieldPlus} title="Add questions first">Open the Question bank tab and add some questions. Tests pick from them.</Empty>;

  const chosen = students.filter((s) => form.studentIds.includes(s.id));
  const pools = chosen.map((s) => ({ s, pool: poolFor(questions, form.subject, form.topics, form.matchGrade ? s.grade : null) }));

  const submit = (event) => {
    event.preventDefault();
    setSaved('');
    if (!chosen.length) { setError('Tick at least one student.'); return; }
    const opens = new Date(form.opens), closes = new Date(form.closes);
    if (!(closes > opens)) { setError('The closing time must be after the opening time.'); return; }
    const empty = pools.filter((p) => p.pool.length === 0);
    if (empty.length) { setError(`No questions match for ${empty.map((p) => p.s.full_name).join(', ')}. Change the topics or untick “match grade”.`); return; }
    run(async () => {
      must(await supabase.from('tests').insert(chosen.map((s) => ({
        student_id: s.id, title: form.title.trim(), subject: form.subject, topics: form.topics,
        grade: form.matchGrade && s.grade ? s.grade : null, question_count: Number(form.count),
        opens_at: opens.toISOString(), closes_at: closes.toISOString(), max_exits: 3,
      }))));
      setSaved(`Test set for ${chosen.length} student${chosen.length > 1 ? 's' : ''}. They’ll see it in their portal.`);
      setForm((f) => ({ ...f, title: '' }));
      await reload();
    });
  };

  return <form className="card form" onSubmit={submit}>
    <h2 className="card-title"><ShieldPlus size={20}/>Set a test</h2>
    <fieldset className="checks"><legend>For</legend>
      {students.map((s) => <label key={s.id} className={form.studentIds.includes(s.id) ? 'check checked' : 'check'}><input type="checkbox" checked={form.studentIds.includes(s.id)} onChange={() => toggle('studentIds', s.id)}/>{s.full_name}{s.grade ? ` · ${s.grade}` : ''}</label>)}
    </fieldset>
    <label>Title<input value={form.title} onChange={set('title')} required maxLength={150} placeholder="e.g. Algebra check, week 3"/></label>
    <div className="grid-2">
      <label>Subject<select value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value, topics: [] }))}>{subjects.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>Number of questions<select value={form.count} onChange={set('count')}>{[5, 8, 10, 12, 15, 20, 25, 30].map((n) => <option key={n} value={n}>{n} questions</option>)}</select></label>
    </div>
    {topics.length > 0 && <fieldset className="checks"><legend>Topics <span className="optional">(none ticked = all topics)</span></legend>
      {topics.map((t) => <label key={t} className={form.topics.includes(t) ? 'check checked' : 'check'}><input type="checkbox" checked={form.topics.includes(t)} onChange={() => toggle('topics', t)}/>{t}</label>)}
    </fieldset>}
    <label className="inline-check"><input type="checkbox" checked={form.matchGrade} onChange={(e) => setForm((f) => ({ ...f, matchGrade: e.target.checked }))}/>Only use questions for each student’s grade (plus “any grade” questions)</label>
    <div className="grid-2">
      <label>Opens <span className="optional">(your time)</span><input type="datetime-local" value={form.opens} onChange={set('opens')} required/></label>
      <label>Closes <span className="optional">(answers shown after)</span><input type="datetime-local" value={form.closes} onChange={set('closes')} required/></label>
    </div>
    {pools.length > 0 && <div className="pool-check">
      {pools.map(({ s, pool }) => {
        const by = [1, 2, 3].map((d) => pool.filter((q) => q.difficulty === d).length);
        const short = pool.length < Number(form.count);
        return <p key={s.id} className={short ? 'pool-short' : ''}>{short ? <X size={15}/> : <Check size={15}/>}<strong>{s.full_name}:</strong> {pool.length} matching questions ({by[0]} easy, {by[1]} medium, {by[2]} hard){short ? `. The test will end after ${pool.length}.` : ''}</p>;
      })}
    </div>}
    <p className="hint">Students get 3 warnings for leaving full screen; the 3rd exit submits the test.</p>
    <Notice>{error}</Notice>
    <Notice kind="success">{saved}</Notice>
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set test'}</button>
  </form>;
}

function AttemptDetail({ attempt }) {
  const [rows, setRows] = useState(null);
  const { error, run } = useAction();
  React.useEffect(() => {
    run(async () => setRows(must(await supabase.from('attempt_answers').select('*, questions(prompt, kind, options, correct_option, correct_number)').eq('attempt_id', attempt.id).order('position'))));
  }, [attempt.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Notice>{error}</Notice>;
  if (!rows) return <p className="muted small">Loading answers…</p>;
  return <table className="answers-table">
    <thead><tr><th>#</th><th>Level</th><th>Question</th><th>Answer</th><th>Time</th></tr></thead>
    <tbody>{rows.map((r) => {
      const q = r.questions;
      const given = q.kind === 'mcq' ? (r.given_option != null ? q.options[r.given_option] : null) : r.given_number;
      const correct = q.kind === 'mcq' ? q.options[q.correct_option] : q.correct_number;
      const secs = r.answered_at ? Math.round((new Date(r.answered_at) - new Date(r.asked_at)) / 1000) : null;
      return <tr key={r.id} className={r.is_correct ? 'right' : r.is_correct === false ? 'wrong' : ''}>
        <td>{r.position}</td>
        <td><span className={`badge level-${r.difficulty}`}>{LEVELS[r.difficulty]}</span></td>
        <td className="answers-prompt">{q.prompt}</td>
        <td>{r.is_correct == null ? <span className="muted">In progress</span> : r.is_correct ? <><Check size={14}/> {String(given)}</> : <><X size={14}/> {given == null ? (r.timed_out ? 'Time ran out' : '—') : String(given)}<br/><span className="muted small">Correct: {String(correct)}</span></>}</td>
        <td>{secs != null ? `${secs}s / ${r.time_limit_seconds}s` : r.timed_out ? `— / ${r.time_limit_seconds}s` : ''}</td>
      </tr>;
    })}</tbody>
  </table>;
}

function TestItem({ test, student, reload, now }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  const a = firstOf(test.test_attempts);
  const pct = a?.finished_at && Number(a.max_points) ? Math.round((Number(a.points) / Number(a.max_points)) * 100) : null;
  const opens = new Date(test.opens_at).getTime(), closes = new Date(test.closes_at).getTime();
  const status = a?.finished_at ? <span className="badge badge-success">{pct}%</span>
    : a ? <span className="badge badge-accent">In progress</span>
    : now < opens ? <span className="badge badge-muted">Opens {dateTimeLabel(test.opens_at)}</span>
    : now > closes ? <span className="badge badge-warn">Missed</span>
    : <span className="badge badge-muted">Not started</span>;
  const retake = () => { if (confirm(`Delete ${student?.full_name ?? 'the student'}’s attempt so they can take “${test.title}” again?`)) run(async () => { must(await supabase.from('test_attempts').delete().eq('id', a.id)); await reload(); }); };
  const remove = () => { if (confirm(`Delete the test “${test.title}” for ${student?.full_name ?? 'this student'}? Their result will be deleted too.`)) run(async () => { must(await supabase.from('tests').delete().eq('id', test.id)); await reload(); }); };
  return <li className="hw-item">
    <button className="hw-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="hw-main"><strong>{test.title}</strong><span className="muted small">{student?.full_name ?? 'Removed student'} · {test.subject}{test.topics.length ? ` (${test.topics.join(', ')})` : ''} · {test.question_count} Qs</span></span>
      {a?.exits > 0 && <span className="badge badge-warn" title="Times the student left full screen or switched apps">Left {a.exits}×</span>}
      {status}
      <ChevronDown size={18} className={open ? 'chev open' : 'chev'}/>
    </button>
    {open && <div className="hw-detail">
      <p className="muted small">Open {dateTimeLabel(test.opens_at)} → {dateTimeLabel(test.closes_at)}{test.grade ? ` · grade: ${test.grade}` : ''}</p>
      {a?.finished_at && <div className="result-line">
        <strong>{pct}%</strong>
        <span>{a.correct_count}/{a.asked_count} correct · {a.points}/{a.max_points} points · hardest level reached: {LEVELS[a.current_difficulty]}</span>
        {a.finish_reason === 'exits' && <span className="badge badge-warn">Auto-submitted after {a.exits} exits</span>}
        {a.finish_reason === 'no_questions' && <span className="badge badge-warn">No questions matched</span>}
      </div>}
      {a && <AttemptDetail attempt={a}/>}
      <Notice>{error}</Notice>
      <div className="row">
        {a && <button className="link-btn" onClick={retake} disabled={busy}><RotateCcw size={15}/>Allow a retake</button>}
        <button className="link-btn danger" onClick={remove} disabled={busy}><Trash2 size={15}/>Delete test</button>
      </div>
    </div>}
  </li>;
}

export default function TeacherTests({ students, questions, tests, reload, now }) {
  const byId = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students]);
  const [filter, setFilter] = useState('');
  const visible = filter ? tests.filter((t) => t.student_id === filter) : tests;
  return <div className="split">
    <CreateTest students={students} questions={questions} reload={reload}/>
    <section className="card">
      <div className="card-head">
        <h2 className="card-title"><ClipboardList size={20}/>Tests &amp; results</h2>
        {students.length > 1 && <select className="select-small" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show tests for"><option value="">All students</option>{students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>}
      </div>
      {visible.length ? <ul className="hw-list">{visible.map((t) => <TestItem key={t.id} test={t} student={byId[t.student_id]} reload={reload} now={now}/>)}</ul>
        : <Empty icon={ClipboardList} title="No tests yet">Tests you set will show here with each student’s score.</Empty>}
    </section>
  </div>;
}
