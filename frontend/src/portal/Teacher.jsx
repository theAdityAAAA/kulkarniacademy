import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Filter, HardDrive, KeyRound, LayoutDashboard, LibraryBig, LogOut, RefreshCw, Search, Settings, UserPlus, Users } from 'lucide-react';
import TestPapers from './TestPapers';
import Attention from './Attention';
import StudentWorkspace from './StudentWorkspace';
import { avatarTone, initials } from './workspaceParts';
import { api, firstOf, must, supabase } from './supabase';
import { Empty, JoinButton, Notice, Spinner, classState, useNow } from './shared';
import { dateTimeLabel, placeName, relativeLabel, timeLabel } from './time';
import TeacherClasses from './TeacherClasses';
import { AddStudent, StorageCleanup } from './TeacherStudents';
import './app-layout.css';

// Layout: a dark rail on the left (sections), a student list, and one workspace per student.
const RAIL = [
  { id: 'today', label: 'Today', icon: LayoutDashboard },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'library', label: 'Library', icon: LibraryBig },
];
const VIEWS = [...RAIL.map((r) => r.id), 'account'];
const WS_TABS = ['home', 'homework', 'tests', 'progress', 'syllabus', 'profile'];

/** "#students/<id>/<tab>", "#calendar", … so a refresh or the back button keeps your place. */
function readHash() {
  const [view, studentId, tab] = location.hash.slice(1).split('/');
  // Old links (#classes, #tests) from before the new layout still work.
  const old = { classes: 'calendar', tests: 'library', homework: 'students' }[view];
  return { view: VIEWS.includes(view) ? view : old ?? 'students', studentId: studentId || null, tab: WS_TABS.includes(tab) ? tab : 'home' };
}

/** "Year 10 / Grade 9" → "Y10", "Grade 8" → "G8", "Secondary 3" → "Sec 3", "DP1 (Grade 11)" → "DP1". */
function shortGrade(grade = '') {
  const g = grade.split(/\s*[/(]/)[0].trim();
  return g.replace(/^Year\s*/i, 'Y').replace(/^Grade\s*/i, 'G').replace(/^Secondary\s*/i, 'Sec ').replace(/^Stage\s*/i, 'Stage ');
}

function StudentList({ students, selected, onSelect, onAdd, adding, badges }) {
  const [query, setQuery] = useState('');
  const [board, setBoard] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const boards = [...new Set(students.map((s) => s.board).filter(Boolean))].sort();
  const q = query.trim().toLowerCase();
  const shown = students.filter((s) => (!q || s.full_name.toLowerCase().includes(q)) && (!board || s.board === board));
  return <aside className="t-list" aria-label="Students">
    <div className="t-search"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search student" aria-label="Search student"/></div>
    <ul className="t-list-items">
      {shown.map((s) => <li key={s.id}>
        <button className={`t-student ${selected === s.id ? 'active' : ''}`} onClick={() => onSelect(s.id)} aria-current={selected === s.id ? 'true' : undefined}>
          <span className="t-avatar" style={avatarTone(s.full_name)} aria-hidden="true">{initials(s.full_name)}</span>
          <span className="t-student-text"><span className="t-student-name">{s.full_name}{s.grade && <span className="t-grade"> • {shortGrade(s.grade)}</span>}</span>
            {s.board && <span className="t-board">{s.board}</span>}</span>
          {badges[s.id] > 0 && <span className="t-dot" title={`${badges[s.id]} to review`}>{badges[s.id]}</span>}
        </button>
      </li>)}
      {!shown.length && <li className="muted small t-none">{students.length ? 'No student matches.' : 'No students yet.'}</li>}
    </ul>
    <div className="t-list-foot">
      {showFilter && <select value={board} onChange={(e) => setBoard(e.target.value)} aria-label="Filter by board"><option value="">All boards</option>{boards.map((b) => <option key={b}>{b}</option>)}</select>}
      <div className="t-list-buttons">
        <button className={`btn btn-ghost btn-small ${board ? 'is-on' : ''}`} onClick={() => setShowFilter(!showFilter)} aria-expanded={showFilter}><Filter size={15}/>{board ? 'Filtered' : 'Filter'}</button>
        <button className={`btn btn-primary btn-small ${adding ? 'is-on' : ''}`} onClick={onAdd}><UserPlus size={15}/>Add student</button>
      </div>
    </div>
  </aside>;
}

function Today({ profile, data, now, load, refreshing, go, openTest, openHomework, error }) {
  const studentsById = Object.fromEntries(data.students.map((s) => [s.id, s]));
  const nextClass = data.classes.find((c) => ['live', 'soon', 'later'].includes(classState(c, now)));
  const thisWeek = data.classes.filter((c) => c.status !== 'cancelled' && new Date(c.starts_at).getTime() >= now && new Date(c.starts_at).getTime() < now + 7 * 86400000).length;
  const toMark = data.homework.filter((h) => h.submission && !h.marked_at).length;
  const nextStudent = nextClass && studentsById[nextClass.student_id];
  return <div className="t-page stack-lg">
    <section className="welcome">
      <div><span className="eyebrow">TODAY</span><h1>Hello, {profile.full_name.split(' ')[0]}.</h1></div>
      <button className="btn btn-ghost btn-small" onClick={load} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''}/>Refresh</button>
    </section>
    <Notice>{error}</Notice>
    <section className="stats">
      <article className="stat stat-feature">
        <span className="stat-label">Next class</span>
        {nextClass ? <>
          <strong>{nextStudent?.full_name ?? 'Student'} · {nextClass.subject}</strong>
          <p>{dateTimeLabel(nextClass.starts_at)} your time ({relativeLabel(nextClass.starts_at, now)}){nextStudent && <><br/>{timeLabel(nextClass.starts_at, nextStudent.timezone)} for them in {placeName(nextStudent.timezone)}</>}</p>
          <JoinButton cls={nextClass} now={now} teacher/>
        </> : <p>No classes scheduled.</p>}
      </article>
      <article className="stat"><button className="stat-button" onClick={() => go('calendar')}><span className="stat-label">Classes in the next 7 days</span><strong className="stat-number">{thisWeek}</strong></button></article>
      <article className="stat"><button className="stat-button" onClick={openHomework}><span className="stat-label">Homework to mark</span><strong className="stat-number">{toMark}</strong></button></article>
      <article className="stat"><button className="stat-button" onClick={() => go('students')}><span className="stat-label">Students</span><strong className="stat-number">{data.students.length}</strong></button></article>
    </section>
    {data.testsReady && <Attention data={data} now={now} goTo={(id) => (id === 'homework' ? openHomework() : go({ classes: 'calendar', tests: 'library' }[id] ?? id))} openTest={openTest}/>}
  </div>;
}

export default function Teacher({ profile, onChangePassword = () => {} }) {
  const now = useNow();
  const [route, setRoute] = useState(readHash);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [logins, setLogins] = useState({});
  const [loginError, setLoginError] = useState('');
  const [adding, setAdding] = useState(false);
  const [focusPaper, setFocusPaper] = useState(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const optional = (query) => query.then(({ data: rows, error: e }) => (e ? null : rows));
      const [students, classes, homework, papers, questions, tests, attendance] = await Promise.all([
        supabase.from('profiles').select('*').eq('role', 'student').order('full_name').then(must),
        supabase.from('classes').select('*').gte('starts_at', since).order('starts_at').then(must),
        supabase.from('homework').select('*, submissions(*)').order('created_at', { ascending: false }).limit(500).then(must),
        // Tests need supabase/002_tests.sql + 004_test_papers.sql. Without them the rest of the dashboard still works.
        optional(supabase.from('papers').select('*').order('created_at', { ascending: false })),
        optional(supabase.from('questions').select('*').order('position').limit(5000)),
        optional(supabase.from('tests').select('*, test_attempts(*)').order('opens_at', { ascending: false }).limit(1000)),
        // Live-class attendance needs supabase/010_live_classes.sql; without it, classes simply show no attendance.
        optional(supabase.from('class_attendance').select('class_id, user_id, seconds, first_joined_at, last_seen_at').gte('first_joined_at', since)),
      ]);
      const byClass = new Map();
      for (const a of attendance ?? []) { if (!byClass.has(a.class_id)) byClass.set(a.class_id, []); byClass.get(a.class_id).push(a); }
      const withAttendance = classes.map((c) => ({ ...c, attendance: attendance ? byClass.get(c.id) ?? [] : null }));
      setData({ students, classes: withAttendance, papers: papers ?? [], questions: questions ?? [], tests: tests ?? [], testsReady: papers !== null && questions !== null && tests !== null, homework: homework.map((h) => ({ ...h, submission: firstOf(h.submissions) })) });
      setError('');
    } catch (err) {
      setError(`Couldn’t load your data: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);
  const loadLogins = useCallback(async () => {
    try { const { logins: list } = await api('/admin/logins'); setLogins(Object.fromEntries(list.map((l) => [l.id, l]))); setLoginError(''); }
    catch (err) { setLoginError(err.message); }
  }, []);

  useEffect(() => { load(); loadLogins(); }, [load, loadLogins]);
  // Once a day, quietly delete files nothing uses any more (from deleted homework, tests or students).
  // Same safety rules as the Storage button: only unused files, never anything from the last 24 hours.
  useEffect(() => {
    const KEY = 'ka-last-storage-clean';
    let last = 0;
    try { last = Number(localStorage.getItem(KEY)) || 0; } catch { /* private mode: just run */ }
    if (Date.now() - last < 24 * 3600000) return;
    const id = setTimeout(() => {
      api('/admin/cleanup-storage', { method: 'POST', body: { dryRun: false } })
        .then(() => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } })
        .catch(() => { /* not important: try again next time */ });
    }, 5000); // after the dashboard has loaded, so it never slows it down
    return () => clearTimeout(id);
  }, []);
  // Refresh when coming back to the tab, but not while a form is being filled in.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => { if (Date.now() - last > 60000 && !document.activeElement?.closest('form, dialog')) { last = Date.now(); load(); } };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);
  useEffect(() => { const on = () => { if (location.hash.startsWith('#live/')) return; setAdding(false); setRoute(readHash()); }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);

  const navigate = (next) => {
    const r = { ...route, ...next };
    setRoute(r);
    const hash = r.view === 'students' && r.studentId ? `#students/${r.studentId}/${r.tab}` : `#${r.view}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    document.querySelectorAll('.t-main, .t-workspace').forEach((el) => el.scrollTo({ top: 0 }));
  };
  const go = (view) => { setAdding(false); navigate({ view }); };
  // A test is opened inside its student's workspace (Tests tab); without a student, in the library.
  const openTest = (paperId, studentId = null) => {
    setFocusPaper({ id: paperId, studentId, at: Date.now() });
    if (studentId) { setAdding(false); navigate({ view: 'students', studentId, tab: 'tests' }); } else go('library');
  };
  // "Homework to mark": open the first student who has handed something in, on their Homework tab.
  const openHomework = () => {
    const h = data?.homework.find((x) => x.submission && !x.marked_at);
    if (h) { setAdding(false); navigate({ view: 'students', studentId: h.student_id, tab: 'homework' }); } else go('students');
  };

  const badges = useMemo(() => {
    const out = {};
    if (!data) return out;
    for (const h of data.homework) if (h.submission && !h.marked_at) out[h.student_id] = (out[h.student_id] ?? 0) + 1;
    for (const t of data.tests) if (firstOf(t.test_attempts)?.pending_marks > 0) out[t.student_id] = (out[t.student_id] ?? 0) + 1;
    return out;
  }, [data]);

  if (!data) return error ? <div className="t-page"><Notice>{error}</Notice></div> : <Spinner/>;

  const toMark = data.homework.filter((h) => h.submission && !h.marked_at).length;
  const testsToMark = data.tests.filter((t) => firstOf(t.test_attempts)?.pending_marks > 0).length;
  const railCount = { students: toMark + testsToMark };
  // In the Students view, open the chosen student, or the first one.
  const student = data.students.find((s) => s.id === route.studentId) ?? (route.studentId ? null : data.students[0]);
  const showAdd = adding || !data.students.length;

  return <div className="t-app">
    <nav className="t-rail" aria-label="Sections">
      <a className="t-rail-logo" href="/" title="Kulkarni Academy website"><img src="/kulkarni-academy-logo.png" alt="Kulkarni Academy" width="300" height="538"/></a>
      {RAIL.map(({ id, label, icon: Icon }) => <button key={id} className={`t-rail-btn ${route.view === id ? 'active' : ''}`} onClick={() => go(id)} aria-current={route.view === id ? 'page' : undefined} title={label}>
        <Icon size={22}/><span>{label}</span>{railCount[id] > 0 && <span className="t-rail-count">{railCount[id]}</span>}
      </button>)}
      <span className="t-rail-spacer"/>
      <button className={`t-rail-btn t-rail-small ${route.view === 'account' ? 'active' : ''}`} onClick={() => go('account')} title="Account and storage"><Settings size={21}/><span>Account</span></button>
      <span className="t-rail-me" style={avatarTone(profile.full_name)} title={profile.full_name}>{initials(profile.full_name)}</span>
    </nav>

    <main className="t-main">
      {route.view === 'students' && <div className="t-students">
        <StudentList students={data.students} selected={showAdd ? null : student?.id} badges={badges} adding={showAdd}
          onSelect={(id) => { setAdding(false); navigate({ view: 'students', studentId: id, tab: id === student?.id ? route.tab : 'home' }); }}
          onAdd={() => setAdding(true)}/>
        <section className="t-workspace">
          {loginError && <Notice>{`${loginError} Adding students and resetting passwords need the backend.`}</Notice>}
          {showAdd ? <div className="t-add"><AddStudent reload={load} onCreated={loadLogins}/></div>
            : student ? <StudentWorkspace key={student.id} student={student} data={data} login={logins[student.id]} now={now} reload={load}
                focus={focusPaper?.studentId === student.id ? focusPaper : null} tab={route.tab} setTab={(tab) => navigate({ studentId: student.id, tab })}/>
            : <Empty icon={Users} title="Student not found">They may have been removed. Pick someone from the list.</Empty>}
        </section>
      </div>}

      {route.view === 'today' && <Today profile={profile} data={data} now={now} load={load} refreshing={refreshing} go={go} openTest={openTest} openHomework={openHomework} error={error}/>}
      {route.view === 'calendar' && <div className="t-page"><h1 className="t-page-title">Calendar</h1><TeacherClasses students={data.students} classes={data.classes} reload={load} now={now}/></div>}
      {route.view === 'library' && <div className="t-page"><h1 className="t-page-title">Test library</h1>
        {data.testsReady ? <TestPapers papers={data.papers} questions={data.questions} tests={data.tests} students={data.students} reload={load} now={now} focus={focusPaper}/>
          : <Notice>Tests need a database update. In Supabase, open SQL Editor, paste the file <code>supabase/004_test_papers.sql</code>, click Run, then press Refresh.</Notice>}</div>}
      {route.view === 'account' && <div className="t-page stack">
        <h1 className="t-page-title">Account</h1>
        <section className="card t-account">
          <span className="t-avatar big" style={avatarTone(profile.full_name)} aria-hidden="true">{initials(profile.full_name)}</span>
          <div><strong>{profile.full_name}</strong><span className="muted small">Teacher</span></div>
          <div className="row">
            <button className="btn btn-ghost btn-small" onClick={onChangePassword}><KeyRound size={16}/>Change password</button>
            <button className="btn btn-ghost btn-small" onClick={() => supabase.auth.signOut()}><LogOut size={16}/>Sign out</button>
          </div>
        </section>
        <StorageCleanup/>
        <p className="hint"><HardDrive size={14}/> Unused files are also cleaned up automatically once a day.</p>
      </div>}
    </main>
  </div>;
}
