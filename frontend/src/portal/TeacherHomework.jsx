import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, ClipboardCheck, FilePlus2, Inbox, Trash2 } from 'lucide-react';
import { ACCEPTED_FILES, checkFile, must, supabase, uploadFile } from './supabase';
import { Empty, FileLink, Notice, useAction } from './shared';
import { dateTimeLabel } from './time';

const SUBJECTS = ['Maths', 'Science', 'Physics', 'Chemistry', 'Biology'];

function AssignForm({ students, reload }) {
  const [form, setForm] = useState({ studentIds: [], subject: 'Maths', title: '', instructions: '', due: '' });
  const fileInput = useRef(null);
  const { busy, error, setError, run } = useAction();
  const [saved, setSaved] = useState('');
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));
  const toggle = (id) => setForm((f) => ({ ...f, studentIds: f.studentIds.includes(id) ? f.studentIds.filter((x) => x !== id) : [...f.studentIds, id] }));

  const submit = (event) => {
    event.preventDefault();
    setSaved('');
    if (!form.studentIds.length) { setError('Tick at least one student.'); return; }
    const file = fileInput.current.files[0];
    if (file) { const problem = checkFile(file); if (problem) { setError(problem); return; } }
    run(async () => {
      const rows = [];
      for (const studentId of form.studentIds) {
        rows.push({
          student_id: studentId,
          subject: form.subject.trim(),
          title: form.title.trim(),
          instructions: form.instructions.trim() || null,
          due_at: form.due ? new Date(form.due).toISOString() : null,
          attachment_path: file ? await uploadFile(`${studentId}/assignments`, file) : null,
        });
      }
      must(await supabase.from('homework').insert(rows));
      setSaved(`Homework set for ${rows.length} student${rows.length > 1 ? 's' : ''}.`);
      setForm((f) => ({ ...f, title: '', instructions: '', due: '' }));
      fileInput.current.value = '';
      await reload();
    });
  };

  if (!students.length) return <Empty icon={FilePlus2} title="Add a student first">Create a student login in the Students tab, then set homework here.</Empty>;

  return <form className="card form" onSubmit={submit}>
    <h2 className="card-title"><FilePlus2 size={20}/>Set homework</h2>
    <fieldset className="checks"><legend>For</legend>
      {students.map((s) => <label key={s.id} className={form.studentIds.includes(s.id) ? 'check checked' : 'check'}><input type="checkbox" checked={form.studentIds.includes(s.id)} onChange={() => toggle(s.id)}/>{s.full_name}</label>)}
    </fieldset>
    <div className="grid-2">
      <label>Subject<input value={form.subject} onChange={set('subject')} list="hw-subject-list" required maxLength={60}/></label>
      <label>Due <span className="optional">(your time, optional)</span><input type="datetime-local" value={form.due} onChange={set('due')}/></label>
    </div>
    <datalist id="hw-subject-list">{SUBJECTS.map((s) => <option key={s} value={s}/>)}</datalist>
    <label>Title<input value={form.title} onChange={set('title')} placeholder="e.g. Fractions worksheet 3" required maxLength={150}/></label>
    <label>Instructions <span className="optional">(optional)</span><textarea value={form.instructions} onChange={set('instructions')} rows={3} maxLength={3000} placeholder="e.g. Do questions 1–10. Show your working."/></label>
    <label>Worksheet <span className="optional">(optional PDF or photo, max 10 MB)</span><input ref={fileInput} type="file" accept={ACCEPTED_FILES}/></label>
    <Notice>{error}</Notice>
    <Notice kind="success">{saved}</Notice>
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set homework'}</button>
  </form>;
}

function MarkForm({ hw, reload, onDone }) {
  const [score, setScore] = useState(hw.score ?? '');
  const [outOf, setOutOf] = useState(hw.out_of ?? '');
  const [feedback, setFeedback] = useState(hw.feedback ?? '');
  const { busy, error, run } = useAction();
  const submit = (event) => {
    event.preventDefault();
    run(async () => {
      must(await supabase.from('homework').update({
        score: score === '' ? null : Number(score),
        out_of: outOf === '' ? null : Number(outOf),
        feedback: feedback.trim() || null,
        marked_at: new Date().toISOString(),
      }).eq('id', hw.id));
      onDone?.();
      await reload();
    });
  };
  return <form className="form mark-form" onSubmit={submit}>
    <div className="grid-2 narrow">
      <label>Score<input type="number" min="0" step="any" value={score} onChange={(e) => setScore(e.target.value)} placeholder="e.g. 8"/></label>
      <label>Out of<input type="number" min="0.5" step="any" value={outOf} onChange={(e) => setOutOf(e.target.value)} placeholder="e.g. 10"/></label>
    </div>
    <label>Feedback for the student<textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={3000} placeholder="What went well, and what to work on next."/></label>
    <Notice>{error}</Notice>
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : hw.marked_at ? 'Update marks' : 'Save marks'}</button>
  </form>;
}

function HomeworkItem({ hw, student, reload }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  const sub = hw.submission;
  const overdue = !sub && !hw.marked_at && hw.due_at && new Date(hw.due_at) < new Date();
  const remove = () => { if (confirm(`Delete “${hw.title}” for ${student?.full_name ?? 'this student'}? Their answer will be deleted too.`)) run(async () => { must(await supabase.from('homework').delete().eq('id', hw.id)); await reload(); }); };
  return <li className="hw-item">
    <button className="hw-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="hw-main"><strong>{hw.title}</strong><span className="muted small">{student?.full_name ?? 'Removed student'} · {hw.subject}{hw.due_at ? ` · due ${dateTimeLabel(hw.due_at)}` : ''}</span></span>
      {hw.marked_at ? <span className="badge badge-success">{hw.score != null && hw.out_of ? `${hw.score}/${hw.out_of}` : 'Marked'}</span>
        : sub ? <span className="badge badge-accent">Handed in</span>
        : overdue ? <span className="badge badge-warn">Overdue</span>
        : <span className="badge badge-muted">Waiting</span>}
      <ChevronDown size={18} className={open ? 'chev open' : 'chev'}/>
    </button>
    {open && <div className="hw-detail">
      {hw.instructions && <p className="pre">{hw.instructions}</p>}
      {hw.attachment_path && <p className="file-row"><span className="muted small">Worksheet:</span><FileLink path={hw.attachment_path}/></p>}
      {sub ? <div className="submission">
        <span className="muted small">Handed in {dateTimeLabel(sub.submitted_at)}</span>
        {sub.note && <p className="pre">“{sub.note}”</p>}
        <div className="file-list">{sub.file_paths.map((p) => <FileLink key={p} path={p}/>)}</div>
      </div> : <p className="muted small">Not handed in yet. You can still mark it if it was done in class.</p>}
      {hw.marked_at && !editing ? <div className="marks">
        <strong>{hw.score != null && hw.out_of ? `Score: ${hw.score} / ${hw.out_of}` : 'Marked'}</strong>
        {hw.feedback && <p className="pre">{hw.feedback}</p>}
        <button className="link-btn" onClick={() => setEditing(true)}>Edit marks</button>
      </div> : <MarkForm hw={hw} reload={reload} onDone={() => setEditing(false)}/>}
      <Notice>{error}</Notice>
      <button className="link-btn danger" onClick={remove} disabled={busy}><Trash2 size={15}/>Delete homework</button>
    </div>}
  </li>;
}

export default function TeacherHomework({ students, homework, reload }) {
  const byId = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students]);
  const [filter, setFilter] = useState('');
  const visible = filter ? homework.filter((h) => h.student_id === filter) : homework;
  const groups = [
    { title: 'Handed in, ready to mark', items: visible.filter((h) => h.submission && !h.marked_at), empty: 'Nothing to mark right now.' },
    { title: 'Waiting for the student', items: visible.filter((h) => !h.submission && !h.marked_at), empty: 'No homework waiting.' },
    { title: 'Marked', items: visible.filter((h) => h.marked_at).slice(0, 30), empty: 'Nothing marked yet.' },
  ];
  return <div className="split">
    <AssignForm students={students} reload={reload}/>
    <section className="card">
      <div className="card-head">
        <h2 className="card-title"><ClipboardCheck size={20}/>Homework</h2>
        {students.length > 1 && <select className="select-small" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show homework for"><option value="">All students</option>{students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>}
      </div>
      {groups.map((g) => <div key={g.title} className="day-group">
        <h3>{g.title} <span className="count">{g.items.length}</span></h3>
        {g.items.length ? <ul className="hw-list">{g.items.map((h) => <HomeworkItem key={h.id} hw={h} student={byId[h.student_id]} reload={reload}/>)}</ul> : <p className="muted small empty-line"><Inbox size={15}/>{g.empty}</p>}
      </div>)}
    </section>
  </div>;
}
