import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, FileText, ImagePlus, Loader2, Sparkles, Upload } from 'lucide-react';
import { api, must, supabase } from './supabase';
import { Notice, TEST_SUBJECTS, useAction } from './shared';
import { LEVELS } from './TestRunner';

const TIME_LIMITS = [20, 30, 45, 60, 90, 120, 180, 300];
const LETTERS = 'ABCDEF';

// ─── Spreadsheet (CSV) ─────────────────────────────────────────────────────
const CSV_COLUMNS = ['subject', 'topic', 'grade', 'difficulty', 'type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'option_f', 'correct', 'margin', 'time_seconds', 'explanation'];
const CSV_EXAMPLE = [
  ['Maths', 'Linear equations', 'Year 9', 'easy', 'number', 'Solve for x: 3x + 5 = 20', '', '', '', '', '', '', '5', '0', '60', 'Subtract 5, then divide by 3.'],
  ['Maths', 'Fractions', 'Year 9', 'medium', 'choice', 'What is 3/4 + 1/8?', '7/8', '4/12', '1/2', '5/8', '', '', 'A', '', '45', '3/4 = 6/8, and 6/8 + 1/8 = 7/8.'],
];

function downloadTemplate() {
  const quote = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [CSV_COLUMNS, ...CSV_EXAMPLE].map((row) => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'kulkarni-academy-questions-template.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

function rowsFromCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('The file has no question rows. Use the template and keep its first (header) row.');
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (name) => header.indexOf(name);
  if (col('question') < 0) throw new Error('Couldn’t find a “question” column. Please start from the template.');
  return rows.slice(1).map((r, n) => {
    const get = (name) => (col(name) >= 0 ? String(r[col(name)] ?? '').trim() : '');
    const diffText = get('difficulty').toLowerCase();
    const difficulty = { easy: 1, '1': 1, medium: 2, '2': 2, hard: 3, '3': 3 }[diffText] ?? 2;
    const kind = /^num/i.test(get('type')) ? 'number' : 'mcq';
    const options = ['a', 'b', 'c', 'd', 'e', 'f'].map((l) => get(`option_${l}`)).filter(Boolean);
    const correct = get('correct');
    const seconds = Number(get('time_seconds'));
    const notes = [];
    if (!['easy', 'medium', 'hard', '1', '2', '3', ''].includes(diffText)) notes.push(`Difficulty “${get('difficulty')}” not recognised; set to Medium.`);
    return {
      subject: get('subject'), topic: get('topic'), grade: get('grade') || null, prompt: get('question'), difficulty, kind,
      options, correct_option: kind === 'mcq' ? LETTERS.indexOf(correct.toUpperCase()) : 0,
      correct_number: kind === 'number' ? correct : '', tolerance: get('margin') || '0',
      time_limit_seconds: TIME_LIMITS.includes(seconds) ? seconds : TIME_LIMITS.reduce((best, t) => (Math.abs(t - (seconds || 60)) < Math.abs(best - (seconds || 60)) ? t : best), 60),
      explanation: get('explanation'), answer_source: 'document', needs_diagram: false, page: null, row: n + 2, notes,
    };
  });
}

// ─── Review ────────────────────────────────────────────────────────────────
function problems(q) {
  const list = [];
  if (!q.subject.trim()) list.push('Subject is missing.');
  if (!q.topic.trim()) list.push('Topic is missing.');
  if (!q.prompt.trim()) list.push('Question text is missing.');
  if (q.kind === 'mcq') {
    if (q.options.filter((o) => o.trim()).length < 2) list.push('Needs at least 2 options.');
    if (!(q.correct_option >= 0 && q.options[q.correct_option]?.trim())) list.push('Choose the correct option.');
  } else {
    if (q.correct_number === '' || Number.isNaN(Number(String(q.correct_number).replace(',', '.')))) list.push('Enter the correct number.');
    if (Number.isNaN(Number(String(q.tolerance).replace(',', '.')))) list.push('Margin must be a number.');
  }
  return list;
}

function toRow(q, imagePath) {
  const base = { subject: q.subject.trim(), topic: q.topic.trim(), grade: q.grade?.trim() || null, difficulty: q.difficulty, kind: q.kind, prompt: q.prompt.trim(), time_limit_seconds: q.time_limit_seconds, explanation: q.explanation?.trim() || null, image_path: imagePath ?? null };
  if (q.kind === 'mcq') {
    const kept = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
    return { ...base, options: kept.map((x) => x.o), correct_option: kept.findIndex((x) => x.i === q.correct_option), correct_number: null, tolerance: 0 };
  }
  return { ...base, options: null, correct_option: null, correct_number: Number(String(q.correct_number).replace(',', '.')), tolerance: Number(String(q.tolerance).replace(',', '.')) || 0 };
}

function ReviewCard({ q, index, onChange }) {
  const set = (field, value) => onChange(index, { ...q, [field]: value });
  const issues = problems(q);
  const flags = [...(q.answer_source === 'solved' ? ['The answer wasn’t in the document. The AI worked it out, so please check it.'] : []), ...(q.needs_diagram ? ['This question uses a diagram. Attach the image below.'] : []), ...q.notes];
  return <li className={`review-card ${q.include ? '' : 'excluded'} ${issues.length ? 'has-issues' : ''}`}>
    <div className="review-card-head">
      <label className="inline-check"><input type="checkbox" checked={q.include} onChange={(e) => set('include', e.target.checked)}/>Question {index + 1}</label>
      {q.page && <span className="muted small">page {q.page}</span>}
      {q.row && <span className="muted small">row {q.row}</span>}
      <span className={`badge level-${q.difficulty}`}>{LEVELS[q.difficulty]}</span>
    </div>
    {flags.length > 0 && <ul className="review-flags">{flags.map((f) => <li key={f}><AlertTriangle size={14}/>{f}</li>)}</ul>}
    {q.include && <div className="form review-fields">
      <label>Question<textarea rows={2} value={q.prompt} onChange={(e) => set('prompt', e.target.value)} maxLength={2000}/></label>
      <div className="grid-3">
        <label>Topic<input value={q.topic} onChange={(e) => set('topic', e.target.value)} maxLength={100}/></label>
        <label>Difficulty<select value={q.difficulty} onChange={(e) => set('difficulty', Number(e.target.value))}>{[1, 2, 3].map((d) => <option key={d} value={d}>{LEVELS[d]}</option>)}</select></label>
        <label>Time<select value={q.time_limit_seconds} onChange={(e) => set('time_limit_seconds', Number(e.target.value))}>{TIME_LIMITS.map((s) => <option key={s} value={s}>{s}s</option>)}</select></label>
      </div>
      {q.kind === 'mcq' ? <fieldset className="options-edit"><legend>Options <span className="optional">(tick the correct one)</span></legend>
        {q.options.map((opt, i) => <div key={i} className={q.correct_option === i ? 'option-row correct' : 'option-row'}>
          <label className="option-radio"><input type="radio" name={`correct-${index}`} checked={q.correct_option === i} onChange={() => set('correct_option', i)}/>{LETTERS[i]}</label>
          <input value={opt} onChange={(e) => set('options', q.options.map((o, j) => (j === i ? e.target.value : o)))} maxLength={300} aria-label={`Option ${LETTERS[i]}`}/>
        </div>)}
        {q.options.length < 6 && <button type="button" className="link-btn" onClick={() => set('options', [...q.options, ''])}>+ Add option</button>}
      </fieldset> : <div className="grid-2">
        <label>Correct number<input inputMode="decimal" value={q.correct_number} onChange={(e) => set('correct_number', e.target.value)}/></label>
        <label>Margin (±)<input inputMode="decimal" value={q.tolerance} onChange={(e) => set('tolerance', e.target.value)}/></label>
      </div>}
      <label>Explanation <span className="optional">(optional)</span><textarea rows={1} value={q.explanation} onChange={(e) => set('explanation', e.target.value)} maxLength={2000}/></label>
      <label className="file-inline"><ImagePlus size={16}/>{q.image ? `Diagram: ${q.image.name}` : 'Attach a diagram (optional)'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => set('image', e.target.files[0] ?? null)}/></label>
      {issues.length > 0 && <p className="error-text">{issues.join(' ')}</p>}
    </div>}
  </li>;
}

function Review({ items, setItems, reload, onFinished, summary }) {
  const { busy, error, setError, run } = useAction();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const change = (i, next) => setItems((list) => list.map((q, j) => (j === i ? next : q)));
  const chosen = items.filter((q) => q.include);
  const invalid = chosen.filter((q) => problems(q).length);
  const flagged = (q) => q.answer_source === 'solved' || q.needs_diagram || q.notes.length || problems(q).length;
  const save = () => {
    if (!chosen.length) { setError('Tick at least one question.'); return; }
    if (invalid.length) { setError(`${invalid.length} ticked question${invalid.length > 1 ? 's need' : ' needs'} fixing (shown in red), or untick them.`); return; }
    run(async () => {
      const rows = [];
      for (const q of chosen) {
        let imagePath = null;
        if (q.image) {
          if (q.image.size > 5 * 1024 * 1024) throw new Error(`The diagram “${q.image.name}” is bigger than 5 MB.`);
          imagePath = `${crypto.randomUUID()}-${q.image.name.replace(/[^\w.-]+/g, '_').slice(-60)}`;
          const { error: upErr } = await supabase.storage.from('question-images').upload(imagePath, q.image, { contentType: q.image.type });
          if (upErr) throw new Error(`Diagram upload failed: ${upErr.message}`);
        }
        rows.push(toRow(q, imagePath));
      }
      for (let i = 0; i < rows.length; i += 100) must(await supabase.from('questions').insert(rows.slice(i, i + 100)));
      await reload();
      onFinished(`${rows.length} question${rows.length > 1 ? 's' : ''} added to your question bank.`);
    });
  };
  const shown = items.map((q, i) => ({ q, i })).filter(({ q }) => !onlyFlagged || flagged(q));
  return <div className="review">
    <div className="review-summary">
      <strong>{items.length} questions found</strong>{summary && <span className="muted small"> · {summary}</span>}
      <p className="hint">Check each question. Untick any you don’t want, fix anything misread, then save. Nothing is saved until you click the button below.</p>
      <div className="row">
        <button type="button" className="link-btn" onClick={() => setItems((l) => l.map((q) => ({ ...q, include: true })))}>Tick all</button>
        <button type="button" className="link-btn" onClick={() => setItems((l) => l.map((q) => ({ ...q, include: false })))}>Untick all</button>
        <label className="inline-check small"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)}/>Show only ones to check ({items.filter(flagged).length})</label>
      </div>
    </div>
    <ol className="review-cards">{shown.map(({ q, i }) => <ReviewCard key={i} q={q} index={i} onChange={change}/>)}</ol>
    <div className="review-save">
      <Notice>{error}</Notice>
      <button className="btn btn-primary btn-wide" onClick={save} disabled={busy}>{busy ? 'Saving…' : `Add ${chosen.length} question${chosen.length === 1 ? '' : 's'} to the bank`}</button>
      <button className="link-btn" onClick={() => onFinished('')} disabled={busy}>Cancel import</button>
    </div>
  </div>;
}

// ─── Import panel ──────────────────────────────────────────────────────────
export default function ImportQuestions({ questions, students, reload }) {
  const [source, setSource] = useState('pdf');
  const [meta, setMeta] = useState({ subject: 'Maths', grade: '', topicHint: '' });
  const [items, setItems] = useState(null);
  const [summary, setSummary] = useState('');
  const [done, setDone] = useState('');
  const [skipped, setSkipped] = useState([]);
  const pdfInput = useRef(null), csvInput = useRef(null);
  const { busy, error, setError, run } = useAction();
  const grades = useMemo(() => [...new Set([...questions.map((q) => q.grade), ...students.map((s) => s.grade)].filter(Boolean))].sort(), [questions, students]);
  const setM = (field) => (e) => setMeta((m) => ({ ...m, [field]: e.target.value }));
  const start = (list, text = '') => { setItems(list.map((q) => ({ ...q, include: true, image: null, explanation: q.explanation ?? '' }))); setSummary(text); setDone(''); };

  const readPdf = (event) => {
    event.preventDefault();
    const file = pdfInput.current.files[0];
    if (!file) { setError('Choose a PDF or photo first.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('The file is bigger than 20 MB. Split the PDF into smaller parts.'); return; }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) { setError('Use a PDF, JPG, PNG or WEBP file.'); return; }
    run(async () => {
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('question-imports').upload(path, file, { contentType: file.type || undefined });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const result = await api('/admin/import-questions', { method: 'POST', body: { path, subject: meta.subject, grade: meta.grade, topicHint: meta.topicHint } });
      setSkipped(result.skipped ?? []);
      if (!result.questions.length) throw new Error('No choice or number questions were found in this file.');
      start(result.questions, `AI cost for this import: about $${result.cost_usd.toFixed(2)}`);
    });
  };

  const readCsv = (event) => {
    event.preventDefault();
    const file = csvInput.current.files[0];
    if (!file) { setError('Choose your CSV file first.'); return; }
    run(async () => { setSkipped([]); start(rowsFromCsv(await file.text()), `from ${file.name}`); });
  };

  if (items) return <section className="card">
    <h2 className="card-title"><Sparkles size={20}/>Review imported questions</h2>
    {skipped.length > 0 && <details className="skipped"><summary>{skipped.length} question{skipped.length > 1 ? 's' : ''} skipped (need a written answer or similar)</summary>
      <ul>{skipped.map((s, i) => <li key={i}><span className="muted small">page {s.page}:</span> {s.text} <em className="muted small">({s.reason})</em></li>)}</ul></details>}
    <Review items={items} setItems={setItems} reload={reload} summary={summary} onFinished={(msg) => { setItems(null); setDone(msg); }}/>
  </section>;

  return <section className="card form">
    <h2 className="card-title"><Upload size={20}/>Import many questions</h2>
    <nav className="tabs tabs-small" role="tablist">
      <button type="button" role="tab" aria-selected={source === 'pdf'} className={source === 'pdf' ? 'tab active' : 'tab'} onClick={() => { setSource('pdf'); setError(''); }}><FileText size={16}/>From a PDF (AI)</button>
      <button type="button" role="tab" aria-selected={source === 'csv'} className={source === 'csv' ? 'tab active' : 'tab'} onClick={() => { setSource('csv'); setError(''); }}><FileSpreadsheet size={16}/>From a spreadsheet</button>
    </nav>
    <Notice kind="success">{done}</Notice>
    {source === 'pdf' ? <form className="form" onSubmit={readPdf}>
      <p className="hint">Upload a question paper with answers (PDF, or a photo of a page). AI reads it and suggests topic, difficulty and time for each question. You review everything before it’s saved.</p>
      <div className="grid-2">
        <label>Subject<input value={meta.subject} onChange={setM('subject')} list="imp-subjects" required maxLength={60}/></label>
        <label>Grade <span className="optional">(optional)</span><input value={meta.grade} onChange={setM('grade')} list="imp-grades" maxLength={60} placeholder="e.g. Year 9"/></label>
      </div>
      <datalist id="imp-subjects">{TEST_SUBJECTS.map((s) => <option key={s} value={s}/>)}</datalist>
      <datalist id="imp-grades">{grades.map((g) => <option key={g} value={g}/>)}</datalist>
      <label>Topics in this paper <span className="optional">(optional hint)</span><input value={meta.topicHint} onChange={setM('topicHint')} maxLength={200} placeholder="e.g. Fractions and decimals"/></label>
      <label>File <span className="optional">(PDF, JPG, PNG · max 20 MB)</span><input ref={pdfInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp"/></label>
      <Notice>{error}</Notice>
      {busy && <p className="reading"><Loader2 className="spin" size={18}/>Reading your questions… this can take 1–3 minutes for a long paper. Please keep this page open.</p>}
      <button className="btn btn-primary" disabled={busy}><Sparkles size={17}/>{busy ? 'Reading…' : 'Read questions'}</button>
    </form> : <form className="form" onSubmit={readCsv}>
      <p className="hint">Fill in the template in Excel or Google Sheets (one question per row), save or download it as <strong>CSV</strong>, and upload it here. Free, no AI.</p>
      <button type="button" className="btn btn-ghost" onClick={downloadTemplate}><Download size={16}/>Download the template</button>
      <ul className="hint csv-help">
        <li><strong>difficulty:</strong> easy, medium or hard</li>
        <li><strong>type:</strong> choice or number</li>
        <li><strong>correct:</strong> the letter (A–F) for choice questions, or the number for number questions</li>
        <li><strong>margin:</strong> allowed ± for number answers (0 = exact) · <strong>time_seconds:</strong> e.g. 60</li>
      </ul>
      <label>CSV file<input ref={csvInput} type="file" accept=".csv,text/csv"/></label>
      <Notice>{error}</Notice>
      <button className="btn btn-primary" disabled={busy}><FileSpreadsheet size={17}/>{busy ? 'Reading…' : 'Read spreadsheet'}</button>
    </form>}
  </section>;
}
