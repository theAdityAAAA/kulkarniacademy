import React, { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Lock, PlayCircle, Timer, XCircle } from 'lucide-react';
import { firstOf, supabase } from './supabase';
import { Empty, Notice, useAction } from './shared';
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
    </div>
    <div className="test-side">
      {(t.state === 'open' || t.state === 'in_progress') && <button className="btn btn-primary" onClick={() => onStart(t)}><PlayCircle size={18}/>{t.state === 'in_progress' ? 'Continue test' : 'Start test'}</button>}
      {t.state === 'upcoming' && <span className="badge badge-muted"><Timer size={14}/>Opens {relativeLabel(t.opens_at, now)}</span>}
      {t.state === 'missed' && <span className="badge badge-warn">Missed</span>}
      {t.state === 'finished' && <span className="test-score"><strong>{percent(t.attempt)}%</strong><small>{t.attempt.correct_count}/{t.attempt.asked_count} correct</small></span>}
    </div>
    {t.state === 'finished' && <div className="test-review">{now >= t.closes ? <Review test={t}/> : <span className="muted small"><Lock size={14}/> Answers unlock {dateTimeLabel(t.closes_at)}</span>}</div>}
  </li>)}</ul>;
}
