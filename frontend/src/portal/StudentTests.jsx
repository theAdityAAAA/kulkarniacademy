import React, { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Lock, MessageSquare, PlayCircle, Timer, XCircle } from 'lucide-react';
import { firstOf, supabase } from './supabase';
import { Empty, FileLink, Notice, useAction } from './shared';
import { dateTimeLabel, relativeLabel } from './time';
import { questionImageUrl } from './TestRunner';

const percent = (a) => (Number(a?.max_points) ? Math.round((Number(a.points) / Number(a.max_points)) * 100) : 0);

function Review({ test }) {
  const { busy, error, run } = useAction();
  const [items, setItems] = useState(null);
  const load = () => run(async () => {
    const { data, error: rpcError } = await supabase.rpc('test_review', { p_test: test.id });
    if (rpcError) throw new Error(rpcError.message);
    setItems(data);
  });
  if (!items) return <><button className="link-btn" onClick={load} disabled={busy}>{busy ? 'Loading…' : 'See answers and explanations'}</button><Notice>{error}</Notice></>;
  return <ol className="review-list">{items.map((it) => {
    if (it.kind === 'written') {
      const marked = it.awarded != null;
      return <li key={it.position} className={!marked ? '' : Number(it.awarded) >= it.marks ? 'right' : 'wrong'}>
        <div className="review-head"><strong>Question {it.position}</strong><span className="badge badge-muted">{marked ? `${Number(it.awarded)} / ${it.marks} marks` : 'Not marked yet'}</span></div>
        <p className="pre">{it.prompt}</p>
        {it.image_path && <img className="q-image small" src={questionImageUrl(it.image_path)} alt="Diagram for this question"/>}
        {it.given_text && <p className="small pre student-text">{it.given_text}</p>}
        {it.given_files?.length > 0 && <div className="file-list">{it.given_files.map((f) => <FileLink key={f} path={f}/>)}</div>}
        {!it.given_text && !it.given_files?.length && <p className="small muted">No answer (time ran out)</p>}
        {it.teacher_comment && <p className="teacher-comment"><MessageSquare size={15}/>{it.teacher_comment}</p>}
        {it.explanation && <details className="model-answer"><summary>Model answer</summary><p className="small pre">{it.explanation}</p></details>}
      </li>;
    }
    const given = it.kind === 'mcq' ? (it.given_option != null ? it.options[it.given_option] : null) : it.given_number;
    const correct = it.kind === 'mcq' ? it.options[it.correct_option] : it.correct_number;
    return <li key={it.position} className={it.is_correct ? 'right' : 'wrong'}>
      <div className="review-head">{it.is_correct ? <CheckCircle2 size={18}/> : <XCircle size={18}/>}<strong>Question {it.position}</strong></div>
      <p className="pre">{it.prompt}</p>
      {it.image_path && <img className="q-image small" src={questionImageUrl(it.image_path)} alt="Diagram for this question"/>}
      <p className="small">Your answer: <strong>{it.timed_out && given == null ? 'No answer (time ran out)' : String(given ?? '—')}</strong>{!it.is_correct && <> · Correct answer: <strong>{String(correct)}</strong></>}</p>
      {it.explanation && <p className="small muted pre">{it.explanation}</p>}
    </li>;
  })}</ol>;
}

export default function StudentTests({ tests, now, onStart }) {
  if (!tests.length) return <Empty icon={ClipboardCheck} title="No tests yet">When your teacher sets a test, it will show here.</Empty>;
  const withState = tests.map((t) => {
    const attempt = firstOf(t.test_attempts);
    const opens = new Date(t.opens_at).getTime(), closes = new Date(t.closes_at).getTime();
    const state = attempt?.finished_at ? 'finished' : attempt ? 'in_progress' : now < opens ? 'upcoming' : now > closes ? 'missed' : 'open';
    return { ...t, attempt, state, closes };
  });
  const order = { in_progress: 0, open: 1, upcoming: 2, finished: 3, missed: 4 };
  withState.sort((a, b) => order[a.state] - order[b.state] || new Date(a.opens_at) - new Date(b.opens_at));

  return <ul className="test-list">{withState.map((t) => <li key={t.id} className={`test-item state-${t.state}`}>
    <div className="test-main">
      <span className="subject-tag">{t.subject}</span>
      <strong>{t.title}</strong>
      <span className="muted small">{t.question_count} questions · {t.state === 'upcoming' ? `opens ${dateTimeLabel(t.opens_at)}` : `closes ${dateTimeLabel(t.closes_at)}`}</span>
      {t.monitoring && t.state !== 'finished' && <span className="badge badge-muted cam-badge">📷 Camera & microphone needed</span>}
    </div>
    <div className="test-side">
      {(t.state === 'open' || t.state === 'in_progress') && <button className="btn btn-primary" onClick={() => onStart(t)}><PlayCircle size={18}/>{t.state === 'in_progress' ? 'Continue test' : 'Start test'}</button>}
      {t.state === 'upcoming' && <span className="badge badge-muted"><Timer size={14}/>Opens {relativeLabel(t.opens_at, now)}</span>}
      {t.state === 'missed' && <span className="badge badge-warn">Missed</span>}
      {t.state === 'finished' && <span className="test-score"><strong>{percent(t.attempt)}%</strong>
        <small>{t.attempt.pending_marks > 0 ? `so far · ${t.attempt.pending_marks} still to be marked` : `${Number(t.attempt.points)} of ${Number(t.attempt.max_points)} marks`}</small></span>}
    </div>
    {t.state === 'finished' && <div className="test-review">{now >= t.closes ? <Review test={t}/> : <span className="muted small"><Lock size={14}/> Answers unlock {dateTimeLabel(t.closes_at)}</span>}</div>}
  </li>)}</ul>;
}
