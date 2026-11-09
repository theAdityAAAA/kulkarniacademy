import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Maximize, ShieldCheck, Trophy, X } from 'lucide-react';
import { supabase } from './supabase';
import { Notice } from './shared';
import { dateTimeLabel } from './time';

export const LEVELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
export const questionImageUrl = (path) => supabase.storage.from('question-images').getPublicUrl(path).data.publicUrl;

const canFullscreen = () => Boolean(document.documentElement.requestFullscreen);
const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});
const leaveFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function Timer({ deadline, limit }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const fraction = Math.max(0, Math.min(1, (deadline - now) / (limit * 1000)));
  return <div className={`q-timer ${left <= 10 ? 'urgent' : ''}`} role="timer" aria-label={`${left} seconds left`}>
    <Clock size={18}/><span>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
    <span className="q-timer-bar"><span style={{ transform: `scaleX(${fraction})` }}/></span>
  </div>;
}

function Finished({ view, onClose }) {
  const pct = Number(view.max_points) ? Math.round((Number(view.points) / Number(view.max_points)) * 100) : 0;
  return <div className="runner-card runner-center">
    <span className="runner-icon"><Trophy size={30}/></span>
    <h1>{view.reason === 'no_questions' ? 'No questions available' : 'Test finished'}</h1>
    {view.reason === 'exits' && <Notice>The test was submitted because you left it {view.exits} times.</Notice>}
    {view.reason === 'no_questions' ? <p className="muted">Your teacher hasn’t added questions for this test yet. Please let them know.</p> : <>
      <div className="runner-score"><strong>{pct}%</strong><span>{view.correct} of {view.asked} correct</span></div>
      <p className="muted">Hardest level reached: <strong>{LEVELS[view.level]}</strong></p>
      <p className="muted small">You can see the answers and explanations after {dateTimeLabel(view.review_at)}.</p>
    </>}
    <button className="btn btn-primary" onClick={onClose}>Back to the portal</button>
  </div>;
}

export default function TestRunner({ test, onClose }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(null);
  const [numberAnswer, setNumberAnswer] = useState('');
  const [deadline, setDeadline] = useState(0);
  const [warning, setWarning] = useState(null);
  const lastExit = useRef(0);
  const submitting = useRef(false);
  const answerRef = useRef({ choice: null, number: '' });
  answerRef.current = { choice, number: numberAnswer };

  const running = view?.status === 'in_progress';
  const question = view?.question;

  const apply = useCallback((next) => {
    setView(next);
    setChoice(null);
    setNumberAnswer('');
    submitting.current = false;
    if (next?.status === 'in_progress') setDeadline(Date.now() + next.question.seconds_left * 1000);
    if (next?.status === 'finished') leaveFullscreen();
  }, []);

  const start = async () => {
    setBusy(true); setError('');
    if (canFullscreen()) await enterFullscreen();
    try { apply(await rpc('test_start', { p_test: test.id })); } catch (err) { setError(err.message); leaveFullscreen(); } finally { setBusy(false); }
  };

  const submit = useCallback(async (timedOut = false) => {
    if (submitting.current || !question) return;
    const { choice: c, number: n } = answerRef.current;
    let parsed = null;
    if (question.kind === 'number' && n.trim() !== '') {
      parsed = Number(n.trim().replace(',', '.'));
      if (Number.isNaN(parsed)) { if (!timedOut) { setError('Please type a number, like 12 or -3.5'); return; } parsed = null; }
    }
    if (!timedOut && question.kind === 'mcq' && c === null) { setError('Choose an answer first.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      apply(await rpc('test_answer', { p_test: test.id, p_question: question.id, p_option: question.kind === 'mcq' ? c : null, p_number: parsed }));
    } catch (err) { setError(err.message); submitting.current = false; } finally { setBusy(false); }
  }, [question, test.id, apply]);

  // Time's up: send whatever is selected (or nothing).
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => { if (Date.now() >= deadline) submit(true); }, 300);
    return () => clearInterval(id);
  }, [running, deadline, submit]);

  // Leaving full screen or switching tab/app counts as an exit.
  useEffect(() => {
    if (!running) return undefined;
    const record = async () => {
      if (Date.now() - lastExit.current < 2000) return;
      lastExit.current = Date.now();
      try {
        const next = await rpc('test_exit', { p_test: test.id });
        if (next.status === 'finished') { apply(next); setWarning(null); return; }
        setView((v) => ({ ...v, exits: next.exits }));
        setWarning({ exits: next.exits, max: next.max_exits });
      } catch { /* network hiccup: ignore */ }
    };
    const onVisibility = () => { if (document.hidden) record(); };
    const onFullscreen = () => { if (canFullscreen() && !document.fullscreenElement) record(); };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => { document.removeEventListener('visibilitychange', onVisibility); document.removeEventListener('fullscreenchange', onFullscreen); };
  }, [running, test.id, apply]);

  useEffect(() => () => leaveFullscreen(), []);

  const close = () => { leaveFullscreen(); onClose(); };
  const block = (event) => event.preventDefault();

  return <div className="runner" onCopy={block} onCut={block} onContextMenu={block}>
    {!view && <div className="runner-card">
      <button className="icon-btn runner-close" onClick={close} aria-label="Close"><X size={20}/></button>
      <span className="runner-icon"><ShieldCheck size={30}/></span>
      <span className="eyebrow">{test.subject.toUpperCase()} TEST</span>
      <h1>{test.title}</h1>
      <ul className="rules">
        <li><strong>{test.question_count} questions.</strong> They start at Medium and get harder when you answer correctly.</li>
        <li><strong>Every question has its own timer.</strong> When it runs out, your selected answer is sent automatically.</li>
        <li><strong>No going back</strong> to earlier questions.</li>
        <li><strong>Stay on this screen.</strong> Leaving full screen or switching apps is recorded. After {test.max_exits} times, the test submits itself.</li>
        <li><strong>One attempt only.</strong> Work on your own, with paper and pencil ready.</li>
      </ul>
      <Notice>{error}</Notice>
      <button className="btn btn-primary btn-wide btn-big" onClick={start} disabled={busy}><Maximize size={19}/>{busy ? 'Starting…' : test.attempt ? 'Continue test' : 'Start test'}</button>
    </div>}

    {running && <div className="runner-card runner-question">
      <div className="q-top">
        <span className="q-count">Question {view.position} of {view.total}</span>
        <span className={`badge level-${question.difficulty}`}>{LEVELS[question.difficulty]}</span>
        <Timer key={question.id} deadline={deadline} limit={question.time_limit}/>
      </div>
      <progress className="q-progress" value={view.position - 1} max={view.total}/>
      <p className="q-prompt">{question.prompt}</p>
      {question.image_path && <img className="q-image" src={questionImageUrl(question.image_path)} alt="Diagram for this question" draggable="false"/>}
      {question.kind === 'mcq'
        ? <div className="q-options" role="radiogroup" aria-label="Answers">{question.options.map((opt, i) => <button key={i} role="radio" aria-checked={choice === i} className={choice === i ? 'q-option selected' : 'q-option'} onClick={() => setChoice(i)} disabled={busy}><span className="q-letter">{String.fromCharCode(65 + i)}</span>{opt}</button>)}</div>
        : <label className="q-number">Your answer<input inputMode="decimal" autoComplete="off" value={numberAnswer} onChange={(e) => setNumberAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Type a number" autoFocus/></label>}
      <Notice>{error}</Notice>
      <div className="q-actions">
        {view.exits > 0 && <span className="q-exits"><AlertTriangle size={16}/>Left the test {view.exits}/{view.max_exits}</span>}
        <button className="btn btn-primary btn-big" onClick={() => submit()} disabled={busy}>{view.position === view.total ? 'Finish test' : 'Next question'}<ArrowRight size={19}/></button>
      </div>
    </div>}

    {view?.status === 'finished' && <Finished view={view} onClose={close}/>}

    {warning && running && <div className="runner-warning" role="alertdialog" aria-labelledby="exit-warning-title">
      <div className="runner-card runner-center">
        <span className="runner-icon warn"><AlertTriangle size={30}/></span>
        <h2 id="exit-warning-title">You left the test ({warning.exits} of {warning.max})</h2>
        <p className="muted">Your timer kept running. If you leave {warning.max - warning.exits} more time{warning.max - warning.exits === 1 ? '' : 's'}, the test will submit itself.</p>
        <button className="btn btn-primary btn-big" onClick={() => { setWarning(null); if (canFullscreen()) enterFullscreen(); }}><CheckCircle2 size={19}/>Back to my test</button>
      </div>
    </div>}
  </div>;
}
