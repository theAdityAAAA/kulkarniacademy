import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ClipboardCheck, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import TestPapers from './TestPapers';
import { firstOf, must, supabase } from './supabase';
import { JoinButton, Notice, Spinner, classState, useNow } from './shared';
import { dateTimeLabel, placeName, relativeLabel, timeLabel } from './time';
import TeacherClasses from './TeacherClasses';
import TeacherHomework from './TeacherHomework';
import TeacherStudents from './TeacherStudents';

const tabs = [
  { id: 'classes', label: 'Classes', icon: CalendarDays },
  { id: 'homework', label: 'Homework', icon: ClipboardCheck },
  { id: 'tests', label: 'Tests', icon: ShieldCheck },
  { id: 'students', label: 'Students', icon: Users },
];

export default function Teacher({ profile }) {
  const now = useNow();
  const [tab, setTab] = useState(() => (location.hash.slice(1) && tabs.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : 'classes'));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const optional = (query) => query.then(({ data: rows, error: e }) => (e ? null : rows));
      const [students, classes, homework, papers, questions, tests] = await Promise.all([
        supabase.from('profiles').select('*').eq('role', 'student').order('full_name').then(must),
        supabase.from('classes').select('*').gte('starts_at', since).order('starts_at').then(must),
        supabase.from('homework').select('*, submissions(*)').order('created_at', { ascending: false }).limit(500).then(must),
        // Tests need supabase/002_tests.sql + 004_test_papers.sql. Without them the rest of the dashboard still works.
        optional(supabase.from('papers').select('*').order('created_at', { ascending: false })),
        optional(supabase.from('questions').select('*').order('position').limit(5000)),
        optional(supabase.from('tests').select('*, test_attempts(*)').order('opens_at', { ascending: false }).limit(1000)),
      ]);
      setData({ students, classes, papers: papers ?? [], questions: questions ?? [], tests: tests ?? [], testsReady: papers !== null && questions !== null && tests !== null, homework: homework.map((h) => ({ ...h, submission: firstOf(h.submissions) })) });
      setError('');
    } catch (err) {
      setError(`Couldn’t load your data: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Refresh when coming back to the tab, but not while a form is being filled in.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => { if (Date.now() - last > 60000 && !document.activeElement?.closest('form')) { last = Date.now(); load(); } };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);
  const choose = (id) => { setTab(id); history.replaceState(null, '', `#${id}`); };

  if (!data) return error ? <Notice>{error}</Notice> : <Spinner/>;

  const studentsById = Object.fromEntries(data.students.map((s) => [s.id, s]));
  const nextClass = data.classes.find((c) => ['live', 'soon', 'later'].includes(classState(c, now)));
  const weekEnd = now + 7 * 86400000;
  const thisWeek = data.classes.filter((c) => c.status !== 'cancelled' && new Date(c.starts_at).getTime() >= now && new Date(c.starts_at).getTime() < weekEnd).length;
  const toMark = data.homework.filter((h) => h.submission && !h.marked_at).length;
  const testsToMark = data.tests.filter((t) => firstOf(t.test_attempts)?.pending_marks > 0).length;
  const nextStudent = nextClass && studentsById[nextClass.student_id];

  return <div className="stack-lg">
    <section className="welcome">
      <div><span className="eyebrow">TEACHER DASHBOARD</span><h1>Hello, {profile.full_name.split(' ')[0]}.</h1></div>
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
      <article className="stat"><span className="stat-label">Classes in the next 7 days</span><strong className="stat-number">{thisWeek}</strong></article>
      <article className="stat"><button className="stat-button" onClick={() => choose('homework')}><span className="stat-label">Homework to mark</span><strong className="stat-number">{toMark}</strong></button></article>
      <article className="stat"><button className="stat-button" onClick={() => choose('students')}><span className="stat-label">Students</span><strong className="stat-number">{data.students.length}</strong></button></article>
    </section>

    <nav className="tabs" role="tablist" aria-label="Dashboard sections">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => choose(id)}><Icon size={17}/>{label}{id === 'homework' && toMark > 0 && <span className="tab-count">{toMark}</span>}{id === 'tests' && testsToMark > 0 && <span className="tab-count">{testsToMark}</span>}</button>)}
    </nav>

    <div role="tabpanel">
      {tab === 'classes' && <TeacherClasses students={data.students} classes={data.classes} reload={load} now={now}/>}
      {tab === 'homework' && <TeacherHomework students={data.students} homework={data.homework} reload={load}/>}
      {tab === 'tests' && !data.testsReady && <Notice>Tests need a database update. In Supabase, open SQL Editor, paste the file <code>supabase/004_test_papers.sql</code>, click Run, then press Refresh here.</Notice>}
      {tab === 'tests' && data.testsReady && <TestPapers papers={data.papers} questions={data.questions} tests={data.tests} students={data.students} reload={load} now={now}/>}
      {tab === 'students' && <TeacherStudents students={data.students} classes={data.classes} homework={data.homework} tests={data.tests} reload={load} now={now}/>}
    </div>
  </div>;
}
