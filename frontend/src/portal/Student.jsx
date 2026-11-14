import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookMarked, BookOpenCheck, CalendarDays, CheckCircle2, ClipboardList, KeyRound, LayoutDashboard, LineChart, LogOut, PlayCircle, RefreshCw, RotateCcw, ShieldCheck, Trophy, Upload } from 'lucide-react';
import Practice from './Practice';
import ProgressChart, { progressPoints } from './ProgressChart';
import StudentTests from './StudentTests';
import TestRunner from './TestRunner';
import { MyBoard, MySyllabus } from './Syllabus';
import { Goals, SectionHead, avatarTone, first, greeting, initials, pct, subjectTone } from './workspaceParts';
import { ACCEPTED_FILES, checkFile, firstOf, must, supabase, uploadFile } from './supabase';
import { Empty, FileLink, JoinButton, Notice, Spinner, classState, platformName, useAction, useNow } from './shared';
import { dateTimeLabel, dayLabel, localZone, placeName, relativeLabel, timeLabel } from './time';
import './app-layout.css';

// The student's own app: a rail (bottom bar on phones) with Home · Homework · Tests · Practice · Progress · Me.

const MAX_FILES = 6;

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

function HomeworkCard({ hw, userId, reload, now, highlight = false }) {
  const [resubmitting, setResubmitting] = useState(false);
  const sub = hw.submission;
  const overdue = !sub && !hw.marked_at && hw.due_at && new Date(hw.due_at).getTime() < now;
  return <li id={`hw-${hw.id}`} className={`hw-card ${hw.marked_at ? 'is-marked' : ''} ${highlight ? 'is-highlight' : ''}`}>
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

// ─── Layout: a rail (bottom bar on phones) + one page per section ─────────
const RAIL = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'homework', label: 'Homework', icon: ClipboardList },
  { id: 'tests', label: 'Tests', icon: ShieldCheck },
  { id: 'practice', label: 'Practice', icon: RotateCcw },
  { id: 'progress', label: 'Progress', icon: LineChart },
];
const VIEWS = [...RAIL.map((r) => r.id), 'me'];
const readView = () => { const v = location.hash.slice(1); return VIEWS.includes(v) ? v : 'home'; };

/** Open tests (start now) first, then homework by due date. */
function TodoCards({ tests, homework, now, onStart, onHomework }) {
  if (!tests.length && !homework.length) return <p className="ws-quiet ws-all-done"><CheckCircle2 size={18}/>All done! Nothing to do right now. 🎉</p>;
  return <div className="ws-cards">
    {tests.map((t) => <button key={t.id} className="ws-card" onClick={() => onStart(t)}>
      <span className={`ws-card-strip ${subjectTone(t.subject)}`}><ShieldCheck size={16}/>Test · {t.subject}</span>
      <span className="ws-card-body">
        <strong>{t.title}</strong>
        <span className="ws-card-foot"><span className="muted small">Closes {relativeLabel(t.closes_at, now)}</span><span className="badge badge-accent"><PlayCircle size={13}/>{firstOf(t.test_attempts) ? 'Continue' : 'Start'}</span></span>
      </span>
    </button>)}
    {homework.map((h) => {
      const overdue = h.due_at && new Date(h.due_at).getTime() < now;
      return <button key={h.id} className="ws-card" onClick={() => onHomework(h.id)}>
        <span className={`ws-card-strip ${subjectTone(h.subject)}`}><ClipboardList size={16}/>{h.subject}</span>
        <span className="ws-card-body">
          <strong>{h.title}</strong>
          <span className={`small ${overdue ? 'text-warn' : 'muted'}`}>{h.due_at ? `${overdue ? 'Overdue · was due' : 'Due'} ${relativeLabel(h.due_at, now)}` : 'No due date'}</span>
        </span>
      </button>;
    })}
  </div>;
}

function FeedbackCards({ items, onOpen }) {
  return <div className="ws-cards">
    {items.map((h) => <button key={h.id} className="ws-card" onClick={() => onOpen(h.id)}>
      <span className={`ws-card-strip ${subjectTone(h.subject)}`}><CheckCircle2 size={16}/>{h.subject}</span>
      <span className="ws-card-body">
        <strong>{h.title}</strong>
        {h.feedback && <span className="small muted ws-card-quote">“{h.feedback.length > 90 ? `${h.feedback.slice(0, 90)}…` : h.feedback}”</span>}
        <span className="ws-card-foot"><span className="muted small">Marked {dayLabel(h.marked_at)}</span>
          <span className="badge badge-success">{h.score != null && h.out_of ? `${h.score}/${h.out_of}` : 'Checked'}</span></span>
      </span>
    </button>)}
  </div>;
}

function Banner({ profile, next, wins, now, onProgress, onBoard }) {
  return <section className="ws-banner">
    <div className="ws-banner-hello">
      <span className="ws-banner-avatar" style={avatarTone(profile.full_name)} aria-hidden="true">{initials(profile.full_name)}</span>
      <div>
        <p className="ws-banner-greet">{greeting(localZone)}</p>
        <h1>{first(profile.full_name).toUpperCase()}!</h1>
        <p className="muted small">{profile.board && profile.grade ? `${profile.board} · ${profile.grade}` : <button className="link-btn" onClick={onBoard}>Choose your board and year</button>}</p>
      </div>
    </div>
    <div className="ws-banner-next">
      <span className="ws-label">{next && classState(next, now) === 'live' ? (now < new Date(next.starts_at).getTime() ? 'Starting soon · join now' : 'Happening now') : 'Your next class'}</span>
      {next ? <>
        <strong>{dayLabel(next.starts_at)} · {timeLabel(next.starts_at)}</strong>
        <span className="muted small">{next.subject}{next.topic ? `: ${next.topic}` : ''} · {relativeLabel(next.starts_at, now)}</span>
        {next.rescheduled_from && <span className="moved-note">Moved from {dateTimeLabel(next.rescheduled_from)}</span>}
        <JoinButton cls={next} now={now}/>
      </> : <span className="muted small">No class booked yet. Your teacher will add it here.</span>}
    </div>
    <div className="ws-banner-wins">
      {wins.length ? wins.map(({ t, a }) => <span key={t.id} className={`ws-win ${pct(a) >= 70 ? 'good' : pct(a) >= 40 ? 'ok' : 'low'}`} title={`${t.title}: ${pct(a)}%`}>{pct(a)}%</span>)
        : <span className="ws-win no-score" title="Your test scores will show here"><Trophy size={18}/></span>}
      <button className="ws-wins-all" onClick={onProgress}><LineChart size={18}/><span>My progress</span></button>
    </div>
  </section>;
}

export default function Student({ profile, onProfileChange = () => {}, onChangePassword = () => {} }) {
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(readView);
  const [hwTab, setHwTab] = useState('todo');
  const [focusHw, setFocusHw] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [runningTest, setRunningTest] = useState(null);
  const [changingBoard, setChangingBoard] = useState(false);

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
  useEffect(() => { const on = () => { if (!location.hash.startsWith('#live/')) setView(readView()); }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  // Opening a homework card from Home: scroll to it on the Homework page and highlight it briefly.
  useEffect(() => {
    if (view !== 'homework' || !focusHw) return undefined;
    const id = setTimeout(() => document.getElementById(`hw-${focusHw}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    const clear = setTimeout(() => setFocusHw(null), 2500);
    return () => { clearTimeout(id); clearTimeout(clear); };
  }, [view, focusHw]);

  const go = (next) => {
    setView(next); setChangingBoard(false);
    if (location.hash !== `#${next}`) history.pushState(null, '', `#${next}`);
    document.querySelector('.t-main')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };

  if (runningTest) {
    // Best finished score before this test, so the result screen can celebrate a new personal best.
    const earlier = (data?.tests ?? []).filter((t) => t.id !== runningTest.id).map((t) => firstOf(t.test_attempts))
      .filter((a) => a?.finished_at && !a.pending_marks && Number(a.max_points)).map((a) => Math.round((Number(a.points) / Number(a.max_points)) * 100));
    return <TestRunner test={runningTest} bestBefore={earlier.length ? Math.max(...earlier) : -1} onClose={() => { setRunningTest(null); load(); }}/>;
  }

  const todo = data ? data.homework.filter((h) => !h.submission && !h.marked_at).sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999')) : [];
  const waiting = data ? data.homework.filter((h) => h.submission && !h.marked_at) : [];
  const marked = data ? data.homework.filter((h) => h.marked_at).sort((a, b) => b.marked_at.localeCompare(a.marked_at)) : [];
  const openTests = data ? data.tests.filter((t) => { const a = firstOf(t.test_attempts); return !a?.finished_at && now >= new Date(t.opens_at).getTime() && now <= new Date(t.closes_at).getTime(); })
    .sort((a, b) => a.closes_at.localeCompare(b.closes_at)) : [];
  const railCount = { homework: todo.length, tests: openTests.length };
  const needsBoard = !profile.board || !profile.grade;

  const page = (() => {
    if (!data) return error ? <div className="t-page"><Notice>{error}</Notice></div> : <Spinner/>;
    const active = data.classes.filter((c) => classState(c, now) !== 'ended');
    const next = active.find((c) => c.status !== 'cancelled');
    const later = active.filter((c) => c !== next).slice(0, 8);
    const wins = data.tests.map((t) => ({ t, a: firstOf(t.test_attempts) })).filter(({ a }) => a?.finished_at && !a.pending_marks && pct(a) !== null)
      .sort((x, y) => y.a.finished_at.localeCompare(x.a.finished_at)).slice(0, 3);
    const openHomework = (id) => { const h = data.homework.find((x) => x.id === id); setHwTab(h?.marked_at ? 'marked' : h?.submission ? 'waiting' : 'todo'); setFocusHw(id); go('homework'); };
    const lists = { todo, waiting, marked };
    const hwTabs = [['todo', 'To do', todo.length], ['waiting', 'Handed in', waiting.length], ['marked', 'Marked', marked.length]];
    const refresh = <button className="btn btn-ghost btn-small" onClick={load} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''}/>Refresh</button>;

    if (view === 'home') return <div className="ws s-home">
      <div className="s-top"><span className="eyebrow">STUDENT PORTAL</span>{refresh}</div>
      <Notice>{error}</Notice>
      <div className="ws-home">
        <Banner profile={profile} next={next} wins={wins} now={now} onProgress={() => go('progress')} onBoard={() => go('me')}/>
        {needsBoard && <MyBoard profile={profile} onSaved={(v) => onProfileChange(v)}/>}
        <section className="ws-section">
          <SectionHead title="TO DO" count={openTests.length + todo.length}>{(openTests.length + todo.length) > 0 && <button className="link-btn" onClick={() => go('homework')}>All homework</button>}</SectionHead>
          <TodoCards tests={openTests} homework={todo} now={now} onStart={setRunningTest} onHomework={openHomework}/>
        </section>
        {marked.length > 0 && <section className="ws-section">
          <SectionHead title="FEEDBACK FROM YOUR TEACHER" count={Math.min(marked.length, 6)}><button className="link-btn" onClick={() => { setHwTab('marked'); go('homework'); }}>See all</button></SectionHead>
          <FeedbackCards items={marked.slice(0, 6)} onOpen={openHomework}/>
        </section>}
        <section className="ws-section">
          <SectionHead title="MISTAKE NOTEBOOK"/>
          <button className="s-notebook" onClick={() => go('practice')}><RotateCcw size={22}/><span><strong>Practise the questions you got wrong</strong><span className="muted small">No timer, no score. A question leaves your notebook once you get it right.</span></span><ArrowRight size={18}/></button>
        </section>
        <section className="ws-section">
          <SectionHead title="MY EXAM GOAL"/>
          <Goals student={profile} forStudent onOpen={() => go('progress')}/>
        </section>
        <section className="ws-section">
          <SectionHead title="COMING UP" count={later.length}/>
          <p className="hint">Times shown in your time ({placeName(localZone)}).</p>
          {later.length ? <ul className="class-list">{later.map((c) => <li key={c.id} className={`class-row state-${classState(c, now)}`}>
            <div className="class-time"><strong>{dayLabel(c.starts_at)}</strong><span>{timeLabel(c.starts_at)}</span></div>
            <div className="class-info"><strong>{c.subject}</strong>{c.topic && <span>{c.topic}</span>}{c.rescheduled_from && <span className="badge badge-accent moved">Moved from {dateTimeLabel(c.rescheduled_from)}</span>}<span className="muted small">{c.duration_minutes} min · {platformName(c.meeting_url)}</span></div>
            <div className="class-actions"><JoinButton cls={c} now={now}/></div>
          </li>)}</ul> : <p className="muted small ws-quiet"><CalendarDays size={16}/>Nothing else booked yet.</p>}
        </section>
      </div>
    </div>;

    if (view === 'homework') return <div className="t-page s-page">
      <div className="s-page-head"><h1 className="t-page-title">Homework</h1>{refresh}</div>
      <section className="card">
        <nav className="tabs tabs-small" role="tablist" aria-label="Homework">
          {hwTabs.map(([id, label, count]) => <button key={id} role="tab" aria-selected={hwTab === id} className={hwTab === id ? 'tab active' : 'tab'} onClick={() => setHwTab(id)}>{label}<span className="tab-count">{count}</span></button>)}
        </nav>
        {lists[hwTab].length ? <ul className="hw-cards">{lists[hwTab].map((h) => <HomeworkCard key={h.id} hw={h} userId={profile.id} reload={load} now={now} highlight={focusHw === h.id}/>)}</ul>
          : <Empty icon={BookOpenCheck} title={hwTab === 'todo' ? 'All done!' : hwTab === 'waiting' ? 'Nothing waiting' : 'Nothing marked yet'}>{hwTab === 'todo' ? 'No homework to do right now.' : null}</Empty>}
      </section>
    </div>;

    if (view === 'tests') return <div className="t-page s-page">
      <div className="s-page-head"><h1 className="t-page-title">Tests</h1>{refresh}</div>
      <section className="card"><StudentTests tests={data.tests} now={now} onStart={setRunningTest}/></section>
    </div>;

    if (view === 'practice') return <div className="t-page s-page">
      <h1 className="t-page-title">Mistake notebook</h1>
      <section className="card"><Practice/></section>
    </div>;

    if (view === 'progress') return <div className="t-page s-page stack-lg">
      <h1 className="t-page-title">My progress</h1>
      <section className="card"><ProgressChart points={progressPoints(data.homework, data.tests)} title="Your scores"/></section>
      <section className="card">
        <div className="card-head-row">
          <h2 className="card-title"><BookMarked size={20}/>My syllabus</h2>
          {profile.board && profile.grade && !changingBoard && <span className="muted small">{profile.board} · {profile.grade} <button className="link-btn" onClick={() => setChangingBoard(true)}>Change</button></span>}
        </div>
        {changingBoard && <MyBoard profile={profile} onSaved={(v) => { onProfileChange(v); setChangingBoard(false); }} onCancel={() => setChangingBoard(false)}/>}
        <MySyllabus profile={profile}/>
      </section>
    </div>;

    return <div className="t-page s-page stack">
      <h1 className="t-page-title">Me</h1>
      <section className="card t-account">
        <span className="t-avatar big" style={avatarTone(profile.full_name)} aria-hidden="true">{initials(profile.full_name)}</span>
        <div><strong>{profile.full_name}</strong><span className="muted small">{[profile.grade, profile.board].filter(Boolean).join(' · ') || 'Student'}</span></div>
        <div className="row">
          <button className="btn btn-ghost btn-small" onClick={onChangePassword}><KeyRound size={16}/>Change password</button>
          <button className="btn btn-ghost btn-small" onClick={() => supabase.auth.signOut()}><LogOut size={16}/>Sign out</button>
        </div>
      </section>
      <MyBoard key={`${profile.board}-${profile.grade}`} profile={profile} onSaved={(v) => onProfileChange(v)}/>
      <p className="hint"><a href="/privacy/">Privacy policy</a> · Need help? Message your teacher on WhatsApp.</p>
    </div>;
  })();

  return <div className="t-app s-app">
    <nav className="t-rail" aria-label="Sections">
      <a className="t-rail-logo" href="/" title="Kulkarni Academy website"><img src="/kulkarni-academy-logo.png" alt="Kulkarni Academy" width="300" height="538"/></a>
      {RAIL.map(({ id, label, icon: Icon }) => <button key={id} className={`t-rail-btn ${view === id ? 'active' : ''}`} onClick={() => go(id)} aria-current={view === id ? 'page' : undefined} title={label}>
        <Icon size={22}/><span>{label}</span>{railCount[id] > 0 && <span className="t-rail-count">{railCount[id]}</span>}
      </button>)}
      <span className="t-rail-spacer"/>
      <button className={`t-rail-btn ${view === 'me' ? 'active' : ''}`} onClick={() => go('me')} title="My account"><span className="t-rail-avatar" style={avatarTone(profile.full_name)} aria-hidden="true">{initials(profile.full_name)}</span><span>Me</span></button>
    </nav>
    <main className="t-main">{page}</main>
  </div>;
}
