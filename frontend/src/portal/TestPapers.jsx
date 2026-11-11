import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ClipboardList, Copy, FilePlus2, Lightbulb, Lock, Pencil, PenLine, RotateCcw, Send, Shuffle, Trash2, Upload, Video, X } from 'lucide-react';
import { firstOf, must, supabase } from './supabase';
import { Empty, FileLink, Notice, TEST_SUBJECTS, useAction } from './shared';
import { dateTimeLabel, timeLabel as timeOnly } from './time';
import { QuestionForm, QuestionRow } from './PaperQuestions';
import ImportQuestions from './ImportQuestions';

// A "test" (paper) owns its questions. Giving it to a student creates a row in `tests`.

const toInput = (date) => {
  const d = new Date(date); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const pct = (a) => (Number(a?.max_points) ? Math.round((Number(a.points) / Number(a.max_points)) * 100) : 0);

// ─── Create ────────────────────────────────────────────────────────────────
function NewPaper({ students, onCreated }) {
  const [form, setForm] = useState({ title: '', subject: 'Maths', grade: '' });
  const { busy, error, run } = useAction();
  const grades = [...new Set(students.map((s) => s.grade).filter(Boolean))].sort();
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const submit = (event) => {
    event.preventDefault();
    run(async () => {
      const row = must(await supabase.from('papers').insert({ title: form.title.trim(), subject: form.subject.trim(), grade: form.grade.trim() || null }).select().single());
      await onCreated(row.id);
    });
  };
  return <form className="card form" onSubmit={submit}>
    <h2 className="card-title"><FilePlus2 size={20}/>New test</h2>
    <p className="hint">Name it, then add its questions (type them, or upload a spreadsheet or PDF), then give it to students.</p>
    <label>Test name<input value={form.title} onChange={set('title')} required maxLength={150} placeholder="e.g. Fractions worksheet 3"/></label>
    <div className="grid-2">
      <label>Subject<input value={form.subject} onChange={set('subject')} list="paper-subjects" required maxLength={60}/></label>
      <label>Grade <span className="optional">(optional)</span><input value={form.grade} onChange={set('grade')} list="paper-grades" maxLength={60} placeholder="e.g. Year 9"/></label>
    </div>
    <datalist id="paper-subjects">{TEST_SUBJECTS.map((s) => <option key={s} value={s}/>)}</datalist>
    <datalist id="paper-grades">{grades.map((g) => <option key={g} value={g}/>)}</datalist>
    <Notice>{error}</Notice>
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create test and add questions'}</button>
  </form>;
}

// ─── Results ───────────────────────────────────────────────────────────────
function MarkWritten({ row, onMarked }) {
  const max = row.questions.marks;
  const [awarded, setAwarded] = useState(row.awarded ?? '');
  const [comment, setComment] = useState(row.teacher_comment ?? '');
  const { busy, error, run } = useAction();
  const save = (event) => {
    event.preventDefault();
    run(async () => {
      const { error: rpcError } = await supabase.rpc('mark_written', { p_answer: row.id, p_awarded: Number(awarded), p_comment: comment });
      if (rpcError) throw new Error(rpcError.message);
      await onMarked();
    });
  };
  return <form className="mark-written" onSubmit={save}>
    <label>Marks<span className="marks-input"><input type="number" min="0" max={max} step="0.5" value={awarded} onChange={(e) => setAwarded(e.target.value)} required/> / {max}</span></label>
    <label>Comment for the student <span className="optional">(optional)</span><input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="e.g. Good method, check your units."/></label>
    <button className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Saving…' : row.marked_at ? 'Update mark' : 'Save mark'}</button>
    {error && <span className="error-text">{error}</span>}
  </form>;
}

function AttemptDetail({ attempt, reload }) {
  const [rows, setRows] = useState(null);
  const { error, run } = useAction();
  const load = () => run(async () => setRows(must(await supabase.from('attempt_answers').select('*, questions(prompt, kind, options, correct_option, correct_number, marks, explanation)').eq('attempt_id', attempt.id).order('position'))));
  React.useEffect(() => { load(); }, [attempt.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Notice>{error}</Notice>;
  if (!rows) return <p className="muted small">Loading answers…</p>;
  const written = rows.filter((r) => r.questions.kind === 'written' && r.answered_at && !r.timed_out);
  return <div className="stack">
    {written.length > 0 && <div className="written-answers">
      <h4>Written answers to mark</h4>
      {written.map((r) => <div key={r.id} className={`written-answer ${r.marked_at ? 'marked' : 'pending'}`}>
        <p className="small"><strong>Q{r.position}.</strong> {r.questions.prompt}</p>
        {r.given_text && <p className="pre student-text">{r.given_text}</p>}
        {r.given_files?.length > 0 && <div className="file-list">{r.given_files.map((f) => <FileLink key={f} path={f}/>)}</div>}
        {r.questions.explanation && <details className="model-answer"><summary>Model answer / marking points</summary><p className="pre small">{r.questions.explanation}</p></details>}
        <MarkWritten row={r} onMarked={async () => { load(); await reload(); }}/>
      </div>)}
    </div>}
    <table className="answers-table">
      <thead><tr><th>#</th><th>Question</th><th>Answer</th><th>Time</th></tr></thead>
      <tbody>{rows.map((r) => {
        const q = r.questions;
        const given = q.kind === 'mcq' ? (r.given_option != null ? q.options[r.given_option] : null) : r.given_number;
        const correct = q.kind === 'mcq' ? q.options[q.correct_option] : q.correct_number;
        const secs = r.answered_at ? Math.round((new Date(r.answered_at) - new Date(r.asked_at)) / 1000) : null;
        const cell = q.kind === 'written'
          ? (r.timed_out ? <><X size={14}/> No answer</> : r.marked_at ? <>{Number(r.awarded)} / {q.marks} marks</> : <span className="badge badge-warn">To mark</span>)
          : r.is_correct == null ? <span className="muted">In progress</span>
          : r.is_correct ? <><Check size={14}/> {String(given)}</>
          : <><X size={14}/> {given == null ? (r.timed_out ? 'Time ran out' : '—') : String(given)}<br/><span className="muted small">Correct: {String(correct)}</span></>;
        return <tr key={r.id} className={q.kind === 'written' ? '' : r.is_correct ? 'right' : r.is_correct === false ? 'wrong' : ''}>
          <td>{r.position}</td>
          <td className="answers-prompt">{q.prompt}</td>
          <td>{cell}</td>
          <td>{secs != null ? `${secs}s / ${r.time_limit_seconds}s` : r.timed_out ? `— / ${r.time_limit_seconds}s` : ''}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

// ─── What to reteach ───────────────────────────────────────────────────────
function ReteachReport({ questions, tests }) {
  const [rows, setRows] = useState(null);
  const { error, run } = useAction();
  const attemptIds = tests.map((t) => firstOf(t.test_attempts)).filter((a) => a?.finished_at).map((a) => a.id);
  const key = attemptIds.join(',');
  React.useEffect(() => {
    if (!attemptIds.length) { setRows([]); return; }
    run(async () => setRows(must(await supabase.from('attempt_answers').select('question_id, is_correct, given_option, timed_out, awarded, answered_at').in('attempt_id', attemptIds))));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Notice>{error}</Notice>;
  if (!rows) return <p className="muted small">Working it out…</p>;
  if (!attemptIds.length) return <p className="muted small">Appears once a student finishes this test.</p>;
  const stats = questions.map((q, i) => {
    const answers = rows.filter((r) => r.question_id === q.id && (r.is_correct !== null || r.timed_out));
    const wrong = answers.filter((r) => r.is_correct === false);
    let commonWrong = null;
    if (q.kind === 'mcq') {
      const counts = {};
      wrong.forEach((r) => { if (r.given_option != null) counts[r.given_option] = (counts[r.given_option] ?? 0) + 1; });
      const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
      if (top && top[1] > 1) commonWrong = `${top[1]} chose “${q.options[top[0]]}”`;
    }
    const timedOut = wrong.filter((r) => r.timed_out).length;
    return { q, n: i + 1, total: answers.length, wrong: wrong.length, rate: answers.length ? wrong.length / answers.length : 0, commonWrong, timedOut };
  }).filter((x) => x.total > 0);
  const tough = stats.filter((x) => x.rate >= 0.5).sort((x, y) => y.rate - x.rate || y.wrong - x.wrong);
  const shown = tough.length ? tough : [...stats].sort((x, y) => y.rate - x.rate).slice(0, 5).filter((x) => x.wrong > 0);
  const finished = attemptIds.length;
  const intro = tough.length
    ? `${tough.length} question${tough.length > 1 ? 's were' : ' was'} got wrong by half or more of them. Start the next class here:`
    : shown.length ? 'No question was missed by half the students. The ones missed most:' : 'Everyone got every question right. 🎉';
  return <div className="reteach">
    <p className="hint">{finished} student{finished > 1 ? 's' : ''} finished. {intro}</p>
    {shown.length > 0 && <ol className="reteach-list">{shown.map((x) => <li key={x.q.id}>
      <span className="reteach-rate" style={{ '--rate': `${Math.round(x.rate * 100)}%` }}><strong>{x.wrong}/{x.total}</strong> wrong</span>
      <span><strong>Q{x.n}.</strong> {x.q.prompt.length > 140 ? `${x.q.prompt.slice(0, 140)}…` : x.q.prompt}
        {(x.commonWrong || x.timedOut > 0) && <span className="muted small"> · {[x.commonWrong, x.timedOut ? `${x.timedOut} ran out of time` : null].filter(Boolean).join(' · ')}</span>}
        {x.q.topic && <span className="badge badge-muted">{x.q.topic}</span>}</span>
    </li>)}</ol>}
  </div>;
}

// ─── Camera & microphone monitoring ────────────────────────────────────────
const FLAG_LABEL = { no_face: 'Face not visible', multiple_faces: 'More than one person in view', camera_off: 'Camera turned off', talking: 'Talking heard', mic_off: 'Microphone turned off' };
const flagCount = (a) => Object.values(a?.monitor_summary ?? {}).reduce((s, n) => s + Number(n || 0), 0);

function MonitorReport({ attempt }) {
  const [flags, setFlags] = useState(null);
  const { error, run } = useAction();
  React.useEffect(() => {
    run(async () => setFlags(must(await supabase.from('attempt_flags').select('kind, seconds, question_position, created_at').eq('attempt_id', attempt.id).order('created_at'))));
  }, [attempt.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = flagCount(attempt);
  const summary = Object.entries(attempt.monitor_summary ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${FLAG_LABEL[k] ?? k} ×${n}`).join(' · ');
  return <div className="monitor-report">
    <h4><Video size={16}/>Camera & microphone</h4>
    {!attempt.monitoring_agreed_at && !total ? <p className="muted small">Monitoring was not on for this attempt.</p>
      : !total ? <p className="small monitor-clean"><Check size={15}/> Camera and microphone were on the whole time. Nothing unusual.</p>
      : <>
        <p className="small"><strong>{total} flag{total > 1 ? 's' : ''}:</strong> {summary}</p>
        <Notice>{error}</Notice>
        {flags === null ? <p className="muted small">Loading…</p>
          : flags.length ? <ul className="flag-list">{flags.map((f, i) => <li key={i}>
              <span className="muted small">{timeOnly(f.created_at)}{f.question_position ? ` · Q${f.question_position}` : ''}</span>
              <span>{FLAG_LABEL[f.kind] ?? f.kind}{f.seconds ? ` for ${f.seconds} s` : ''}</span>
            </li>)}</ul>
          : <p className="muted small">The detailed times were deleted after 10 days.</p>}
        <p className="hint">Flags are hints, not proof: poor lighting or leaning back can hide a face, and family noise can sound like talking.</p>
      </>}
  </div>;
}

function ResultItem({ test, student, reload, now }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  const a = firstOf(test.test_attempts);
  const opens = new Date(test.opens_at).getTime(), closes = new Date(test.closes_at).getTime();
  const status = a?.finished_at && a.pending_marks > 0 ? <span className="badge badge-warn">{a.pending_marks} to mark</span>
    : a?.finished_at ? <span className="badge badge-success">{pct(a)}%</span>
    : a ? <span className="badge badge-accent">In progress</span>
    : now < opens ? <span className="badge badge-muted">Opens {dateTimeLabel(test.opens_at)}</span>
    : now > closes ? <span className="badge badge-warn">Missed</span>
    : <span className="badge badge-muted">Not started</span>;
  const retake = () => { if (confirm(`Delete ${student?.full_name ?? 'the student'}’s attempt so they can take it again?`)) run(async () => { must(await supabase.from('test_attempts').delete().eq('id', a.id)); await reload(); }); };
  const remove = () => { if (confirm(`Take this test away from ${student?.full_name ?? 'this student'}? Their result will be deleted.`)) run(async () => { must(await supabase.from('tests').delete().eq('id', test.id)); await reload(); }); };
  return <li className="hw-item">
    <button className="hw-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="hw-main"><strong>{student?.full_name ?? 'Removed student'}</strong><span className="muted small">open {dateTimeLabel(test.opens_at)} → {dateTimeLabel(test.closes_at)}</span></span>
      {a?.exits > 0 && <span className="badge badge-warn" title="Times the student left full screen or switched apps">Left {a.exits}×</span>}
      {flagCount(a) > 0 && <span className="badge badge-warn" title="Camera & microphone flags"><Video size={12}/>{flagCount(a)}</span>}
      {status}
      <ChevronDown size={18} className={open ? 'chev open' : 'chev'}/>
    </button>
    {open && <div className="hw-detail">
      {a?.finished_at && <div className="result-line">
        <strong>{pct(a)}%</strong>
        <span>{Number(a.points)} of {Number(a.max_points)} marks{a.pending_marks > 0 ? ` so far (${a.pending_marks} written answer${a.pending_marks > 1 ? 's' : ''} to mark)` : ''}</span>
        {a.finish_reason === 'exits' && <span className="badge badge-warn">Auto-submitted after {a.exits} exits</span>}
      </div>}
      {a && test.monitoring && <MonitorReport attempt={a}/>}
      {a && <AttemptDetail attempt={a} reload={reload}/>}
      <Notice>{error}</Notice>
      <div className="row">
        {a && <button className="link-btn" onClick={retake} disabled={busy}><RotateCcw size={15}/>Allow a retake</button>}
        <button className="link-btn danger" onClick={remove} disabled={busy}><Trash2 size={15}/>Take test away</button>
      </div>
    </div>}
  </li>;
}

// ─── Give to students ──────────────────────────────────────────────────────
function AssignForm({ paper, count, students, assigned, reload }) {
  const [form, setForm] = useState({ studentIds: [], opens: toInput(Date.now()), closes: toInput(Date.now() + 7 * 86400000) });
  const { busy, error, setError, run } = useAction();
  const [saved, setSaved] = useState('');
  const toggle = (id) => setForm((f) => ({ ...f, studentIds: f.studentIds.includes(id) ? f.studentIds.filter((x) => x !== id) : [...f.studentIds, id] }));
  const submit = (event) => {
    event.preventDefault();
    setSaved('');
    if (!form.studentIds.length) { setError('Tick at least one student.'); return; }
    const opens = new Date(form.opens), closes = new Date(form.closes);
    if (!(closes > opens)) { setError('The closing time must be after the opening time.'); return; }
    run(async () => {
      must(await supabase.from('tests').insert(form.studentIds.map((id) => ({
        student_id: id, paper_id: paper.id, title: paper.title, subject: paper.subject, topics: [], grade: paper.grade,
        question_count: count, opens_at: opens.toISOString(), closes_at: closes.toISOString(), max_exits: 3, monitoring: paper.monitoring ?? false,
      }))));
      setSaved(`Given to ${form.studentIds.length} student${form.studentIds.length > 1 ? 's' : ''}. They’ll see it in their portal.`);
      setForm((f) => ({ ...f, studentIds: [] }));
      await reload();
    });
  };
  if (!count) return <p className="muted small">Add questions first, then you can give this test to students.</p>;
  if (!students.length) return <p className="muted small">Add a student in the Students tab first.</p>;
  return <form className="form" onSubmit={submit}>
    <fieldset className="checks"><legend>Students</legend>
      {students.map((s) => <label key={s.id} className={form.studentIds.includes(s.id) ? 'check checked' : 'check'}><input type="checkbox" checked={form.studentIds.includes(s.id)} onChange={() => toggle(s.id)}/>{s.full_name}{assigned.has(s.id) ? ' (has it already)' : ''}</label>)}
    </fieldset>
    <div className="grid-2">
      <label>Opens <span className="optional">(your time)</span><input type="datetime-local" value={form.opens} onChange={(e) => setForm((f) => ({ ...f, opens: e.target.value }))} required/></label>
      <label>Closes <span className="optional">(answers shown after)</span><input type="datetime-local" value={form.closes} onChange={(e) => setForm((f) => ({ ...f, closes: e.target.value }))} required/></label>
    </div>
    <p className="hint">All {count} questions, in your order, one at a time with their timers. Leaving full screen 3 times submits the test.</p>
    <Notice>{error}</Notice>
    <Notice kind="success">{saved}</Notice>
    <button className="btn btn-primary" disabled={busy}><Send size={16}/>{busy ? 'Saving…' : 'Give test'}</button>
  </form>;
}

// ─── One test ──────────────────────────────────────────────────────────────
function PaperView({ paper, questions, tests, students, reload, now, onBack, onOpen }) {
  const byId = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students]);
  const [adding, setAdding] = useState('one'); // 'one' | 'file'
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(paper.title);
  const [notice, setNotice] = useState('');
  const { busy, error, run } = useAction();
  const locked = tests.some((t) => firstOf(t.test_attempts));
  const nextPosition = (questions.at(-1)?.position ?? 0) + 1;
  const givenTo = new Set(tests.map((t) => t.student_id)).size;

  const move = (index, dir) => run(async () => {
    const a = questions[index], b = questions[index + dir];
    must(await supabase.from('questions').update({ position: b.position }).eq('id', a.id));
    must(await supabase.from('questions').update({ position: a.position }).eq('id', b.id));
    await reload();
  });
  const removeQuestion = (q, i) => { if (confirm(`Remove question ${i + 1}?`)) run(async () => { must(await supabase.from('questions').delete().eq('id', q.id)); await reload(); }); };
  const rename = (event) => { event.preventDefault(); run(async () => { must(await supabase.from('papers').update({ title: title.trim() }).eq('id', paper.id)); must(await supabase.from('tests').update({ title: title.trim() }).eq('paper_id', paper.id)); setRenaming(false); await reload(); }); };
  const duplicate = () => run(async () => {
    const copy = must(await supabase.from('papers').insert({ title: `${paper.title} (copy)`.slice(0, 150), subject: paper.subject, grade: paper.grade, shuffle_questions: paper.shuffle_questions ?? false, monitoring: paper.monitoring ?? false }).select().single());
    if (questions.length) must(await supabase.from('questions').insert(questions.map(({ id, created_at, paper_id, ...q }) => ({ ...q, paper_id: copy.id }))));
    await reload();
    onOpen(copy.id);
  });
  const removePaper = () => { if (confirm(`Delete “${paper.title}”? Its ${questions.length} questions and all ${tests.length} student results will be deleted. This can’t be undone.`)) run(async () => { must(await supabase.from('papers').delete().eq('id', paper.id)); await reload(); onBack(); }); };

  // Once a test has questions, giving it to students is the main next step, so it goes first.
  const giveAndResults = <>
    <section className="card give-card" id="give-test">
      <h2 className="card-title"><Send size={20}/>Give this test to students</h2>
      <AssignForm paper={paper} count={questions.length} students={students} assigned={new Set(tests.map((t) => t.student_id))} reload={reload}/>
    </section>
    <section className="card">
      <h2 className="card-title"><Lightbulb size={20}/>What to reteach</h2>
      <ReteachReport questions={questions} tests={tests}/>
    </section>
    <section className="card">
      <h2 className="card-title"><Check size={20}/>Results</h2>
      {tests.length ? <ul className="hw-list">{tests.map((t) => <ResultItem key={t.id} test={t} student={byId[t.student_id]} reload={reload} now={now}/>)}</ul>
        : <p className="muted small">Not given to anyone yet.</p>}
    </section>
  </>;

  return <div className="stack-lg">
    <div className="paper-head">
      <button className="link-btn" onClick={onBack}><ArrowLeft size={16}/>All tests</button>
      {renaming ? <form className="rename" onSubmit={rename}><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required aria-label="Test name" autoFocus/><button className="btn btn-primary btn-small" disabled={busy}>Save</button><button type="button" className="link-btn" onClick={() => { setRenaming(false); setTitle(paper.title); }}>Cancel</button></form>
        : <h2 className="paper-title">{paper.title}<button className="icon-btn" onClick={() => setRenaming(true)} aria-label="Rename test" title="Rename"><PenLine size={16}/></button></h2>}
      <p className="muted">{paper.subject}{paper.grade ? ` · ${paper.grade}` : ''} · {questions.length} question{questions.length === 1 ? '' : 's'} · given to {givenTo} student{givenTo === 1 ? "" : "s"}</p>
      <div className="row">
        {questions.length > 0 && <button className="btn btn-primary btn-small" onClick={() => { const el = document.getElementById('give-test'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.querySelector('input')?.focus({ preventScroll: true }); }}><Send size={15}/>Give to students</button>}
        <label className="inline-check shuffle-toggle" title="Each student gets the questions in a different random order"><input type="checkbox" checked={paper.shuffle_questions ?? false} disabled={busy} onChange={(e) => run(async () => { must(await supabase.from('papers').update({ shuffle_questions: e.target.checked }).eq('id', paper.id)); await reload(); })}/><Shuffle size={15}/>Shuffle order for each student</label>
        <label className="inline-check shuffle-toggle" title="Students must turn on camera & microphone; nothing is recorded, only flags like ‘face not visible for 20 s’"><input type="checkbox" checked={paper.monitoring ?? false} disabled={busy} onChange={(e) => run(async () => { must(await supabase.from('papers').update({ monitoring: e.target.checked }).eq('id', paper.id)); must(await supabase.from('tests').update({ monitoring: e.target.checked }).eq('paper_id', paper.id)); await reload(); })}/><Video size={15}/>Camera & microphone monitoring</label>
        <button className="btn btn-ghost btn-small" onClick={duplicate} disabled={busy}><Copy size={15}/>Duplicate</button>
        <button className="btn btn-ghost btn-small danger-text" onClick={removePaper} disabled={busy}><Trash2 size={15}/>Delete test</button>
      </div>
      <Notice>{error}</Notice>
      <Notice kind="success">{notice}</Notice>
    </div>

    <div className="split">
      <section className="card">
        <h2 className="card-title"><ClipboardList size={20}/>Questions ({questions.length})</h2>
        {locked && <Notice kind="success"><Lock size={15}/> Students have started this test, so its questions are locked to keep results fair. To change them, use <strong>Duplicate</strong> and edit the copy.</Notice>}
        {questions.length ? <ul className="qb-list">{questions.map((q, i) => <QuestionRow key={q.id} q={q} index={i} count={questions.length} locked={locked} busy={busy}
          onEdit={() => { setEditing({ ...q, index: i + 1 }); setAdding('one'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} onMove={(dir) => move(i, dir)} onRemove={() => removeQuestion(q, i)}/>)}</ul>
          : <Empty icon={ClipboardList} title="No questions yet">Add them on the right: type them, or upload a spreadsheet or PDF.</Empty>}
      </section>
      <div className="stack">
        {questions.length > 0 && giveAndResults}
        {!locked && questions.length > 0 && !showAdd && !editing && <button className="btn btn-ghost" onClick={() => setShowAdd(true)}><Pencil size={16}/>Add more questions</button>}
        {!locked && (showAdd || editing || questions.length === 0) && <section className="card">
          {!editing && <div className="segmented-tabs" role="tablist" aria-label="How to add questions">
            <button role="tab" aria-selected={adding === 'one'} className={adding === 'one' ? 'active' : ''} onClick={() => setAdding('one')}><Pencil size={16}/>Type a question</button>
            <button role="tab" aria-selected={adding === 'file'} className={adding === 'file' ? 'active' : ''} onClick={() => setAdding('file')}><Upload size={16}/>Upload a file</button>
          </div>}
          {editing || adding === 'one'
            ? <QuestionForm key={editing?.id ?? `new-${nextPosition}`} paper={paper} editing={editing} nextPosition={nextPosition} reload={reload} onDone={() => setEditing(null)}/>
            : <ImportQuestions paper={paper} nextPosition={nextPosition} reload={reload} onDone={(msg) => { setNotice(msg); if (msg) { setAdding('one'); setShowAdd(false); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}/>}
        </section>}
        {questions.length === 0 && giveAndResults}
      </div>
    </div>
  </div>;
}

// ─── All tests ─────────────────────────────────────────────────────────────
export default function TestPapers({ papers, questions, tests, students, reload, now }) {
  const [openId, setOpenId] = useState(null);
  const paper = papers.find((p) => p.id === openId);
  const questionsOf = (id) => questions.filter((q) => q.paper_id === id && !q.archived).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const testsOf = (id) => tests.filter((t) => t.paper_id === id);
  const open = (id) => { setOpenId(id); window.scrollTo({ top: 0 }); };

  if (paper) return <PaperView key={paper.id} paper={paper} questions={questionsOf(paper.id)} tests={testsOf(paper.id)} students={students} reload={reload} now={now} onBack={() => setOpenId(null)} onOpen={open}/>;

  return <div className="split">
    <NewPaper students={students} onCreated={async (id) => { await reload(); open(id); }}/>
    <section className="card">
      <h2 className="card-title"><ClipboardList size={20}/>Your tests</h2>
      {papers.length ? <ul className="paper-list">{papers.map((p) => {
        const ts = testsOf(p.id);
        const done = ts.filter((t) => firstOf(t.test_attempts)?.finished_at);
        const avg = done.length ? Math.round(done.reduce((s, t) => s + pct(firstOf(t.test_attempts)), 0) / done.length) : null;
        return <li key={p.id}><button className="paper-card" onClick={() => open(p.id)}>
          <span className="paper-main"><strong>{p.title}</strong><span className="muted small">{p.subject}{p.grade ? ` · ${p.grade}` : ''} · {questionsOf(p.id).length} questions</span></span>
          <span className="paper-meta">{ts.length ? <><span>{done.length}/{ts.length} finished</span>{avg !== null && <span className="badge badge-success">avg {avg}%</span>}</> : <span className="badge badge-muted">Not given yet</span>}</span>
        </button></li>;
      })}</ul> : <Empty icon={ClipboardList} title="No tests yet">Create your first test with the form.</Empty>}
    </section>
  </div>;
}
