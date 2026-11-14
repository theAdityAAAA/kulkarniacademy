import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, CalendarPlus, CheckCircle2, ChevronDown, ClipboardCheck, Clock, FileText, KeyRound, LineChart, PenLine, Plus, Send, ShieldCheck, Target, Trophy, UserRound, Wand2, X } from 'lucide-react';
import ParentReport from './ParentReport';
import ProgressChart, { progressPoints } from './ProgressChart';
import { BoardGradeFields } from './boards';
import { SyllabusPanel, coverage, useStudentSyllabi } from './Syllabus';
import { ClassRow, ScheduleForm } from './TeacherClasses';
import { AssignForm, HomeworkItem } from './TeacherHomework';
import { CredentialsCard, ZoneSelect, generatePassword } from './TeacherStudents';
import { api, firstOf, must, supabase } from './supabase';
import { Empty, JoinButton, Notice, classState, useAction } from './shared';
import { dateTimeLabel, dayLabel, isValidZone, placeName, relativeLabel, timeLabel } from './time';

// One student's workspace: everything about them in one place (Home · Progress · Syllabus · Profile).

const first = (name = '') => name.split(' ')[0];
const pct = (a) => (Number(a?.max_points) ? Math.round((Number(a.points) / Number(a.max_points)) * 100) : null);
export const initials = (name = '') => name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
/** A stable soft colour per student, so the same student always has the same avatar colour. */
export function avatarTone(name = '') {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { background: `hsl(${h} 55% 92%)`, color: `hsl(${h} 45% 32%)` };
}
const SUBJECT_TONE = { maths: 'tone-maths', physics: 'tone-physics', chemistry: 'tone-chemistry', biology: 'tone-biology', science: 'tone-biology' };
const subjectTone = (subject = '') => SUBJECT_TONE[subject.toLowerCase().split(' ')[0]] ?? 'tone-other';

function greeting(zone) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** A pop-up sheet for forms opened from the workspace (set homework, schedule a class, open homework). */
function Sheet({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="modal sheet" onClose={onClose} onCancel={onClose} aria-label={title}>
    <button className="icon-btn modal-close" onClick={() => ref.current.close()} aria-label="Close"><X size={20}/></button>
    {children}
  </dialog>;
}

function SectionHead({ title, count, children, open, onToggle }) {
  return <div className="ws-section-head">
    {onToggle
      ? <button type="button" className="ws-section-title as-button" onClick={onToggle} aria-expanded={open}>{title}{count !== undefined && ` (${count})`}<ChevronDown size={18} className={open ? 'rot' : ''}/></button>
      : <h2 className="ws-section-title">{title}{count !== undefined && ` (${count})`}</h2>}
    <div className="ws-section-actions">{children}</div>
  </div>;
}

function testStatus(t, now) {
  const a = firstOf(t.test_attempts);
  if (a?.finished_at) return a.pending_marks ? { label: 'Being marked', cls: 'badge-accent' } : { label: `${pct(a)}%`, cls: pct(a) >= 70 ? 'badge-success' : pct(a) >= 40 ? 'badge-warn' : 'badge-danger', score: pct(a) };
  if (now < new Date(t.opens_at).getTime()) return { label: `Opens ${relativeLabel(t.opens_at, now)}`, cls: 'badge-muted' };
  if (now > new Date(t.closes_at).getTime()) return { label: a ? 'Not finished' : 'Missed', cls: 'badge-warn' };
  return { label: a ? 'In progress' : 'Open now', cls: 'badge-accent' };
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
        : <span className="ws-win empty" title="No test results yet"><Trophy size={18}/></span>}
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

function Ring({ done, total, size = 74 }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg"/>
    <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform={`rotate(-90 ${size / 2} ${size / 2})`}/>
    <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">{Math.round(f * 100)}%</text>
  </svg>;
}

function Goals({ student, onOpenSyllabus }) {
  const { state, error } = useStudentSyllabi(student.id);
  if (error) return <Notice>{error}</Notice>;
  if (!state) return <div className="ws-goal ws-goal-loading"/>;
  if (!state.rows.length) return <button className="ws-goal-empty" onClick={onOpenSyllabus}><Target size={22}/><span><strong>Add {first(student.full_name)}’s exam syllabus</strong><span className="muted small">Track every topic until the exam, and show progress to parents.</span></span></button>;
  return state.rows.map((row, i) => {
    const syl = state.files[i];
    if (!syl) return null;
    const statuses = state.statuses[row.curriculum_id] ?? {};
    const cov = coverage(syl, statuses);
    const days = row.exam_date ? Math.round((new Date(`${row.exam_date}T00:00:00`) - new Date(new Date().toDateString())) / 86400000) : null;
    return <article key={row.id} className="ws-goal">
      <header className="ws-goal-head">
        <span className="ws-goal-icon"><Trophy size={26}/></span>
        <div>
          <span className="ws-label accent">EXAM GOAL · {syl.board.toUpperCase()}</span>
          <h3>{syl.title}</h3>
          <p className="muted small">{cov.percent}% complete{days !== null ? ` · ${days > 0 ? `${days} days left` : days === 0 ? 'exam today' : 'exam passed'}` : ''} · {cov.mastered} mastered, {cov.taught} taught of {cov.total}</p>
        </div>
        <button className="btn btn-ghost btn-small" onClick={onOpenSyllabus}><PenLine size={15}/>Tick topics</button>
      </header>
      <ol className="ws-chapters">
        {syl.topics.map((t, n) => {
          const items = t.subtopics.length ? t.subtopics : [t];
          const done = items.filter((x) => statuses[x.code]).length;
          return <li key={t.code}><button className="ws-chapter" onClick={onOpenSyllabus} title={`${t.title}: ${done} of ${items.length} covered`}>
            <span className="ws-chapter-no">{n + 1}</span>
            <Ring done={done} total={items.length}/>
            <span className="ws-chapter-title">{t.title}</span>
          </button></li>;
        })}
      </ol>
    </article>;
  });
}

function HomeTab({ student, data, now, reload, openTest, goLibrary, setTab }) {
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
            {testsToMark.map((t) => <li key={t.id} className="ws-review-test"><span><ShieldCheck size={17}/><strong>{t.title}</strong><span className="muted small"> · written answers to mark</span></span><button className="btn btn-primary btn-small" onClick={() => openTest(t.paper_id)}><PenLine size={15}/>Mark</button></li>)}
            {toMark.map((h) => <HomeworkItem key={h.id} hw={h} student={student} reload={reload}/>)}
          </ul>
        : <p className="muted small ws-quiet"><CheckCircle2 size={16}/>Nothing to review. All caught up.</p>)}
    </section>

    <section className="ws-section">
      <SectionHead title="TESTS" count={tests.length}><button className="link-btn" onClick={goLibrary}>Test library</button></SectionHead>
      <TestCards tests={recentTests} now={now} onOpen={openTest} onAdd={goLibrary}/>
    </section>

    <section className="ws-section">
      <SectionHead title="UPCOMING CLASSES" count={upcoming.length}><button className="link-btn" onClick={() => setSheet({ kind: 'schedule' })}><CalendarPlus size={15}/>Schedule a class</button></SectionHead>
      {upcoming.length ? <ul className="class-list ws-classes">{upcoming.map((c) => <ClassRow key={c.id} cls={c} student={student} now={now} reload={reload}/>)}</ul>
        : <p className="muted small ws-quiet"><Clock size={16}/>No classes booked. <button className="link-btn" onClick={() => setSheet({ kind: 'schedule' })}>Schedule one</button></p>}
    </section>

    <section className="ws-section">
      <SectionHead title="GOALS"><button className="link-btn" onClick={() => setTab('syllabus')}><Plus size={15}/>Add syllabus</button></SectionHead>
      <Goals student={student} onOpenSyllabus={() => setTab('syllabus')}/>
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

const TABS = [['home', 'Home'], ['progress', 'Progress'], ['syllabus', 'Syllabus'], ['profile', 'Profile']];

export default function StudentWorkspace({ student, data, login, now, reload, openTest, goLibrary, tab, setTab }) {
  return <div className="ws">
    <header className="ws-top">
      <span className="ws-top-name">{first(student.full_name)}’s workspace</span>
      <nav className="ws-tabs" role="tablist" aria-label={`${student.full_name}’s workspace`}>
        {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'ws-tab active' : 'ws-tab'} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <span className="ws-top-spacer"/>
    </header>
    <div className="ws-body" role="tabpanel">
      {tab === 'home' && <HomeTab student={student} data={data} now={now} reload={reload} openTest={openTest} goLibrary={goLibrary} setTab={setTab}/>}
      {tab === 'progress' && <ProgressTab student={student} data={data} now={now}/>}
      {tab === 'syllabus' && <section className="card"><h2 className="card-title"><BookMarked size={20}/>Syllabus</h2><p className="hint">Click a topic once for Taught, twice for Mastered. {first(student.full_name)} and their parents see the same list.</p><SyllabusPanel student={student}/></section>}
      {tab === 'profile' && <ProfileTab student={student} login={login} now={now} reload={reload}/>}
    </div>
  </div>;
}

