import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BookPlus, Check, Pencil, Trash2 } from 'lucide-react';
import { must, supabase } from './supabase';
import { Notice, useAction } from './shared';
import { questionImageUrl } from './TestRunner';

export const TIME_LIMITS = [20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800];
const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';
const LETTERS = 'ABCDEF';
export const timeLabel = (s) => (s < 60 ? `${s} sec` : `${s / 60} min`);
export const KIND_LABEL = { mcq: 'Choices', number: 'Number', written: 'Written' };

const blank = (last = {}) => ({ kind: last.kind ?? 'mcq', prompt: '', topic: last.topic ?? '', options: ['', '', '', ''], correct_option: 0, correct_number: '', tolerance: '0', marks: last.marks ?? 1, time_limit_seconds: last.time_limit_seconds ?? 60, explanation: '', image_path: null });

export async function uploadQuestionImage(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error(`The image “${file.name}” is bigger than 5 MB.`);
  const path = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_').slice(-60)}`;
  const { error } = await supabase.storage.from('question-images').upload(path, file, { contentType: file.type });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
  return path;
}

/** Add or edit one question of a paper. */
export function QuestionForm({ paper, editing, nextPosition, onDone, reload }) {
  const [form, setForm] = useState(() => (editing ? {
    ...editing, topic: editing.topic ?? '', explanation: editing.explanation ?? '',
    options: editing.kind === 'mcq' ? [...editing.options, '', '', '', ''].slice(0, Math.max(4, editing.options.length)) : ['', '', '', ''],
    correct_option: editing.correct_option ?? 0, correct_number: editing.correct_number ?? '', tolerance: String(editing.tolerance ?? 0), marks: editing.marks ?? 1,
  } : blank()));
  const [removeImage, setRemoveImage] = useState(false);
  const imageInput = useRef(null);
  const { busy, error, setError, run } = useAction();
  const [saved, setSaved] = useState('');
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const submit = (event) => {
    event.preventDefault();
    setSaved('');
    const row = { kind: form.kind, prompt: form.prompt.trim(), topic: form.topic.trim() || null, time_limit_seconds: Number(form.time_limit_seconds), explanation: form.explanation.trim() || null, options: null, correct_option: null, correct_number: null, tolerance: 0, marks: form.kind === 'written' ? Number(form.marks) : 1 };
    if (form.kind === 'mcq') {
      const filled = form.options.map((o, i) => ({ text: o.trim(), i })).filter((o) => o.text);
      if (filled.length < 2) { setError('Write at least 2 answer options.'); return; }
      const correctIndex = filled.findIndex((o) => o.i === Number(form.correct_option));
      if (correctIndex < 0) { setError('The option marked correct is empty. Write it or choose another.'); return; }
      row.options = filled.map((o) => o.text);
      row.correct_option = correctIndex;
    } else if (form.kind === 'number') {
      const value = Number(String(form.correct_number).replace(',', '.'));
      const tolerance = Number(String(form.tolerance).replace(',', '.'));
      if (String(form.correct_number).trim() === '' || Number.isNaN(value)) { setError('Enter the correct number.'); return; }
      if (Number.isNaN(tolerance) || tolerance < 0) { setError('Allowed margin must be 0 or more.'); return; }
      row.correct_number = value;
      row.tolerance = tolerance;
    }
    const file = imageInput.current?.files[0];
    run(async () => {
      row.image_path = removeImage ? null : form.image_path ?? null;
      if (file) row.image_path = await uploadQuestionImage(file);
      if (editing) must(await supabase.from('questions').update(row).eq('id', editing.id));
      else must(await supabase.from('questions').insert({ ...row, paper_id: paper.id, position: nextPosition, subject: paper.subject, grade: paper.grade, difficulty: 2 }));
      await reload();
      if (editing) { onDone(); return; }
      setSaved('Question added. Write the next one.');
      setForm(blank(row));
      setRemoveImage(false);
      if (imageInput.current) imageInput.current.value = '';
    });
  };

  return <form className="form" onSubmit={submit}>
    {editing && <div className="card-head"><strong>Edit question {editing.index}</strong><button type="button" className="link-btn" onClick={onDone}>Cancel</button></div>}
    <label>Question<textarea value={form.prompt} onChange={set('prompt')} rows={3} required maxLength={2000} placeholder="e.g. Solve for x: 3x + 5 = 20"/></label>
    <div className="grid-3">
      <fieldset className="pill-group"><legend>Answer type</legend>
        {Object.entries(KIND_LABEL).map(([k, label]) => <label key={k} className={form.kind === k ? 'pill on' : 'pill'}><input type="radio" name="kind" value={k} checked={form.kind === k} onChange={set('kind')}/>{label}</label>)}
      </fieldset>
      <label>Time for this question<select value={form.time_limit_seconds} onChange={set('time_limit_seconds')}>{TIME_LIMITS.map((s) => <option key={s} value={s}>{timeLabel(s)}</option>)}</select></label>
      <label>Topic <span className="optional">(optional)</span><input value={form.topic} onChange={set('topic')} maxLength={100} placeholder="e.g. Fractions"/></label>
    </div>
    {form.kind === 'mcq' ? <fieldset className="options-edit"><legend>Answer options <span className="optional">(tick the correct one)</span></legend>
      {form.options.map((opt, i) => <div key={i} className={Number(form.correct_option) === i ? 'option-row correct' : 'option-row'}>
        <label className="option-radio" title="Correct answer"><input type="radio" name="correct" checked={Number(form.correct_option) === i} onChange={() => setForm((f) => ({ ...f, correct_option: i }))} aria-label={`Option ${LETTERS[i]} is correct`}/>{LETTERS[i]}</label>
        <input value={opt} onChange={(e) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? e.target.value : o)) }))} maxLength={300} placeholder={i < 2 ? 'Required' : 'Optional'} aria-label={`Option ${LETTERS[i]}`}/>
      </div>)}
      {form.options.length < 6 && <button type="button" className="link-btn" onClick={() => setForm((f) => ({ ...f, options: [...f.options, ''] }))}>+ Add another option</button>}
    </fieldset> : form.kind === 'number' ? <div className="grid-2">
      <label>Correct number<input inputMode="decimal" value={form.correct_number} onChange={set('correct_number')} required placeholder="e.g. 5"/></label>
      <label>Allowed margin <span className="optional">(± , 0 = exact)</span><input inputMode="decimal" value={form.tolerance} onChange={set('tolerance')} placeholder="e.g. 0.01"/></label>
    </div> : <div className="grid-2">
      <label>Marks<select value={form.marks} onChange={set('marks')}>{Array.from({ length: 20 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m} mark{m > 1 ? 's' : ''}</option>)}</select></label>
      <p className="hint written-hint">The student types an answer and/or photographs their working. You mark it out of these marks after the test.</p>
    </div>}
    <label>Diagram <span className="optional">(optional image, max 5 MB)</span><input ref={imageInput} type="file" accept={IMAGE_TYPES}/></label>
    {form.image_path && !removeImage && <div className="row"><img className="q-image small" src={questionImageUrl(form.image_path)} alt="Current diagram"/><button type="button" className="link-btn danger" onClick={() => setRemoveImage(true)}>Remove image</button></div>}
    <label>{form.kind === 'written' ? <>Model answer / marking points <span className="optional">(shown to you when marking, and to students after the test closes)</span></> : <>Explanation <span className="optional">(shown to students after the test closes)</span></>}<textarea value={form.explanation} onChange={set('explanation')} rows={form.kind === 'written' ? 4 : 2} maxLength={2000} placeholder={form.kind === 'written' ? 'e.g. 1 mark: correct formula. 1 mark: substitution. 1 mark: answer 12 cm².' : 'e.g. Subtract 5 from both sides, then divide by 3.'}/></label>
    <Notice>{error}</Notice>
    <Notice kind="success">{saved}</Notice>
    <button className="btn btn-primary" disabled={busy}><BookPlus size={17}/>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add question'}</button>
  </form>;
}

/** One question in a paper's ordered list. */
export function QuestionRow({ q, index, count, locked, onEdit, onMove, onRemove, busy }) {
  const [open, setOpen] = useState(false);
  return <li className="qb-item">
    <div className="qb-row">
      <span className="q-num">{index + 1}</span>
      <button className="qb-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="qb-prompt">{q.prompt}</span>
        <span className="muted small">{q.kind === 'mcq' ? `${q.options.length} choices` : q.kind === 'number' ? 'Number answer' : `Written · ${q.marks} mark${q.marks > 1 ? 's' : ''}`} · {timeLabel(q.time_limit_seconds)}{q.topic ? ` · ${q.topic}` : ''}{q.image_path ? ' · diagram' : ''}</span>
      </button>
      {!locked && <span className="qb-actions">
        <button className="icon-btn" onClick={() => onMove(-1)} disabled={busy || index === 0} aria-label={`Move question ${index + 1} up`} title="Move up"><ArrowUp size={16}/></button>
        <button className="icon-btn" onClick={() => onMove(1)} disabled={busy || index === count - 1} aria-label={`Move question ${index + 1} down`} title="Move down"><ArrowDown size={16}/></button>
        <button className="icon-btn" onClick={onEdit} disabled={busy} aria-label={`Edit question ${index + 1}`} title="Edit"><Pencil size={16}/></button>
        <button className="icon-btn danger" onClick={onRemove} disabled={busy} aria-label={`Remove question ${index + 1}`} title="Remove"><Trash2 size={16}/></button>
      </span>}
    </div>
    {open && <div className="qb-detail">
      {q.image_path && <img className="q-image small" src={questionImageUrl(q.image_path)} alt="Diagram"/>}
      {q.kind === 'mcq' ? <ol className="qb-options" type="A">{q.options.map((o, i) => <li key={i} className={i === q.correct_option ? 'correct' : ''}>{o}{i === q.correct_option && <Check size={15}/>}</li>)}</ol>
        : q.kind === 'number' ? <p className="small">Answer: <strong>{q.correct_number}</strong>{Number(q.tolerance) ? ` (± ${q.tolerance})` : ''}</p>
        : <p className="small">Written answer, marked by you out of <strong>{q.marks}</strong>.</p>}
      {q.explanation && <p className="small muted pre">{q.explanation}</p>}
    </div>}
  </li>;
}
