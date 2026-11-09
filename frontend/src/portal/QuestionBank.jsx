import React, { useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, BookPlus, Check, Library, Pencil, Upload } from 'lucide-react';
import { must, supabase } from './supabase';
import { Empty, Notice, TEST_SUBJECTS, useAction } from './shared';
import { LEVELS, questionImageUrl } from './TestRunner';
import ImportQuestions from './ImportQuestions';
const TIME_LIMITS = [20, 30, 45, 60, 90, 120, 180, 300];
const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

const blankForm = (last = {}) => ({
  id: null, subject: last.subject ?? 'Maths', topic: last.topic ?? '', grade: last.grade ?? '', difficulty: last.difficulty ?? 2,
  kind: last.kind ?? 'mcq', prompt: '', options: ['', '', '', ''], correct_option: 0, correct_number: '', tolerance: '0',
  time_limit_seconds: last.time_limit_seconds ?? 60, explanation: '', image_path: null,
});

function QuestionForm({ questions, students, editing, onDone, reload }) {
  const [form, setForm] = useState(() => editing ? {
    ...editing, grade: editing.grade ?? '', explanation: editing.explanation ?? '',
    options: editing.kind === 'mcq' ? [...editing.options, '', '', '', ''].slice(0, Math.max(4, editing.options.length)) : ['', '', '', ''],
    correct_option: editing.correct_option ?? 0, correct_number: editing.correct_number ?? '', tolerance: String(editing.tolerance ?? 0),
  } : blankForm());
  const [removeImage, setRemoveImage] = useState(false);
  const imageInput = useRef(null);
  const { busy, error, setError, run } = useAction();
  const [saved, setSaved] = useState('');
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));
  const topics = useMemo(() => [...new Set(questions.filter((q) => q.subject === form.subject).map((q) => q.topic))].sort(), [questions, form.subject]);
  const grades = useMemo(() => [...new Set([...questions.map((q) => q.grade), ...students.map((s) => s.grade)].filter(Boolean))].sort(), [questions, students]);

  const submit = (event) => {
    event.preventDefault();
    setSaved('');
    const row = {
      subject: form.subject.trim(), topic: form.topic.trim(), grade: form.grade.trim() || null, difficulty: Number(form.difficulty),
      kind: form.kind, prompt: form.prompt.trim(), time_limit_seconds: Number(form.time_limit_seconds), explanation: form.explanation.trim() || null,
      options: null, correct_option: null, correct_number: null, tolerance: 0,
    };
    if (form.kind === 'mcq') {
      const filled = form.options.map((o, i) => ({ text: o.trim(), i })).filter((o) => o.text);
      if (filled.length < 2) { setError('Write at least 2 answer options.'); return; }
      const correctIndex = filled.findIndex((o) => o.i === Number(form.correct_option));
      if (correctIndex < 0) { setError('The option marked correct is empty. Write it or choose another.'); return; }
      row.options = filled.map((o) => o.text);
      row.correct_option = correctIndex;
    } else {
      const value = Number(String(form.correct_number).replace(',', '.'));
      const tolerance = Number(String(form.tolerance).replace(',', '.'));
      if (String(form.correct_number).trim() === '' || Number.isNaN(value)) { setError('Enter the correct number.'); return; }
      if (Number.isNaN(tolerance) || tolerance < 0) { setError('Allowed margin must be 0 or more.'); return; }
      row.correct_number = value;
      row.tolerance = tolerance;
    }
    const file = imageInput.current?.files[0];
    if (file && file.size > 5 * 1024 * 1024) { setError('The image must be smaller than 5 MB.'); return; }
    run(async () => {
      row.image_path = removeImage ? null : form.image_path ?? null;
      if (file) {
        const path = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_').slice(-60)}`;
        const { error: upErr } = await supabase.storage.from('question-images').upload(path, file, { contentType: file.type });
        if (upErr) throw new Error(`Image upload failed: ${upErr.message}`);
        row.image_path = path;
      }
      if (form.id) must(await supabase.from('questions').update(row).eq('id', form.id));
      else must(await supabase.from('questions').insert(row));
      await reload();
      if (form.id) { onDone(); return; }
      setSaved('Question saved. Add the next one.');
      setForm(blankForm(row));
      setRemoveImage(false);
      if (imageInput.current) imageInput.current.value = '';
    });
  };

  return <form className="card form" onSubmit={submit}>
    <div className="card-head">
      <h2 className="card-title"><BookPlus size={20}/>{form.id ? 'Edit question' : 'Add a question'}</h2>
      {form.id && <button type="button" className="link-btn" onClick={onDone}>Cancel</button>}
    </div>
    <div className="grid-3">
      <label>Subject<input value={form.subject} onChange={set('subject')} list="qb-subjects" required maxLength={60}/></label>
      <label>Topic<input value={form.topic} onChange={set('topic')} list="qb-topics" required maxLength={100} placeholder="e.g. Fractions"/></label>
      <label>Grade <span className="optional">(blank = any)</span><input value={form.grade} onChange={set('grade')} list="qb-grades" maxLength={60} placeholder="e.g. Year 9"/></label>
    </div>
    <datalist id="qb-subjects">{TEST_SUBJECTS.map((s) => <option key={s} value={s}/>)}</datalist>
    <datalist id="qb-topics">{topics.map((t) => <option key={t} value={t}/>)}</datalist>
    <datalist id="qb-grades">{grades.map((g) => <option key={g} value={g}/>)}</datalist>
    <div className="grid-3">
      <fieldset className="pill-group"><legend>Difficulty</legend>
        {[1, 2, 3].map((d) => <label key={d} className={Number(form.difficulty) === d ? `pill level-${d} on` : 'pill'}><input type="radio" name="difficulty" value={d} checked={Number(form.difficulty) === d} onChange={set('difficulty')}/>{LEVELS[d]}</label>)}
      </fieldset>
      <fieldset className="pill-group"><legend>Answer type</legend>
        {[['mcq', 'Choices'], ['number', 'Number']].map(([k, label]) => <label key={k} className={form.kind === k ? 'pill on' : 'pill'}><input type="radio" name="kind" value={k} checked={form.kind === k} onChange={set('kind')}/>{label}</label>)}
      </fieldset>
      <label>Time for this question<select value={form.time_limit_seconds} onChange={set('time_limit_seconds')}>{TIME_LIMITS.map((s) => <option key={s} value={s}>{s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? 's' : ''}`}</option>)}</select></label>
    </div>
    <label>Question<textarea value={form.prompt} onChange={set('prompt')} rows={3} required maxLength={2000} placeholder="e.g. Solve for x: 3x + 5 = 20"/></label>
    <label>Diagram <span className="optional">(optional image, max 5 MB)</span><input ref={imageInput} type="file" accept={IMAGE_TYPES}/></label>
    {form.image_path && !removeImage && <div className="row"><img className="q-image small" src={questionImageUrl(form.image_path)} alt="Current diagram"/><button type="button" className="link-btn danger" onClick={() => setRemoveImage(true)}>Remove image</button></div>}
    {form.kind === 'mcq' ? <fieldset className="options-edit"><legend>Answer options <span className="optional">(tick the correct one)</span></legend>
      {form.options.map((opt, i) => <div key={i} className={Number(form.correct_option) === i ? 'option-row correct' : 'option-row'}>
        <label className="option-radio" title="Correct answer"><input type="radio" name="correct" checked={Number(form.correct_option) === i} onChange={() => setForm((f) => ({ ...f, correct_option: i }))} aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}/>{String.fromCharCode(65 + i)}</label>
        <input value={opt} onChange={(e) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? e.target.value : o)) }))} maxLength={300} placeholder={i < 2 ? 'Required' : 'Optional'} aria-label={`Option ${String.fromCharCode(65 + i)}`}/>
      </div>)}
      {form.options.length < 6 && <button type="button" className="link-btn" onClick={() => setForm((f) => ({ ...f, options: [...f.options, ''] }))}>+ Add another option</button>}
    </fieldset> : <div className="grid-2">
      <label>Correct number<input inputMode="decimal" value={form.correct_number} onChange={set('correct_number')} required placeholder="e.g. 5"/></label>
      <label>Allowed margin <span className="optional">(± , 0 = exact)</span><input inputMode="decimal" value={form.tolerance} onChange={set('tolerance')} placeholder="e.g. 0.01"/></label>
    </div>}
    <label>Explanation <span className="optional">(shown after the test closes)</span><textarea value={form.explanation} onChange={set('explanation')} rows={2} maxLength={2000} placeholder="e.g. Subtract 5 from both sides, then divide by 3."/></label>
    <Notice>{error}</Notice>
    <Notice kind="success">{saved}</Notice>
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save changes' : 'Save question'}</button>
  </form>;
}

function QuestionItem({ q, onEdit, reload }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  const toggleArchive = () => run(async () => { must(await supabase.from('questions').update({ archived: !q.archived }).eq('id', q.id)); await reload(); });
  return <li className={`qb-item ${q.archived ? 'archived' : ''}`}>
    <button className="qb-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className={`badge level-${q.difficulty}`}>{LEVELS[q.difficulty]}</span>
      <span className="qb-prompt">{q.prompt}</span>
      <span className="muted small">{q.topic}{q.grade ? ` · ${q.grade}` : ''} · {q.time_limit_seconds}s</span>
    </button>
    {open && <div className="qb-detail">
      {q.image_path && <img className="q-image small" src={questionImageUrl(q.image_path)} alt="Diagram"/>}
      {q.kind === 'mcq' ? <ol className="qb-options" type="A">{q.options.map((o, i) => <li key={i} className={i === q.correct_option ? 'correct' : ''}>{o}{i === q.correct_option && <Check size={15}/>}</li>)}</ol>
        : <p className="small">Answer: <strong>{q.correct_number}</strong>{Number(q.tolerance) ? ` (± ${q.tolerance})` : ''}</p>}
      {q.explanation && <p className="small muted pre">{q.explanation}</p>}
      <div className="row">
        <button className="btn btn-ghost btn-small" onClick={() => onEdit(q)}><Pencil size={15}/>Edit</button>
        <button className="btn btn-ghost btn-small" onClick={toggleArchive} disabled={busy}>{q.archived ? <><ArchiveRestore size={15}/>Bring back</> : <><Archive size={15}/>Archive</>}</button>
      </div>
      <Notice>{error}</Notice>
    </div>}
  </li>;
}

export default function QuestionBank({ questions, students, reload }) {
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState('one'); // 'one' | 'many'
  const [subject, setSubject] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const subjects = [...new Set(questions.map((q) => q.subject))].sort();
  const active = questions.filter((q) => !q.archived);
  const visible = questions.filter((q) => (showArchived ? q.archived : !q.archived) && (!subject || q.subject === subject));
  const counts = subjects.map((s) => ({ s, by: [1, 2, 3].map((d) => active.filter((q) => q.subject === s && q.difficulty === d).length) }));

  return <div className="split">
    <div className="stack">
      {!editing && <div className="segmented-tabs" role="tablist" aria-label="How to add questions">
        <button role="tab" aria-selected={adding === 'one'} className={adding === 'one' ? 'active' : ''} onClick={() => setAdding('one')}><BookPlus size={16}/>Add one</button>
        <button role="tab" aria-selected={adding === 'many'} className={adding === 'many' ? 'active' : ''} onClick={() => setAdding('many')}><Upload size={16}/>Import many (PDF / spreadsheet)</button>
      </div>}
      {editing || adding === 'one'
        ? <QuestionForm key={editing?.id ?? 'new'} questions={questions} students={students} editing={editing} onDone={() => setEditing(null)} reload={reload}/>
        : <ImportQuestions questions={questions} students={students} reload={reload}/>}
    </div>
    <section className="card">
      <div className="card-head">
        <h2 className="card-title"><Library size={20}/>Question bank</h2>
        {subjects.length > 0 && <select className="select-small" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Filter by subject"><option value="">All subjects</option>{subjects.map((s) => <option key={s}>{s}</option>)}</select>}
      </div>
      {counts.length > 0 && <table className="qb-counts"><thead><tr><th>Subject</th><th>Easy</th><th>Medium</th><th>Hard</th></tr></thead>
        <tbody>{counts.map(({ s, by }) => <tr key={s}><td>{s}</td>{by.map((n, i) => <td key={i} className={n < 3 ? 'low' : ''}>{n}</td>)}</tr>)}</tbody></table>}
      {counts.length > 0 && <p className="hint">Aim for at least as many questions at each level as a test asks, so the adaptive test never runs out.</p>}
      {visible.length ? <ul className="qb-list">{visible.map((q) => <QuestionItem key={q.id} q={q} onEdit={(item) => { setEditing(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }} reload={reload}/>)}</ul>
        : <Empty icon={Library} title={showArchived ? 'No archived questions' : 'No questions yet'}>{showArchived ? null : 'Add your first question with the form. Questions are reused across all tests.'}</Empty>}
      {questions.some((q) => q.archived) && <button className="link-btn" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show active questions' : 'Show archived questions'}</button>}
    </section>
  </div>;
}
