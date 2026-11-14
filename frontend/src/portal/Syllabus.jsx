import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookMarked, Check, CheckCheck, ChevronDown, Circle, ExternalLink, GraduationCap, Plus, Trash2 } from 'lucide-react';
import { must, supabase } from './supabase';
import { BoardGradeFields } from './boards';
import { Empty, Notice, Spinner, useAction } from './shared';

// ─── Syllabus files (frontend/public/curricula) ───────────────────────────
// Read-only reference data from each exam board's official specification, fetched once and cached.
const cache = new Map();
const getJson = (path) => {
  if (!cache.has(path)) {
    cache.set(path, fetch(`/curricula/${path}`).then((r) => {
      if (!r.ok) throw new Error('The syllabus list couldn’t load. Check your internet connection and try again.');
      return r.json();
    }).catch((error) => { cache.delete(path); throw error; }));
  }
  return cache.get(path);
};
export const loadIndex = () => getJson('index.json').then((d) => d.syllabi);
export async function loadSyllabus(id) {
  const entry = (await loadIndex()).find((s) => s.id === id);
  return entry ? getJson(entry.path) : null; // null: a syllabus that was removed from the portal later
}

const SUBJECT_ORDER = ['Mathematics', 'Additional Mathematics', 'Biology', 'Chemistry', 'Physics', 'Combined Science'];
const bySubject = (a, b) => (SUBJECT_ORDER.indexOf(a.subject) - SUBJECT_ORDER.indexOf(b.subject)) || a.title.localeCompare(b.title);

/** Things that get ticked: sub-topics, or the topic itself when it has none. */
export function checkItems(syllabus) {
  return syllabus.topics.flatMap((t) => (t.subtopics.length ? t.subtopics : [t]).map((s) => ({ ...s, topic: t })));
}

/** { taught, mastered, total, percent } — percent counts taught + mastered as covered. */
export function coverage(syllabus, statuses) {
  const items = checkItems(syllabus);
  const mastered = items.filter((i) => statuses[i.code] === 'mastered').length;
  const taught = items.filter((i) => statuses[i.code] === 'taught').length;
  return { taught, mastered, total: items.length, percent: items.length ? Math.round(((taught + mastered) / items.length) * 100) : 0 };
}

function daysUntil(date) {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}
function ExamCountdown({ date }) {
  const days = daysUntil(date);
  if (days === null) return null;
  const label = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (days < 0) return <span className="badge badge-muted">Exam was {label}</span>;
  if (days === 0) return <span className="badge badge-warn">Exam today — good luck!</span>;
  return <span className={`badge ${days <= 30 ? 'badge-warn' : 'badge-accent'}`}>Exam in {days} day{days === 1 ? '' : 's'} · {label}</span>;
}

function Meter({ cov }) {
  const m = cov.total ? (cov.mastered / cov.total) * 100 : 0;
  const t = cov.total ? (cov.taught / cov.total) * 100 : 0;
  return <div className="syl-meter" role="img" aria-label={`${cov.percent}% covered: ${cov.mastered} mastered and ${cov.taught} taught out of ${cov.total}`}>
    <div className="syl-bar"><span className="syl-bar-mastered" style={{ width: `${m}%` }}/><span className="syl-bar-taught" style={{ width: `${t}%` }}/></div>
    <span className="syl-meter-text"><strong>{cov.percent}%</strong> covered · {cov.mastered} mastered · {cov.taught} taught · {cov.total - cov.mastered - cov.taught} to go</span>
  </div>;
}

const NEXT = { undefined: 'taught', taught: 'mastered', mastered: undefined };
const STATUS_LABEL = { taught: 'Taught', mastered: 'Mastered' };
function StatusIcon({ status }) {
  if (status === 'mastered') return <CheckCheck size={16}/>;
  if (status === 'taught') return <Check size={16}/>;
  return <Circle size={14}/>;
}

/** The topic list. With `onSet` it is the teacher's checklist; without, the student's read-only view. */
function TopicList({ syllabus, statuses, onSet, busyCode }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (code) => setOpen((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });
  let lastGroup = null;
  return <ul className="syl-topics">
    {syllabus.topics.map((t) => {
      const items = t.subtopics.length ? t.subtopics : [t];
      const done = items.filter((i) => statuses[i.code]).length;
      const isOpen = open.has(t.code);
      const groupHead = t.group && t.group !== lastGroup ? (lastGroup = t.group) : null;
      const row = (item, sub) => {
        const status = statuses[item.code];
        const content = <><span className={`syl-status is-${status ?? 'none'}`}><StatusIcon status={status}/></span>
          <span className="syl-item-text"><span className="syl-code">{item.code}</span> {item.title}
            {item.tier && <span className="syl-tier">{item.tier}</span>}
            {item.core_title && <span className="syl-tier">Core: {item.core_title}</span>}</span>
          {status && <span className={`syl-status-label is-${status}`}>{STATUS_LABEL[status]}</span>}</>;
        return onSet
          ? <button type="button" className={`syl-item ${sub ? 'is-sub' : ''}`} onClick={() => onSet(item.code, NEXT[status])} disabled={busyCode === item.code}
              title="Click to mark as taught, click again for mastered, again to clear">{content}</button>
          : <div className={`syl-item ${sub ? 'is-sub' : ''}`}>{content}</div>;
      };
      return <React.Fragment key={t.code}>
        {groupHead && <li className="syl-group">{groupHead}</li>}
        <li className="syl-topic">
          {t.subtopics.length
            ? <>
                <button type="button" className="syl-topic-head" onClick={() => toggle(t.code)} aria-expanded={isOpen}>
                  <ChevronDown size={16} className={isOpen ? 'rot' : ''}/>
                  <span className="syl-item-text"><span className="syl-code">{t.code}</span> <strong>{t.title}</strong>{t.tier && <span className="syl-tier">{t.tier}</span>}</span>
                  <span className={`syl-count ${done === items.length ? 'is-done' : ''}`}>{done}/{items.length}</span>
                </button>
                {isOpen && <div className="syl-subs">
                  {onSet && <div className="syl-bulk">
                    <button type="button" className="link-btn" onClick={() => items.forEach((i) => statuses[i.code] !== 'mastered' && onSet(i.code, 'taught'))}>Mark all taught</button>
                    <button type="button" className="link-btn" onClick={() => items.forEach((i) => onSet(i.code, 'mastered'))}>Mark all mastered</button>
                  </div>}
                  {items.map((s) => <React.Fragment key={s.code}>{row(s, true)}</React.Fragment>)}
                </div>}
              </>
            : row(t, false)}
        </li>
      </React.Fragment>;
    })}
  </ul>;
}

function SyllabusBlock({ row, syllabus, statuses, onSet, busyCode, teacher, onRemove, onExamDate }) {
  const [open, setOpen] = useState(false);
  if (!syllabus) return <li className="syl-block"><p className="muted">This syllabus ({row.curriculum_id}) is no longer in the portal.{teacher && <> <button className="link-btn danger" onClick={onRemove}>Remove it</button></>}</p></li>;
  const cov = coverage(syllabus, statuses);
  return <li className="syl-block">
    <div className="syl-block-head">
      <div>
        <span className="subject-tag">{syllabus.board}</span>
        <h3>{syllabus.title}</h3>
        <p className="muted small">{syllabus.exam_years}</p>
      </div>
      <ExamCountdown date={row.exam_date}/>
    </div>
    <Meter cov={cov}/>
    <div className="row">
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronDown size={15} className={open ? 'rot' : ''}/>{open ? 'Hide topics' : teacher ? 'Tick topics' : 'See all topics'}
      </button>
      {teacher && <label className="syl-exam-date">Exam date<input type="date" value={row.exam_date ?? ''} onChange={(e) => onExamDate(e.target.value || null)}/></label>}
      {teacher && <button type="button" className="link-btn danger" onClick={onRemove}><Trash2 size={14}/>Remove</button>}
    </div>
    {open && <>
      {syllabus.note && <p className="hint">{syllabus.note}</p>}
      {teacher && <p className="hint">Click a topic once for <strong>Taught</strong>, again for <strong>Mastered</strong>, a third time to clear.</p>}
      <TopicList syllabus={syllabus} statuses={statuses} onSet={teacher ? onSet : null} busyCode={busyCode}/>
      <p className="hint syl-source">Topic headings from the official specification. <a href={syllabus.source} target="_blank" rel="noopener noreferrer">Open the {syllabus.board} document<ExternalLink size={12}/></a></p>
    </>}
  </li>;
}

/** Loads a student's syllabi, their topic ticks and the syllabus files. Works for the teacher (any student) and a student (themselves). */
function useStudentSyllabi(studentId) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [rows, progress] = await Promise.all([
        supabase.from('student_syllabi').select('*').eq('student_id', studentId).order('created_at').then(must),
        supabase.from('topic_progress').select('curriculum_id, topic_code, status').eq('student_id', studentId).limit(5000).then(must),
      ]);
      const files = await Promise.all(rows.map((r) => loadSyllabus(r.curriculum_id).catch(() => null)));
      const statuses = {};
      for (const p of progress) (statuses[p.curriculum_id] ??= {})[p.topic_code] = p.status;
      setState({ rows, files, statuses });
      setError('');
    } catch (err) {
      setError(/student_syllabi|topic_progress|relation|schema cache/i.test(err.message)
        ? 'The syllabus tracker isn’t switched on yet: run supabase/009_syllabus.sql in Supabase (SQL Editor).'
        : `Couldn’t load the syllabus: ${err.message}`);
    }
  }, [studentId]);
  useEffect(() => { load(); }, [load]);
  return { state, setState, error, setError, load };
}

/** Teacher: pick syllabi for a student, set the exam date and tick topics. */
export function SyllabusPanel({ student }) {
  const { state, setState, error, setError, load } = useStudentSyllabi(student.id);
  const [index, setIndex] = useState(null);
  const [choice, setChoice] = useState('');
  const [busyCode, setBusyCode] = useState(null);
  const { busy, error: addError, run } = useAction();
  useEffect(() => { loadIndex().then(setIndex).catch((e) => setError(e.message)); }, [setError]);

  const assigned = new Set(state?.rows.map((r) => r.curriculum_id));
  const options = useMemo(() => {
    if (!index) return [];
    const boards = [...new Set(index.map((s) => s.board))];
    // The student's own board first.
    boards.sort((a, b) => (b === student.board) - (a === student.board));
    return boards.map((b) => ({ board: b, items: index.filter((s) => s.board === b && !assigned.has(s.id)).sort(bySubject) })).filter((g) => g.items.length);
  }, [index, student.board, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const boardHasNoData = student.board && index && !index.some((s) => s.board === student.board);

  const add = (event) => {
    event.preventDefault();
    if (!choice) return;
    run(async () => {
      must(await supabase.from('student_syllabi').insert({ student_id: student.id, curriculum_id: choice }));
      setChoice('');
      await load();
    });
  };
  const remove = (row) => {
    if (!confirm('Remove this syllabus and its ticks for this student?')) return;
    run(async () => {
      must(await supabase.from('topic_progress').delete().eq('student_id', student.id).eq('curriculum_id', row.curriculum_id));
      must(await supabase.from('student_syllabi').delete().eq('id', row.id));
      await load();
    });
  };
  const setExamDate = (row, date) => run(async () => {
    must(await supabase.from('student_syllabi').update({ exam_date: date }).eq('id', row.id));
    setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id === row.id ? { ...r, exam_date: date } : r)) }));
  });
  const setStatus = (curriculumId) => async (code, status) => {
    const before = state.statuses[curriculumId]?.[code];
    if (before === status) return;
    // Show the change straight away; undo it if saving fails.
    const apply = (value) => setState((s) => ({ ...s, statuses: { ...s.statuses, [curriculumId]: { ...s.statuses[curriculumId], [code]: value } } }));
    apply(status); setBusyCode(code);
    try {
      if (status) must(await supabase.from('topic_progress').upsert({ student_id: student.id, curriculum_id: curriculumId, topic_code: code, status, updated_at: new Date().toISOString() }));
      else must(await supabase.from('topic_progress').delete().eq('student_id', student.id).eq('curriculum_id', curriculumId).eq('topic_code', code));
    } catch (err) { apply(before); setError(`Couldn’t save that tick: ${err.message}`); }
    finally { setBusyCode(null); }
  };

  if (!state) return error ? <Notice>{error}</Notice> : <Spinner/>;
  return <div className="syl-panel">
    <Notice>{error}</Notice>
    {state.rows.length ? <ul className="syl-list">{state.rows.map((r, i) => <SyllabusBlock key={r.id} row={r} syllabus={state.files[i]} statuses={state.statuses[r.curriculum_id] ?? {}}
      teacher onSet={setStatus(r.curriculum_id)} busyCode={busyCode} onRemove={() => remove(r)} onExamDate={(d) => setExamDate(r, d)}/>)}</ul>
      : <p className="muted">No syllabus yet. Add the one {student.full_name.split(' ')[0]} is studying.</p>}
    {boardHasNoData && <p className="hint">{student.board} topic lists aren’t in the portal yet, so pick the closest syllabus below or leave it for now.</p>}
    {options.length > 0 && <form className="form syl-add" onSubmit={add}>
      <label>Add a syllabus
        <select value={choice} onChange={(e) => setChoice(e.target.value)} required>
          <option value="">Choose…</option>
          {options.map((g) => <optgroup key={g.board} label={g.board === student.board ? `${g.board} (their board)` : g.board}>
            {g.items.map((s) => <option key={s.id} value={s.id}>{s.title} · {s.exam_years}</option>)}
          </optgroup>)}
        </select>
      </label>
      <button className="btn btn-primary btn-small" disabled={busy || !choice}><Plus size={15}/>{busy ? 'Adding…' : 'Add'}</button>
    </form>}
    <Notice>{addError}</Notice>
  </div>;
}

/** Student: their board/year (if missing) and their syllabus progress. */
export function MySyllabus({ profile }) {
  const { state, error } = useStudentSyllabi(profile.id);
  if (!state) return error ? <Notice>{error}</Notice> : <Spinner/>;
  if (!state.rows.length) return <Empty icon={BookMarked} title="No syllabus yet">Your teacher will add your exam syllabus here, so you can see which topics you’ve covered.</Empty>;
  return <ul className="syl-list">{state.rows.map((r, i) => <SyllabusBlock key={r.id} row={r} syllabus={state.files[i]} statuses={state.statuses[r.curriculum_id] ?? {}}/>)}</ul>;
}

/** Student: choose your board and year (shown until both are set, and from "Change" later). */
export function MyBoard({ profile, onSaved, onCancel }) {
  const [value, setValue] = useState({ board: profile.board ?? '', grade: profile.grade ?? '' });
  const { busy, error, run } = useAction();
  const save = (event) => {
    event.preventDefault();
    run(async () => {
      must(await supabase.rpc('set_my_board', { p_board: value.board, p_grade: value.grade }));
      onSaved(value);
    });
  };
  return <form className="card form my-board" onSubmit={save}>
    <h2 className="card-title"><GraduationCap size={20}/>Your board and year</h2>
    <p className="hint">This helps your teacher match your lessons, tests and syllabus to your exams.</p>
    <BoardGradeFields board={value.board} grade={value.grade} onChange={setValue} required/>
    {value.board === 'Other' && <p className="hint">Not listed? Choose “Other” and tell your teacher in your next class.</p>}
    <Notice>{error}</Notice>
    <div className="row">
      <button className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {onCancel && <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>Cancel</button>}
    </div>
  </form>;
}

/** For the parent report: one line per syllabus. */
export async function syllabusSummary(studentId) {
  const [rows, progress] = await Promise.all([
    supabase.from('student_syllabi').select('*').eq('student_id', studentId).order('created_at').then(must),
    supabase.from('topic_progress').select('curriculum_id, topic_code, status').eq('student_id', studentId).limit(5000).then(must),
  ]);
  const out = [];
  for (const r of rows) {
    const syllabus = await loadSyllabus(r.curriculum_id).catch(() => null);
    if (!syllabus) continue;
    const statuses = Object.fromEntries(progress.filter((p) => p.curriculum_id === r.curriculum_id).map((p) => [p.topic_code, p.status]));
    out.push({ title: syllabus.title, exam_date: r.exam_date, days: daysUntil(r.exam_date), ...coverage(syllabus, statuses) });
  }
  return out;
}

