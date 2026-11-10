import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpenCheck, CalendarDays, CheckCircle2, ClipboardList, LineChart, RefreshCw, RotateCcw, ShieldCheck, Upload, Video } from 'lucide-react';
import Practice from './Practice';
import ProgressChart, { progressPoints } from './ProgressChart';
import StudentTests from './StudentTests';
import TestRunner from './TestRunner';
import { ACCEPTED_FILES, checkFile, firstOf, must, supabase, uploadFile } from './supabase';
import { Empty, FileLink, JoinButton, Notice, Spinner, classState, platformName, useAction, useNow } from './shared';
import { dateTimeLabel, dayLabel, localZone, placeName, relativeLabel, timeLabel } from './time';

const MAX_FILES = 6;

function NextClass({ cls, now }) {
  const state = classState(cls, now);
  return <section className={`next-class ${state === 'live' ? 'is-live' : ''}`}>
    <div>
      <span className="eyebrow">{state !== 'live' ? 'YOUR NEXT CLASS' : now < new Date(cls.starts_at).getTime() ? 'STARTING SOON · YOU CAN JOIN NOW' : 'HAPPENING NOW'}</span>
      <h2>{cls.subject}{cls.topic ? `: ${cls.topic}` : ''}</h2>
      <p className="next-when">{dayLabel(cls.starts_at)} · {timeLabel(cls.starts_at)}<span> ({relativeLabel(cls.starts_at, now)})</span></p>
      <p className="muted small">{cls.duration_minutes} minutes on {platformName(cls.meeting_url)} · shown in your time ({placeName(localZone)})</p>
      {cls.rescheduled_from && <p className="moved-note">Moved from {dateTimeLabel(cls.rescheduled_from)}</p>}
    </div>
    <JoinButton cls={cls} now={now}/>
  </section>;
}

function SubmitForm({ hw, userId, reload, resubmit }) {
  const files = useRef(null);
  const [note, setNote] = useState(hw.submission?.note ?? '');
  const { busy, error, setError, run } = useAction();
  const submit = (event) => {
    event.preventDefault();
    const chosen = Array.from(files.current.files);
    if (!chosen.length) { setError('Choose at least one photo or PDF of your work.'); return; }
    if (chosen.length > MAX_FILES) { setError(`You can upload up to ${MAX_FILES} files.`); return; }
    for (const file of chosen) { const problem = checkFile(file); if (problem) { setError(problem); return; } }
    run(async () => {
      const paths = [];
      for (const file of chosen) paths.push(await uploadFile(`${userId}/submissions`, file));
      must(await supabase.from('submissions').upsert({ homework_id: hw.id, student_id: userId, file_paths: paths, note: note.trim() || null, submitted_at: new Date().toISOString() }, { onConflict: 'homework_id' }));
      await reload();
    });
  };
  return <form className="form submit-form" onSubmit={submit}>
    <label>{resubmit ? 'Replace your answer' : 'Your answer'} <span className="optional">(photos or PDF, up to {MAX_FILES} files, 10 MB each)</span><input ref={files} type="file" accept={ACCEPTED_FILES} multiple required/></label>
    <label>Message for your teacher <span className="optional">(optional)</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="e.g. I found question 4 tricky."/></label>
    <Notice>{error}</Notice>
    <button className="btn btn-primary" disabled={busy}><Upload size={17}/>{busy ? 'Uploading…' : resubmit ? 'Hand in again' : 'Hand in'}</button>
  </form>;
}

function HomeworkCard({ hw, userId, reload, now }) {
  const [resubmitting, setResubmitting] = useState(false);
  const sub = hw.submission;
  const overdue = !sub && !hw.marked_at && hw.due_at && new Date(hw.due_at).getTime() < now;
  return <li className={`hw-card ${hw.marked_at ? 'is-marked' : ''}`}>
    <div className="hw-card-head">
      <div><span className="subject-tag">{hw.subject}</span><h3>{hw.title}</h3></div>
      {hw.marked_at ? <span className="badge badge-success">Marked</span> : sub ? <span className="badge badge-accent">Handed in</span> : overdue ? <span className="badge badge-warn">Overdue</span> : hw.due_at ? <span className="badge badge-muted">Due {relativeLabel(hw.due_at, now)}</span> : null}
    </div>
    {hw.due_at && <p className="muted small">Due {dateTimeLabel(hw.due_at)}</p>}
    {hw.instructions && <p className="pre">{hw.instructions}</p>}
    {hw.attachment_path && <p className="file-row"><span className="muted small">Worksheet:</span><FileLink path={hw.attachment_path}/></p>}
    {hw.marked_at && <div className="marks">
      {hw.score != null && hw.out_of ? <strong className="score">{hw.score}<small> / {hw.out_of}</small></strong> : <strong><CheckCircle2 size={18}/> Checked by your teacher</strong>}
      {hw.feedback && <p className="pre feedback">{hw.feedback}</p>}
    </div>}
    {sub && <div className="submission">
      <span className="muted small">You handed this in {dateTimeLabel(sub.submitted_at)}</span>
      <div className="file-list">{sub.file_paths.map((p) => <FileLink key={p} path={p}/>)}</div>
    </div>}
    {!hw.marked_at && (!sub ? <SubmitForm hw={hw} userId={userId} reload={reload}/>
      : resubmitting ? <SubmitForm hw={hw} userId={userId} reload={async () => { setResubmitting(false); await reload(); }} resubmit/>
      : <button className="link-btn" onClick={() => setResubmitting(true)}>Need to change it? Hand in again</button>)}
  </li>;
}

export default function Student({ profile }) {
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('todo');
  const [refreshing, setRefreshing] = useState(false);
  const [runningTest, setRunningTest] = useState(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const since = new Date(Date.now() - 3 * 3600000).toISOString();
      const [classes, homework, tests] = await Promise.all([
        supabase.from('classes').select('*').gte('starts_at', since).order('starts_at').limit(50).then(must),
        supabase.from('homework').select('*, submissions(*)').order('created_at', { ascending: false }).limit(200).then(must),
        supabase.from('tests').select('*, test_attempts(*)').order('opens_at', { ascending: false }).limit(100).then(({ data: rows, error: e }) => (e ? [] : rows)),
      ]);
      setData({ classes, tests, homework: homework.map((h) => ({ ...h, submission: firstOf(h.submissions) })) });
      setError('');
    } catch (err) {
      setError(`Couldn’t load your classes: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (runningTest) return undefined; // don't reload underneath a running test
    let last = Date.now();
    const onFocus = () => { if (Date.now() - last > 60000 && !document.activeElement?.closest('form')) { last = Date.now(); load(); } };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, runningTest]);

  if (runningTest) return <TestRunner test={runningTest} onClose={() => { setRunningTest(null); load(); }}/>;
  if (!data) return error ? <Notice>{error}</Notice> : <Spinner/>;

  const active = data.classes.filter((c) => classState(c, now) !== 'ended');
  const next = active.find((c) => c.status !== 'cancelled');
  const later = active.filter((c) => c !== next).slice(0, 8);
  const todo = data.homework.filter((h) => !h.submission && !h.marked_at).sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
  const waiting = data.homework.filter((h) => h.submission && !h.marked_at);
  const marked = data.homework.filter((h) => h.marked_at);
  const lists = { todo, waiting, marked };
  const hwTabs = [['todo', 'To do', todo.length], ['waiting', 'Handed in', waiting.length], ['marked', 'Marked', marked.length]];

  return <div className="stack-lg">
    <section className="welcome">
      <div><span className="eyebrow">STUDENT PORTAL</span><h1>Hi {profile.full_name.split(' ')[0]} 👋</h1></div>
      <button className="btn btn-ghost btn-small" onClick={load} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''}/>Refresh</button>
    </section>
    <Notice>{error}</Notice>

    {next ? <NextClass cls={next} now={now}/> : <section className="next-class"><div><span className="eyebrow">YOUR NEXT CLASS</span><h2>No class booked yet</h2><p className="muted">Your teacher will add your next class here.</p></div><Video size={34} className="muted"/></section>}

    <div className="split">
      <div className="stack">
        <section className="card">
          <h2 className="card-title"><ShieldCheck size={20}/>Tests</h2>
          <StudentTests tests={data.tests} now={now} onStart={setRunningTest}/>
        </section>
        <section className="card">
          <h2 className="card-title"><RotateCcw size={20}/>Mistake notebook</h2>
          <Practice/>
        </section>
      </div>
      <section className="card">
        <h2 className="card-title"><LineChart size={20}/>My progress</h2>
        <ProgressChart points={progressPoints(data.homework, data.tests)} title="Your scores"/>
      </section>
    </div>

    <div className="split">
      <section className="card">
        <h2 className="card-title"><ClipboardList size={20}/>Homework</h2>
        <nav className="tabs tabs-small" role="tablist" aria-label="Homework">
          {hwTabs.map(([id, label, count]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>{label}<span className="tab-count">{count}</span></button>)}
        </nav>
        {lists[tab].length ? <ul className="hw-cards">{lists[tab].map((h) => <HomeworkCard key={h.id} hw={h} userId={profile.id} reload={load} now={now}/>)}</ul>
          : <Empty icon={BookOpenCheck} title={tab === 'todo' ? 'All done!' : tab === 'waiting' ? 'Nothing waiting' : 'Nothing marked yet'}>{tab === 'todo' ? 'No homework to do right now.' : null}</Empty>}
      </section>
      <section className="card">
        <h2 className="card-title"><CalendarDays size={20}/>Coming up</h2>
        <p className="hint">Times shown in your time ({placeName(localZone)}).</p>
        {later.length ? <ul className="class-list">{later.map((c) => <li key={c.id} className={`class-row state-${classState(c, now)}`}>
          <div className="class-time"><strong>{dayLabel(c.starts_at)}</strong><span>{timeLabel(c.starts_at)}</span></div>
          <div className="class-info"><strong>{c.subject}</strong>{c.topic && <span>{c.topic}</span>}{c.rescheduled_from && <span className="badge badge-accent moved">Moved from {dateTimeLabel(c.rescheduled_from)}</span>}<span className="muted small">{c.duration_minutes} min · {platformName(c.meeting_url)}</span></div>
          <div className="class-actions"><JoinButton cls={c} now={now}/></div>
        </li>)}</ul> : <Empty icon={CalendarDays} title="Nothing else booked">More classes will show up here.</Empty>}
      </section>
    </div>
  </div>;
}
