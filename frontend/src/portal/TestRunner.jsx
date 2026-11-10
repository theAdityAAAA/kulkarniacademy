import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Camera, CheckCircle2, Clock, Maximize, ShieldCheck, Trophy, X } from 'lucide-react';
import { checkFile, friendlyError, supabase, uploadFile } from './supabase';
import { Notice } from './shared';
import { dateTimeLabel } from './time';

export const LEVELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
export const questionImageUrl = (path) => supabase.storage.from('question-images').getPublicUrl(path).data.publicUrl;

const canFullscreen = () => Boolean(document.documentElement.requestFullscreen);
const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});
const leaveFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(friendlyError(error.message));
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
      {view.pending_marks > 0
        ? <><div className="runner-score"><strong>{pct}%</strong><span>so far: {view.pending_marks} written answer{view.pending_marks > 1 ? 's' : ''} still to be marked</span></div>
          <p className="muted">Your teacher will mark your written answers, so your final score can only go up from here.</p></>
        : <div className="runner-score"><strong>{pct}%</strong><span>{view.points} of {view.max_points} marks</span></div>}
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
  const [writtenText, setWrittenText] = useState('');
  const [photos, setPhotos] = useState([]);
  const [backToFullscreen, setBackToFullscreen] = useState(false);
  const lastExit = useRef(0);
  const pickingUntil = useRef(0); // choosing a photo leaves the page on phones: that is not cheating
  const submitting = useRef(false);
  const retryAt = useRef(0); // after a failed automatic submit, wait before trying again
  const answerRef = useRef({ choice: null, number: '', text: '', photos: [] });
  answerRef.current = { choice, number: numberAnswer, text: writtenText, photos };

  const running = view?.status === 'in_progress';
  const question = view?.question;

  const apply = useCallback((next) => {
    setView(next);
    setChoice(null);
    setNumberAnswer('');
    setWrittenText('');
    setPhotos([]);
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
    const { choice: c, number: n, text, photos: files } = answerRef.current;
    if (question.kind === 'written') {
      if (!timedOut && !text.trim() && !files.length) { setError('Type your answer or add a photo of your working.'); return; }
      submitting.current = true; setBusy(true); setError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const paths = [];
        for (const file of files) paths.push(await uploadFile(`${session.user.id}/submissions/tests/${view.attempt_id}`, file));
        apply(await rpc('test_answer', { p_test: test.id, p_question: question.id, p_text: text, p_files: paths }));
      } catch (err) { setError(err.message); submitting.current = false; retryAt.current = Date.now() + 4000; } finally { setBusy(false); }
      return;
    }
    let parsed = null;
    if (question.kind === 'number' && n.trim() !== '') {
      parsed = Number(n.trim().replace(',', '.'));
      if (Number.isNaN(parsed)) { if (!timedOut) { setError('Please type a number, like 12 or -3.5'); return; } parsed = null; }
    }
    if (!timedOut && question.kind === 'mcq' && c === null) { setError('Choose an answer first.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      apply(await rpc('test_answer', { p_test: test.id, p_question: question.id, p_option: question.kind === 'mcq' ? c : null, p_number: parsed }));
    } catch (err) { setError(err.message); submitting.current = false; retryAt.current = Date.now() + 4000; } finally { setBusy(false); }
  }, [question, test.id, apply, view?.attempt_id]);

  // Time's up: send whatever is selected (or nothing).
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => { if (Date.now() >= deadline && Date.now() >= retryAt.current) submit(true); }, 300);
    return () => clearInterval(id);
  }, [running, deadline, submit]);

  // Leaving full screen or switching tab/app counts as an exit.
  useEffect(() => {
    if (!running) return undefined;
    const record = async () => {
      if (Date.now() < pickingUntil.current) { if (canFullscreen() && !document.fullscreenElement) setBackToFullscreen(true); return; }
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
        <li><strong>{test.question_count} question{test.question_count === 1 ? '' : 's'}</strong>, one at a time.</li>
        <li><strong>Every question has its own timer.</strong> When it runs out, your selected answer is sent automatically.</li>
        <li><strong>No going back</strong> to earlier questions.</li>
        <li><strong>Stay on this screen.</strong> Leaving full screen or switching apps is recorded. After {test.max_exits} times, the test submits itself.</li>
        <li><strong>Written questions:</strong> type your answer and/or take a photo of your working. Adding a photo doesn’t count as leaving.</li>
        <li><strong>One attempt only.</strong> Work on your own, with paper and pencil ready.</li>
      </ul>
      <Notice>{error}</Notice>
      <button className="btn btn-primary btn-wide btn-big" onClick={start} disabled={busy}><Maximize size={19}/>{busy ? 'Starting…' : test.attempt ? 'Continue test' : 'Start test'}</button>
    </div>}

    {running && <div className="runner-card runner-question">
      <div className="q-top">
        <span className="q-count">Question {view.position} of {view.total}</span>
        <Timer key={question.id} deadline={deadline} limit={question.time_limit}/>
      </div>
      <progress className="q-progress" value={view.position - 1} max={view.total}/>
      <p className="q-prompt">{question.prompt}</p>
      {question.image_path && <img className="q-image" src={questionImageUrl(question.image_path)} alt="Diagram for this question" draggable="false"/>}
      {question.kind === 'written' && <div className="q-written">
        <span className="badge badge-accent">{question.marks} mark{question.marks > 1 ? 's' : ''} · your teacher marks this</span>
        <label>Your answer <span className="optional">(type it, or add a photo of your working, or both)</span>
          <textarea rows={5} value={writtenText} onChange={(e) => setWrittenText(e.target.value)} maxLength={5000} placeholder="Write your answer and working here…"/></label>
        <label className="file-pick" onClick={() => { pickingUntil.current = Date.now() + 180000; }}>
          <Camera size={18}/>{photos.length ? 'Add another photo' : 'Take or add a photo of your working'}
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            const bad = picked.map(checkFile).find(Boolean);
            if (bad) setError(bad); else setPhotos((list) => [...list, ...picked].slice(0, 6));
            e.target.value = '';
            pickingUntil.current = Date.now() + 3000;
          }}/>
        </label>
        {photos.length > 0 && <ul className="photo-list">{photos.map((f, i) => <li key={i}>{f.name}<button type="button" className="icon-btn" onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><X size={14}/></button></li>)}</ul>}
      </div>}
      {question.kind === 'written' ? null : question.kind === 'mcq'
        ? <div className="q-options" role="radiogroup" aria-label="Answers">{question.options.map((opt, i) => <button key={i} role="radio" aria-checked={choice === i} className={choice === i ? 'q-option selected' : 'q-option'} onClick={() => setChoice(i)} disabled={busy}><span className="q-letter">{String.fromCharCode(65 + i)}</span>{opt}</button>)}</div>
        : <label className="q-number">Your answer<input inputMode="decimal" autoComplete="off" value={numberAnswer} onChange={(e) => setNumberAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Type a number" autoFocus/></label>}
      <Notice>{error}</Notice>
      <div className="q-actions">
        {view.exits > 0 && <span className="q-exits"><AlertTriangle size={16}/>Left the test {view.exits}/{view.max_exits}</span>}
        <button className="btn btn-primary btn-big" onClick={() => submit()} disabled={busy}>{view.position === view.total ? 'Finish test' : 'Next question'}<ArrowRight size={19}/></button>
      </div>
    </div>}

    {view?.status === 'finished' && <Finished view={view} onClose={close}/>}

    {backToFullscreen && running && !warning && <div className="runner-return">
      <button className="btn btn-primary" onClick={() => { setBackToFullscreen(false); enterFullscreen(); }}><Maximize size={17}/>Back to full screen</button>
    </div>}

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
