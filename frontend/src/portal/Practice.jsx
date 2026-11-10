import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpenCheck, CheckCircle2, RotateCcw, Sparkles, X, XCircle } from 'lucide-react';
import { supabase } from './supabase';
import { Notice } from './shared';
import { questionImageUrl } from './TestRunner';

// Mistake notebook: retry questions you got wrong in closed tests. Untimed, unscored.
// A question leaves the notebook once you answer it correctly here.

function isRight(item, answer) {
  if (item.kind === 'mcq') return answer === item.correct_option;
  const n = Number(String(answer).trim().replace(',', '.'));
  return String(answer).trim() !== '' && !Number.isNaN(n) && Math.abs(n - Number(item.correct_number)) <= Number(item.tolerance ?? 0);
}

function PracticeSession({ items, onClose }) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState(null);
  const [checked, setChecked] = useState(null); // true | false | null
  const [score, setScore] = useState({ right: 0, done: 0 });
  const item = items[index];

  const check = async () => {
    if (answer === null || answer === '') return;
    const right = isRight(item, answer);
    setChecked(right);
    setScore((s) => ({ right: s.right + (right ? 1 : 0), done: s.done + 1 }));
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.from('practice_attempts').insert({ student_id: session.user.id, question_id: item.question_id, correct: right });
  };
  const next = () => { setIndex((i) => i + 1); setAnswer(null); setChecked(null); };

  if (!item) return <div className="practice-card practice-done">
    <Sparkles size={30}/>
    <h3>Practice done!</h3>
    <p>You got <strong>{score.right} of {score.done}</strong> right this time.{score.right ? ' Those are now out of your notebook.' : ''}</p>
    <button className="btn btn-primary" onClick={onClose}>Back</button>
  </div>;

  return <div className="practice-card">
    <div className="practice-top">
      <span className="muted small">{index + 1} of {items.length} · from “{item.test_title}”</span>
      <button className="icon-btn" onClick={onClose} aria-label="Stop practising"><X size={18}/></button>
    </div>
    <p className="q-prompt">{item.prompt}</p>
    {item.image_path && <img className="q-image" src={questionImageUrl(item.image_path)} alt="Diagram for this question"/>}
    {item.kind === 'mcq'
      ? <div className="q-options">{item.options.map((opt, i) => {
          const state = checked === null ? (answer === i ? 'selected' : '') : i === item.correct_option ? 'correct' : answer === i ? 'wrong' : '';
          return <button key={i} className={`q-option ${state}`} disabled={checked !== null} onClick={() => setAnswer(i)}><span className="q-letter">{String.fromCharCode(65 + i)}</span>{opt}</button>;
        })}</div>
      : <label className="q-number">Your answer<input inputMode="decimal" value={answer ?? ''} disabled={checked !== null} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') check(); }} placeholder="Type a number"/></label>}
    {checked !== null && <div className={`practice-feedback ${checked ? 'right' : 'wrong'}`}>
      <strong>{checked ? <><CheckCircle2 size={18}/> Correct! This one is out of your notebook.</> : <><XCircle size={18}/> Not quite. The answer is {item.kind === 'mcq' ? `“${item.options[item.correct_option]}”` : item.correct_number}.</>}</strong>
      {item.explanation && <p className="pre">{item.explanation}</p>}
    </div>}
    <div className="q-actions">
      {checked === null
        ? <button className="btn btn-primary" onClick={check} disabled={answer === null || answer === ''}>Check my answer</button>
        : <button className="btn btn-primary" onClick={next}>{index + 1 < items.length ? <>Next question<ArrowRight size={18}/></> : 'Finish'}</button>}
    </div>
  </div>;
}

export default function Practice() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('practice_items');
    if (rpcError) { setError(rpcError.message.includes('practice_items') ? '' : rpcError.message); setItems([]); return; }
    setItems(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (session) return <PracticeSession items={session} onClose={() => { setSession(null); load(); }}/>;
  if (error) return <Notice>{error}</Notice>;
  if (!items) return <p className="muted small">Loading…</p>;
  if (!items.length) return <div className="practice-empty"><BookOpenCheck size={24}/><p><strong>Your mistake notebook is empty.</strong><br/>Questions you get wrong in a test appear here after the test closes, so you can try them again.</p></div>;
  const tests = [...new Set(items.map((i) => i.test_title))];
  return <div className="practice-intro">
    <p><strong>{items.length} question{items.length > 1 ? 's' : ''}</strong> to try again, from {tests.length === 1 ? `“${tests[0]}”` : `${tests.length} tests`}. No timer, no score. Get one right and it leaves your notebook.</p>
    <button className="btn btn-primary" onClick={() => setSession([...items].sort(() => Math.random() - 0.5))}><RotateCcw size={17}/>Practise my mistakes</button>
  </div>;
}
