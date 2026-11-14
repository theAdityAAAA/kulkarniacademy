import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, CalendarPlus, CheckCircle2, ClipboardCheck, Clock, FileText, KeyRound, LineChart, PenLine, Plus, Search, Send, ShieldCheck, Trophy, UserRound, Wand2, X } from 'lucide-react';
import ParentReport from './ParentReport';
import ProgressChart, { progressPoints } from './ProgressChart';
import { BoardGradeFields } from './boards';
import { SyllabusPanel } from './Syllabus';
import { Goals, SectionHead, avatarTone, first, greeting, initials, pct, subjectTone, testStatus } from './workspaceParts';
import { ClassRow, ScheduleForm } from './TeacherClasses';
import TeacherHomework, { AssignForm, HomeworkItem } from './TeacherHomework';
import { NewPaper, PaperView, ResultGroup, groupAttempts } from './TestPapers';
import { CredentialsCard, ZoneSelect, generatePassword } from './TeacherStudents';
import { api, firstOf, must, supabase } from './supabase';
import { Empty, JoinButton, Notice, classState, useAction } from './shared';
import { dateTimeLabel, dayLabel, isValidZone, placeName, timeLabel } from './time';

// One student's workspace: everything about them in one place (Home · Progress · Syllabus · Profile).

/** A pop-up sheet for forms opened from the workspace (set homework, schedule a class, open homework). */
function Sheet({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="modal sheet" onClose={onClose} onCancel={onClose} aria-label={title}>
    <button className="icon-btn modal-close" onClick={() => ref.current.close()} aria-label="Close"><X size={20}/></button>
    {children}
  </dialog>;
}

// ─── Home ─────────────────────────────────────────────────────────────────
function Banner({ student, classes, tests, now, onSchedule, onResults }) {
  const next = classes.filter((c) => c.status !== 'cancelled' && classState(c, now) !== 'ended').sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const wins = tests.map((t) => ({ t, a: firstOf(t.test_attempts) })).filter(({ a }) => a?.finished_at && !a.pending_marks && pct(a) !== null)
    .sort((x, y) => y.a.finished_at.localeCompare(x.a.finished_at)).slice(0, 3);
  return <section className="ws-banner">
    <div className="ws-banner-hello">
      <span className="ws-banner-avatar" style={avatarTone(student.full_name)} aria-hidden="true">{initials(student.full_name)}</span>
      <div>
        <p className="ws-banner-greet">{greeting(student.timezone)}</p>
        <h1>{first(student.full_name).toUpperCase()}!</h1>
        <p className="muted small">{timeLabel(new Date(now), student.timezone)} in {placeName(student.timezone)}{student.grade || student.board ? ` · ${[student.grade, student.board].filter(Boolean).join(' · ')}` : ''}</p>
      </div>
    </div>
    <div className="ws-banner-next">
      <span className="ws-label">Next class</span>
      {next ? <>
        <strong>{dayLabel(next.starts_at)} · {timeLabel(next.starts_at)}</strong>
        <span className="muted small">{next.subject}{next.topic ? `: ${next.topic}` : ''} · {timeLabel(next.starts_at, student.timezone)} for {first(student.full_name)}</span>
        <JoinButton cls={next} now={now} teacher/>
      </> : <><span className="muted small">Nothing booked</span><button className="btn btn-primary btn-small" onClick={onSchedule}><CalendarPlus size={15}/>Schedule</button></>}
    </div>
    <div className="ws-banner-wins">
      {wins.length ? wins.map(({ t, a }) => <span key={t.id} className={`ws-win ${pct(a) >= 70 ? 'good' : pct(a) >= 40 ? 'ok' : 'low'}`} title={`${t.title}: ${pct(a)}%`}>{pct(a)}%</span>)
        : <span className="ws-win no-score" title="No test results yet"><Trophy size={18}/></span>}
      <button className="ws-wins-all" onClick={onResults}><LineChart size={18}/><span>All results</span></button>
    </div>
  </section>;
}

function HomeworkCards({ items, now, onOpen, onAdd }) {
  return <div className="ws-cards">
    {items.map((h) => {
      const overdue = h.due_at && new Date(h.due_at).getTime() < now;
      return <button key={h.id} className="ws-card" onClick={() => onOpen(h)}>
        <span className={`ws-card-strip ${subjectTone(h.subject)}`}><ClipboardCheck size={16}/>{h.subject}</span>
        <span className="ws-card-body">
          <strong>{h.title}</strong>
          <span className={`small ${overdue ? 'text-warn' : 'muted'}`}>{h.due_at ? `${overdue ? 'Overdue · was due' : 'Due'} ${dayLabel(h.due_at)}` : 'No due date'}</span>
        </span>
      </button>;
    })}
    <button className="ws-card ws-card-add" onClick={onAdd}><Plus size={22}/><span>Set homework</span></button>
  </div>;
}

function TestCards({ tests, now, onOpen, onAdd }) {
  return <div className="ws-cards">
    {tests.map((t) => {
      const st = testStatus(t, now);
      return <button key={t.id} className="ws-card" onClick={() => onOpen(t.paper_id)}>
        <span className={`ws-card-strip ${subjectTone(t.subject)}`}><ShieldCheck size={16}/>{t.subject}{(t.attempt_no ?? 1) > 1 ? ` · attempt ${t.attempt_no}` : ''}</span>
        <span className="ws-card-body">
          <strong>{t.title}</strong>
          <span className="ws-card-foot"><span className="muted small">{dayLabel(t.opens_at)}</span><span className={`badge ${st.cls}`}>{st.label}</span></span>
        </span>
      </button>;
    })}
    <button className="ws-card ws-card-add" onClick={onAdd}><Send size={20}/><span>Give a test</span></button>
  </div>;
}

function HomeTab({ student, data, now, reload, openPaper, giveTest, setTab }) {
  const [sheet, setSheet] = useState(null); // { kind: 'homework' | 'assign' | 'schedule', hw }
  const mine = (rows) => rows.filter((r) => r.student_id === student.id);
  const homework = mine(data.homework);
  const tests = mine(data.tests);
  const classes = mine(data.classes);
  const todo = homework.filter((h) => !h.submission && !h.marked_at).sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
  const toMark = homework.filter((h) => h.submission && !h.marked_at);
  const testsToMark = tests.filter((t) => firstOf(t.test_attempts)?.pending_marks > 0);
  const pending = toMark.length + testsToMark.length;
  const [reviewOpen, setReviewOpen] = useState(pending > 0);
  const upcoming = classes.filter((c) => classState(c, now) !== 'ended').sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 5);
  const recentTests = [...tests].sort((a, b) => b.opens_at.localeCompare(a.opens_at)).slice(0, 12);
  const latestHw = sheet?.hw && data.homework.find((h) => h.id === sheet.hw.id);

  return <div className="ws-home">
    <Banner student={student} classes={classes} tests={tests} now={now} onSchedule={() => setSheet({ kind: 'schedule' })} onResults={() => setTab('progress')}/>

    <section className="ws-section">
      <SectionHead title="ASSIGNED HOMEWORK" count={todo.length}/>
      <HomeworkCards items={todo} now={now} onOpen={(hw) => setSheet({ kind: 'homework', hw })} onAdd={() => setSheet({ kind: 'assign' })}/>
    </section>

    <section className="ws-section">
      <SectionHead title="PENDING FOR REVIEW" count={pending} open={reviewOpen} onToggle={() => setReviewOpen(!reviewOpen)}/>
      {reviewOpen && (pending
        ? <ul className="hw-list">
            {testsToMark.map((t) => <li key={t.id} className="ws-review-test"><span><ShieldCheck size={17}/><strong>{t.title}</strong><span className="muted small"> · written answers to mark</span></span><button className="btn btn-primary btn-small" onClick={() => openPaper(t.paper_id)}><PenLine size={15}/>Mark</button></li>)}
            {toMark.map((h) => <HomeworkItem key={h.id} hw={h} student={student} reload={reload}/>)}
          </ul>
        : <p className="muted small ws-quiet"><CheckCircle2 size={16}/>Nothing to review. All caught up.</p>)}
    </section>

    <section className="ws-section">
      <SectionHead title="TESTS" count={tests.length}><button className="link-btn" onClick={() => setTab('tests')}>All of {first(student.full_name)}’s tests</button></SectionHead>
      <TestCards tests={recentTests} now={now} onOpen={openPaper} onAdd={giveTest}/>
    </section>

    <section className="ws-section">
      <SectionHead title="UPCOMING CLASSES" count={upcoming.length}><button className="link-btn" onClick={() => setSheet({ kind: 'schedule' })}><CalendarPlus size={15}/>Schedule a class</button></SectionHead>
      {upcoming.length ? <ul className="class-list ws-classes">{upcoming.map((c) => <ClassRow key={c.id} cls={c} student={student} now={now} reload={reload}/>)}</ul>
        : <p className="muted small ws-quiet"><Clock size={16}/>No classes booked. <button className="link-btn" onClick={() => setSheet({ kind: 'schedule' })}>Schedule one</button></p>}
    </section>

    <section className="ws-section">
      <SectionHead title="GOALS"><button className="link-btn" onClick={() => setTab('syllabus')}><Plus size={15}/>Add syllabus</button></SectionHead>
      <Goals student={student} onOpen={() => setTab('syllabus')}/>
    </section>

    {sheet?.kind === 'homework' && latestHw && <Sheet title={latestHw.title} onClose={() => setSheet(null)}><ul className="hw-list sheet-list"><HomeworkItem hw={latestHw} student={student} reload={reload} startOpen/></ul></Sheet>}
    {sheet?.kind === 'assign' && <Sheet title="Set homework" onClose={() => setSheet(null)}><AssignForm students={[student]} fixedStudent={student} reload={reload}/></Sheet>}
    {sheet?.kind === 'schedule' && <Sheet title="Schedule a class" onClose={() => setSheet(null)}><ScheduleForm students={[student]} classes={data.classes} fixedStudent={student} reload={reload}/></Sheet>}
  </div>;
}

// ─── Progress ─────────────────────────────────────────────────────────────
function ProgressTab({ student, data, now }) {
  const [report, setReport] = useState(false);
  const homework = data.homework.filter((h) => h.student_id === student.id);
  const tests = data.tests.filter((t) => t.student_id === student.id);
  const done = tests.map((t) => ({ t, a: firstOf(t.test_attempts) })).filter(({ a }) => a?.finished_at).sort((x, y) => y.a.finished_at.localeCompare(x.a.finished_at));
  const marked = homework.filter((h) => h.marked_at).sort((a, b) => b.marked_at.localeCompare(a.marked_at));
  return <div className="ws-progress">
    <div className="ws-section-head"><h2 className="ws-section-title">PROGRESS</h2><button className="btn btn-primary btn-small" onClick={() => setReport(true)}><FileText size={15}/>Parent report</button></div>
    <section className="card"><ProgressChart points={progressPoints(homework, tests)} title={`${first(student.full_name)}’s scores`}/></section>
    <div className="split">
      <section className="card">
        <h2 className="card-title"><ShieldCheck size={20}/>Test results</h2>
        {done.length ? <table className="chart-table"><thead><tr><th>Date</th><th>Test</th><th>Score</th></tr></thead>
          <tbody>{done.map(({ t, a }) => { const st = testStatus(t, now); return <tr key={t.id}><td>{dayLabel(a.finished_at)}</td><td>{t.title}{(t.attempt_no ?? 1) > 1 ? ` (attempt ${t.attempt_no})` : ''}</td><td><span className={`badge ${st.cls}`}>{st.label}</span></td></tr>; })}</tbody></table>
          : <Empty icon={ShieldCheck} title="No test results yet"/>}
      </section>
      <section className="card">
        <h2 className="card-title"><ClipboardCheck size={20}/>Marked homework</h2>
        {marked.length ? <table className="chart-table"><thead><tr><th>Marked</th><th>Homework</th><th>Score</th></tr></thead>
          <tbody>{marked.slice(0, 30).map((h) => <tr key={h.id}><td>{dayLabel(h.marked_at)}</td><td>{h.title}</td><td>{h.score != null && h.out_of ? `${h.score}/${h.out_of}` : '✓'}</td></tr>)}</tbody></table>
          : <Empty icon={ClipboardCheck} title="Nothing marked yet"/>}
      </section>
    </div>
    {report && <ParentReport student={student} homework={homework} tests={tests} onClose={() => setReport(false)}/>}
  </div>;
}

// ─── Profile ──────────────────────────────────────────────────────────────
function ProfileTab({ student, login, now, reload }) {
  const blank = () => ({ full_name: student.full_name, grade: student.grade ?? '', board: student.board ?? '', timezone: student.timezone, meeting_url: student.meeting_url ?? '' });
  const [form, setForm] = useState(blank);
  const [saved, setSaved] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetDone, setResetDone] = useState(null);
  const { busy, error, setError, run } = useAction();
  const pw = useAction();
  useEffect(() => { setForm(blank()); }, [student.id, student.board, student.grade]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (field) => (event) => { setSaved(''); setForm((f) => ({ ...f, [field]: event.target.value })); };
  const save = (event) => {
    event.preventDefault();
    if (!isValidZone(form.timezone)) { setError('Choose a valid time zone.'); return; }
    const link = form.meeting_url.trim();
    if (link && !/^https:\/\/\S+$/.test(link)) { setError('The class link must start with https://'); return; }
    run(async () => {
      must(await supabase.from('profiles').update({ full_name: form.full_name.trim(), grade: form.grade.trim() || null, board: form.board.trim() || null, timezone: form.timezone, meeting_url: link || null }).eq('id', student.id));
      setSaved('Saved.');
      await reload();
    });
  };
  const reset = (event) => {
    event.preventDefault();
    pw.run(async () => {
      await api(`/admin/students/${student.id}/password`, { method: 'POST', body: { password: newPassword } });
      setResetDone({ name: student.full_name, email: login?.email ?? '(their login email)', password: newPassword });
      setNewPassword('');
    });
  };
  return <div className="split ws-profile">
    <form className="card form" onSubmit={save}>
      <h2 className="card-title"><PenLine size={20}/>Details</h2>
      <label>Name<input value={form.full_name} onChange={set('full_name')} required maxLength={80}/></label>
      <BoardGradeFields board={form.board} grade={form.grade} onChange={(v) => { setSaved(''); setForm((f) => ({ ...f, ...v })); }}/>
      <label>Time zone<ZoneSelect value={form.timezone} onChange={set('timezone')}/></label>
      <label>Usual class link <span className="optional">(optional)</span><input type="url" value={form.meeting_url} onChange={set('meeting_url')} placeholder="https://zoom.us/j/…" maxLength={500}/></label>
      <Notice>{error}</Notice>
      <Notice kind="success">{saved}</Notice>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
    </form>
    <div className="stack">
      <section className="card">
        <h2 className="card-title"><UserRound size={20}/>Account</h2>
        <dl className="facts">
          <div><dt>Login email</dt><dd>{login?.email ?? '…'}</dd></div>
          <div><dt>Their time now</dt><dd>{timeLabel(new Date(now), student.timezone)} in {placeName(student.timezone)}</dd></div>
          <div><dt>Last signed in</dt><dd>{login?.last_sign_in_at ? dateTimeLabel(login.last_sign_in_at) : 'Never'}</dd></div>
          <div><dt>Student since</dt><dd>{dayLabel(student.created_at)}</dd></div>
        </dl>
      </section>
      <section className="card">
        <h2 className="card-title"><KeyRound size={20}/>Reset password</h2>
        {resetDone ? <CredentialsCard {...resetDone}/> : <form className="form" onSubmit={reset}>
          <label>New password<span className="input-with-btn"><input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} maxLength={72} autoComplete="off" placeholder="Type or make one"/><button type="button" className="icon-btn" onClick={() => setNewPassword(generatePassword())} title="Make a new password" aria-label="Make a new password"><Wand2 size={18}/></button></span></label>
          <Notice>{pw.error}</Notice>
          <button className="btn btn-ghost btn-small" disabled={pw.busy || !newPassword}>{pw.busy ? 'Saving…' : 'Set new password'}</button>
        </form>}
      </section>
    </div>
  </div>;
}

// ─── Tests (this student only) ────────────────────────────────────────────
function TestsTab({ student, data, now, reload, focus }) {
  const [paperId, setPaperId] = useState(focus?.id ?? null);
  const [picking, setPicking] = useState(Boolean(focus?.pick));
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (focus?.id) { setPaperId(focus.id); setPicking(false); }
    else if (focus?.pick) { setPaperId(null); setPicking(true); }
  }, [focus?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data.testsReady) return <Notice>Tests need a database update. In Supabase, open SQL Editor, paste <code>supabase/004_test_papers.sql</code>, click Run, then refresh.</Notice>;

  const questionsOf = (id) => data.questions.filter((q) => q.paper_id === id && !q.archived).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const testsOf = (id) => data.tests.filter((t) => t.paper_id === id);
  const paper = data.papers.find((p) => p.id === paperId);
  const open = (id) => { setPaperId(id); setPicking(false); document.querySelector('.t-workspace')?.scrollTo({ top: 0 }); };
  if (paper) return <PaperView key={paper.id} paper={paper} questions={questionsOf(paper.id)} tests={testsOf(paper.id)} students={data.students} student={student}
    reload={reload} now={now} onBack={() => setPaperId(null)} onOpen={open}/>;

  const name = first(student.full_name);
  const mine = data.tests.filter((t) => t.student_id === student.id);
  const has = new Set(mine.map((t) => t.paper_id));
  const groups = groupAttempts(mine).sort((a, b) => b.at(-1).opens_at.localeCompare(a.at(-1).opens_at));
  const q = query.trim().toLowerCase();
  // Tests for the same grade/subject first, so the right one is easy to find with many tests.
  const library = data.papers.filter((p) => !q || `${p.title} ${p.subject} ${p.grade ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (has.has(a.id) - has.has(b.id)) || ((b.grade === student.grade) - (a.grade === student.grade)) || b.created_at.localeCompare(a.created_at));

  return <div className="ws-tests">
    <SectionHead title={`${name.toUpperCase()}’S TESTS`} count={groups.length}>
      <button className="btn btn-primary btn-small" onClick={() => setPicking(!picking)} aria-expanded={picking}><Send size={15}/>Give a test</button>
    </SectionHead>
    {picking && <div className="split ws-give">
      <NewPaper students={data.students} heading={`Make a new test for ${name}`} defaults={student.grade ? { grade: student.grade } : {}} onCreated={async (id) => { await reload(); open(id); }}/>
      <section className="card">
        <h2 className="card-title"><ClipboardCheck size={20}/>Or use a test you’ve made</h2>
        <div className="t-search ws-paper-search"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your tests" aria-label="Search your tests"/></div>
        {library.length ? <ul className="paper-list">{library.map((p) => <li key={p.id}><button className="paper-card" onClick={() => open(p.id)}>
          <span className="paper-main"><strong>{p.title}</strong><span className="muted small">{p.subject}{p.grade ? ` · ${p.grade}` : ''} · {questionsOf(p.id).length} questions</span></span>
          <span className="paper-meta">{has.has(p.id) ? <span className="badge badge-muted">{name} has it</span> : <span className="badge badge-accent">Give</span>}</span>
        </button></li>)}</ul> : <Empty icon={ClipboardCheck} title={data.papers.length ? 'No test matches' : 'No tests made yet'}>{data.papers.length ? null : 'Make the first one on the left.'}</Empty>}
      </section>
    </div>}
    {groups.length ? <ul className="hw-list">{groups.map((g) => <ResultGroup key={g[0].id} tests={g} student={student} title={g.at(-1).title}
        count={questionsOf(g[0].paper_id).length} reload={reload} now={now} onOpenPaper={() => open(g[0].paper_id)}/>)}</ul>
      : !picking && <Empty icon={ShieldCheck} title={`No tests for ${name} yet`}>Click “Give a test” to make one or reuse one you’ve made.</Empty>}
  </div>;
}

// ─── Homework (this student only) ─────────────────────────────────────────
function HomeworkTab({ student, data, reload }) {
  return <TeacherHomework students={[student]} fixedStudent={student} homework={data.homework.filter((h) => h.student_id === student.id)} reload={reload}/>;
}

const TABS = [['home', 'Home'], ['homework', 'Homework'], ['tests', 'Tests'], ['progress', 'Progress'], ['syllabus', 'Syllabus'], ['profile', 'Profile']];

export default function StudentWorkspace({ student, data, login, now, reload, focus = null, tab, setTab }) {
  // Which test to open (or "give a test") when switching to the Tests tab.
  const [testFocus, setTestFocus] = useState(focus);
  useEffect(() => { if (focus) setTestFocus(focus); }, [focus?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const openPaper = (id) => { setTestFocus({ id, at: Date.now() }); setTab('tests'); };
  const giveTest = () => { setTestFocus({ pick: true, at: Date.now() }); setTab('tests'); };
  return <div className="ws">
    <header className="ws-top">
      <span className="ws-top-name">{first(student.full_name)}’s workspace</span>
      <nav className="ws-tabs" role="tablist" aria-label={`${student.full_name}’s workspace`}>
        {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'ws-tab active' : 'ws-tab'} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <span className="ws-top-spacer"/>
    </header>
    <div className="ws-body" role="tabpanel">
      {tab === 'home' && <HomeTab student={student} data={data} now={now} reload={reload} openPaper={openPaper} giveTest={giveTest} setTab={setTab}/>}
      {tab === 'homework' && <HomeworkTab student={student} data={data} reload={reload}/>}
      {tab === 'tests' && <TestsTab student={student} data={data} now={now} reload={reload} focus={testFocus}/>}
      {tab === 'progress' && <ProgressTab student={student} data={data} now={now}/>}
      {tab === 'syllabus' && <section className="card"><h2 className="card-title"><BookMarked size={20}/>Syllabus</h2><p className="hint">Click a topic once for Taught, twice for Mastered. {first(student.full_name)} and their parents see the same list.</p><SyllabusPanel student={student}/></section>}
      {tab === 'profile' && <ProfileTab student={student} login={login} now={now} reload={reload}/>}
    </div>
  </div>;
}

