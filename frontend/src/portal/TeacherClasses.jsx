import React, { useMemo, useState } from 'react';
import { CalendarPlus, Repeat, Trash2, Undo2, XCircle, CalendarDays } from 'lucide-react';
import { must, supabase } from './supabase';
import { Empty, JoinButton, Notice, classState, platformName, useAction } from './shared';
import { addDays, dateTimeLabel, dayKey, dayLabel, localZone, placeName, timeLabel, zonedToDate } from './time';

const SUBJECTS = ['Maths', 'Science', 'Physics', 'Chemistry', 'Biology'];
const DURATIONS = [30, 45, 60, 75, 90, 120];

function ScheduleForm({ students, classes, reload }) {
  const [form, setForm] = useState({ studentId: '', subject: 'Maths', topic: '', when: '', zone: 'student', duration: 60, link: '', weeks: 1 });
  const { busy, error, setError, run } = useAction();
  const [saved, setSaved] = useState('');
  const student = students.find((s) => s.id === form.studentId);
  const zone = form.zone === 'student' && student ? student.timezone : localZone;
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const chooseStudent = (event) => {
    const id = event.target.value;
    const lastLink = [...classes].reverse().find((c) => c.student_id === id)?.meeting_url ?? '';
    setForm((f) => ({ ...f, studentId: id, link: lastLink || f.link }));
  };

  let preview = null;
  if (form.when && student) {
    const start = zonedToDate(form.when, zone);
    preview = <p className="hint preview-time">Your time: <strong>{dateTimeLabel(start)}</strong> · {student.full_name.split(' ')[0]}’s time: <strong>{dateTimeLabel(start, student.timezone)}</strong> ({placeName(student.timezone)})</p>;
  }

  const submit = (event) => {
    event.preventDefault();
    setSaved('');
    let link;
    try { link = new URL(form.link.trim()); } catch { setError('Paste the full Zoom or Google Meet link, starting with https://'); return; }
    if (link.protocol !== 'https:') { setError('The class link must start with https://'); return; }
    const weeks = Number(form.weeks);
    const rows = Array.from({ length: weeks }, (_, i) => ({
      student_id: form.studentId,
      subject: form.subject.trim(),
      topic: form.topic.trim() || null,
      starts_at: zonedToDate(addDays(form.when, 7 * i), zone).toISOString(),
      duration_minutes: Number(form.duration),
      meeting_url: link.href,
    }));
    run(async () => {
      must(await supabase.from('classes').insert(rows));
      setSaved(weeks > 1 ? `${weeks} weekly classes scheduled for ${student.full_name}.` : `Class scheduled for ${student.full_name}.`);
      setForm((f) => ({ ...f, topic: '', when: '' }));
      await reload();
    });
  };

  if (!students.length) return <Empty icon={CalendarPlus} title="Add a student first">Go to the Students tab to create a login, then schedule their classes here.</Empty>;

  return <form className="card form" onSubmit={submit}>
    <h2 className="card-title"><CalendarPlus size={20}/>Schedule a class</h2>
    <div className="grid-2">
      <label>Student<select value={form.studentId} onChange={chooseStudent} required><option value="">Choose a student…</option>{students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
      <label>Subject<input value={form.subject} onChange={set('subject')} list="subject-list" required maxLength={60}/></label>
    </div>
    <datalist id="subject-list">{SUBJECTS.map((s) => <option key={s} value={s}/>)}</datalist>
    <label>Topic <span className="optional">(optional)</span><input value={form.topic} onChange={set('topic')} placeholder="e.g. Quadratic equations" maxLength={200}/></label>
    <div className="grid-2">
      <label>Date &amp; time<input type="datetime-local" value={form.when} onChange={set('when')} required/></label>
      <fieldset className="segmented"><legend>That time is in…</legend>
        <label><input type="radio" name="zone" value="student" checked={form.zone === 'student'} onChange={set('zone')}/>{student ? `${placeName(student.timezone)} (student)` : 'Student’s time'}</label>
        <label><input type="radio" name="zone" value="mine" checked={form.zone === 'mine'} onChange={set('zone')}/>{placeName(localZone)} (you)</label>
      </fieldset>
    </div>
    {preview}
    <div className="grid-3">
      <label>Length<select value={form.duration} onChange={set('duration')}>{DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}</select></label>
      <label><span className="label-icon"><Repeat size={15}/>Repeat weekly</span><select value={form.weeks} onChange={set('weeks')}><option value={1}>No, just once</option>{[4, 8, 12, 16].map((w) => <option key={w} value={w}>For {w} weeks</option>)}</select></label>
      <label>Zoom / Meet link<input type="url" value={form.link} onChange={set('link')} placeholder="https://…" required maxLength={500}/></label>
    </div>
    <Notice>{error}</Notice>
    <Notice kind="success">{saved}</Notice>
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Schedule class'}</button>
  </form>;
}

function ClassRow({ cls, student, now, reload }) {
  const { busy, error, run } = useAction();
  const state = classState(cls, now);
  const setStatus = (status) => run(async () => { must(await supabase.from('classes').update({ status }).eq('id', cls.id)); await reload(); });
  const remove = () => { if (confirm(`Delete this ${cls.subject} class with ${student?.full_name ?? 'this student'}?`)) run(async () => { must(await supabase.from('classes').delete().eq('id', cls.id)); await reload(); }); };
  return <li className={`class-row state-${state}`}>
    <div className="class-time"><strong>{timeLabel(cls.starts_at)}</strong><span>{cls.duration_minutes} min</span></div>
    <div className="class-info">
      <strong>{student?.full_name ?? 'Removed student'} · {cls.subject}</strong>
      {cls.topic && <span>{cls.topic}</span>}
      {student && <span className="muted small">{timeLabel(cls.starts_at, student.timezone)} in {placeName(student.timezone)} · {platformName(cls.meeting_url)}</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
    <div className="class-actions">
      <JoinButton cls={cls} now={now} teacher/>
      {state !== 'ended' && (cls.status === 'cancelled'
        ? <button className="icon-btn" onClick={() => setStatus('scheduled')} disabled={busy} title="Restore class" aria-label="Restore class"><Undo2 size={18}/></button>
        : <button className="icon-btn" onClick={() => setStatus('cancelled')} disabled={busy} title="Cancel class (student sees “Cancelled”)" aria-label="Cancel class"><XCircle size={18}/></button>)}
      <button className="icon-btn danger" onClick={remove} disabled={busy} title="Delete class" aria-label="Delete class"><Trash2 size={18}/></button>
    </div>
  </li>;
}

export default function TeacherClasses({ students, classes, reload, now }) {
  const byId = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students]);
  const [showPast, setShowPast] = useState(false);
  const upcoming = classes.filter((c) => classState(c, now) !== 'ended');
  const past = classes.filter((c) => classState(c, now) === 'ended').reverse();
  const shown = showPast ? past : upcoming;
  const groups = [];
  for (const cls of shown) {
    const key = dayKey(cls.starts_at);
    if (groups.at(-1)?.key !== key) groups.push({ key, label: dayLabel(cls.starts_at), items: [] });
    groups.at(-1).items.push(cls);
  }
  return <div className="split">
    <ScheduleForm students={students} classes={classes} reload={reload}/>
    <section className="card">
      <div className="card-head">
        <h2 className="card-title"><CalendarDays size={20}/>{showPast ? 'Past 2 weeks' : 'Upcoming classes'}</h2>
        <button className="link-btn" onClick={() => setShowPast(!showPast)}>{showPast ? 'Show upcoming' : 'Show past'}</button>
      </div>
      <p className="hint">Times shown in your time ({placeName(localZone)}).</p>
      {groups.length ? groups.map((g) => <div key={g.key} className="day-group"><h3>{g.label}</h3><ul className="class-list">{g.items.map((c) => <ClassRow key={c.id} cls={c} student={byId[c.student_id]} now={now} reload={reload}/>)}</ul></div>)
        : <Empty icon={CalendarDays} title={showPast ? 'No past classes' : 'No upcoming classes'}>{showPast ? null : 'Scheduled classes will appear here.'}</Empty>}
    </section>
  </div>;
}
