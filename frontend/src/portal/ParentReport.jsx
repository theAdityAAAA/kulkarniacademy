import React, { useEffect, useRef, useState } from 'react';
import { Copy, MessageCircle, Printer, X } from 'lucide-react';
import { firstOf, must, supabase } from './supabase';
import { Notice } from './shared';
import { dayLabel } from './time';
import ProgressChart, { progressPoints } from './ProgressChart';
import { syllabusSummary } from './Syllabus';

// A one-page progress report for parents. Nothing is published: you print it / save it as PDF,
// or copy a short summary into WhatsApp. (No public links, so children's data stays private.)

const PERIODS = [['30', 'Last 30 days'], ['90', 'Last 3 months'], ['365', 'Last 12 months'], ['all', 'All time']];
const pct = (a) => (Number(a?.max_points) ? Math.round((Number(a.points) / Number(a.max_points)) * 100) : null);

export default function ParentReport({ student, homework, tests, onClose }) {
  const dialog = useRef(null);
  const [period, setPeriod] = useState('30');
  const [classes, setClasses] = useState(null);
  const [syllabi, setSyllabi] = useState([]);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const since = period === 'all' ? 0 : Date.now() - Number(period) * 86400000;
  const inPeriod = (date) => date && new Date(date).getTime() >= since && new Date(date).getTime() <= Date.now();

  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    let live = true;
    supabase.from('classes').select('starts_at, status, subject').eq('student_id', student.id).lte('starts_at', new Date().toISOString()).then(must)
      .then((rows) => live && setClasses(rows)).catch((e) => live && setError(e.message));
    // Syllabus coverage is optional: before supabase/009_syllabus.sql is run, the report simply leaves it out.
    syllabusSummary(student.id).then((rows) => live && setSyllabi(rows)).catch(() => {});
    return () => { live = false; };
  }, [student.id]);

  const held = (classes ?? []).filter((c) => c.status !== 'cancelled' && inPeriod(c.starts_at));
  const doneTests = tests.map((t) => ({ t, a: firstOf(t.test_attempts) })).filter(({ a }) => a?.finished_at && inPeriod(a.finished_at)).sort((x, y) => new Date(x.a.finished_at) - new Date(y.a.finished_at));
  const hwSet = homework.filter((h) => inPeriod(h.created_at));
  const hwIn = hwSet.filter((h) => h.submission || h.marked_at);
  const hwScored = hwSet.filter((h) => h.marked_at && h.score != null && h.out_of);
  const hwAvg = hwScored.length ? Math.round(hwScored.reduce((s, h) => s + (Number(h.score) / Number(h.out_of)) * 100, 0) / hwScored.length) : null;
  const scored = doneTests.filter(({ a }) => !a.pending_marks);
  const testAvg = scored.length ? Math.round(scored.reduce((s, { a }) => s + pct(a), 0) / scored.length) : null;
  const points = progressPoints(hwSet, doneTests.map(({ t }) => t));
  const periodLabel = PERIODS.find(([v]) => v === period)[1].toLowerCase();
  const first = student.full_name.split(' ')[0];

  const summary = [
    `📘 ${first}'s progress at Kulkarni Academy (${periodLabel})`,
    `• Classes attended: ${held.length}`,
    `• Tests taken: ${doneTests.length}${testAvg !== null ? ` · average ${testAvg}%` : ''}`,
    ...scored.map(({ t, a }) => `   – ${t.title}${(t.attempt_no ?? 1) > 1 ? ` (attempt ${t.attempt_no})` : ''}: ${pct(a)}%`),
    `• Homework: ${hwIn.length} of ${hwSet.length} handed in${hwAvg !== null ? ` · average ${hwAvg}%` : ''}`,
    ...syllabi.map((x) => `• ${x.title}: ${x.percent}% of the syllabus covered (${x.mastered} of ${x.total} topics mastered)${x.days > 0 ? ` · exam in ${x.days} days` : ''}`),
    note.trim() ? `\n${note.trim()}` : '',
    '\n— Aditya Kulkarni, Kulkarni Academy',
  ].filter(Boolean).join('\n');

  const print = () => {
    document.body.classList.add('printing-report');
    const done = () => { document.body.classList.remove('printing-report'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };
  const copy = async () => { try { await navigator.clipboard.writeText(summary); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setError('Couldn’t copy. Select the text and copy it yourself.'); } };

  return <dialog ref={dialog} className="report-dialog" onClose={onClose} onCancel={onClose}>
    <div className="report-toolbar no-print">
      <label>Period<select value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <div className="row">
        <button className="btn btn-primary btn-small" onClick={print}><Printer size={16}/>Print / save as PDF</button>
        <button className="btn btn-ghost btn-small" onClick={copy}><Copy size={16}/>{copied ? 'Copied' : 'Copy for WhatsApp'}</button>
        <a className="btn btn-ghost btn-small" href={`https://wa.me/?text=${encodeURIComponent(summary)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16}/>Open WhatsApp</a>
        <button className="icon-btn" onClick={() => dialog.current.close()} aria-label="Close report"><X size={18}/></button>
      </div>
    </div>
    <Notice>{error}</Notice>

    <article className="report-print">
      <header className="report-head">
        <div className="portal-brand"><span className="portal-logo"><img src="/kulkarni-academy-logo.png" alt="" width="300" height="538"/></span><span>Kulkarni<small>ACADEMY</small></span></div>
        <div className="report-meta"><strong>Progress report</strong><span>{dayLabel(new Date())} · {periodLabel}</span></div>
      </header>
      <h1>{student.full_name}</h1>
      <p className="muted">{[student.grade, student.board].filter(Boolean).join(' · ') || 'Maths & Science'}</p>

      <section className="report-stats">
        <div><span>Classes attended</span><strong>{classes ? held.length : '…'}</strong></div>
        <div><span>Tests taken</span><strong>{doneTests.length}</strong><small>{testAvg !== null ? `average ${testAvg}%` : 'no scores yet'}</small></div>
        <div><span>Homework handed in</span><strong>{hwIn.length}/{hwSet.length}</strong><small>{hwAvg !== null ? `average ${hwAvg}%` : 'no marks yet'}</small></div>
      </section>

      {points.length > 0 && <section className="report-section"><ProgressChart points={points} title="Scores over time"/></section>}

      {syllabi.length > 0 && <section className="report-section">
        <h2>Syllabus covered</h2>
        <table className="chart-table"><thead><tr><th>Syllabus</th><th>Covered</th><th>Mastered</th><th>Exam</th></tr></thead>
          <tbody>{syllabi.map((x) => <tr key={x.title}><td>{x.title}</td><td>{x.percent}%</td><td>{x.mastered} of {x.total} topics</td><td>{x.exam_date ? (x.days > 0 ? `in ${x.days} days` : dayLabel(`${x.exam_date}T12:00:00`)) : '—'}</td></tr>)}</tbody></table>
      </section>}

      {doneTests.length > 0 && <section className="report-section">
        <h2>Tests</h2>
        <table className="chart-table"><thead><tr><th>Date</th><th>Test</th><th>Score</th></tr></thead>
          <tbody>{doneTests.map(({ t, a }) => <tr key={t.id}><td>{dayLabel(a.finished_at)}</td><td>{t.title}{(t.attempt_no ?? 1) > 1 ? ` (attempt ${t.attempt_no})` : ''}</td><td>{a.pending_marks ? 'being marked' : `${pct(a)}%`}</td></tr>)}</tbody></table>
      </section>}

      <section className="report-section">
        <h2>Teacher’s note</h2>
        <textarea className="report-note no-print" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1500} placeholder={`e.g. ${first} has improved a lot in fractions. Next we’ll work on word problems. Please encourage 15 minutes of practice on the portal each day.`}/>
        <p className="report-note-print pre">{note || ' '}</p>
      </section>
      <footer className="report-foot">Aditya Kulkarni · Kulkarni Academy · kulkarniacademyyy@gmail.com</footer>
    </article>
  </dialog>;
}
