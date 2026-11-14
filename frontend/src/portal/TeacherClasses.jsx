import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarDays, CalendarPlus, ChevronDown, MessageCircle, Repeat, Trash2, Undo2, XCircle } from 'lucide-react';
import { must, supabase } from './supabase';
import { Empty, JoinButton, Notice, classState, platformName, useAction } from './shared';
import { addDays, dateTimeLabel, dayKey, dayLabel, localZone, placeName, timeLabel, zonedToDate } from './time';

const SUBJECTS = ['Maths', 'Science', 'Physics', 'Chemistry', 'Biology'];
const LENGTHS = [30, 45, 60, 90];

// "YYYY-MM-DD" for today in a time zone, and friendly labels for the next days.
const ymdIn = (date, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const hhmmIn = (date, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
const todayIn = (zone) => ymdIn(new Date(), zone);
const dayChip = (dateStr, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
  : new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(new Date(`${dateStr}T12:00:00Z`)));
const nextDays = (zone, n = 7) => { const t = todayIn(zone); return Array.from({ length: n }, (_, i) => addDays(`${t}T00:00`, i).slice(0, 10)); };
const first = (name) => name.split(' ')[0];

/** Message for the student/parent with the time in THEIR zone. */
function whatsappText(student, start, minutes, link, moved) {
  const when = `${dateTimeLabel(start, student.timezone)} (${placeName(student.timezone)} time)`;
  return moved
    ? `Hi ${first(student.full_name)}! Our class has moved to ${when}, ${minutes} minutes. Same link: ${link}\nYou can also join from the student portal.`
    : `Hi ${first(student.full_name)}! Your next class is on ${when}, ${minutes} minutes.\nJoin here: ${link}\nYou can also join from the student portal.`;
}

/** Day chips + time input + "whose time" switch, with a live preview of both times. */
function WhenPicker({ student, value, onChange }) {
  const zone = value.zone === 'student' && student ? student.timezone : localZone;
  const days = nextDays(zone);
  const start = value.date && value.time ? zonedToDate(`${value.date}T${value.time}`, zone) : null;
  return <div className="when">
    <div className="day-chips" role="group" aria-label="Day">
      {days.map((d, i) => <button type="button" key={d} className={value.date === d ? 'chip active' : 'chip'} aria-pressed={value.date === d} onClick={() => onChange({ ...value, date: d })}>{dayChip(d, i)}</button>)}
      <label className="chip chip-date"><span>Other date</span><input type="date" value={days.includes(value.date) ? '' : value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} aria-label="Pick another date"/></label>
    </div>
    <div className="when-row">
      <label>Time<input type="time" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} required/></label>
      <span className="when-zone">in {value.zone === 'student' && student ? <><strong>{first(student.full_name)}’s time</strong> ({placeName(student.timezone)})</> : <><strong>your time</strong> ({placeName(localZone)})</>}
        {student && student.timezone !== localZone && <button type="button" className="link-btn" onClick={() => onChange({ ...value, zone: value.zone === 'student' ? 'mine' : 'student' })}>switch</button>}</span>
    </div>
    {start && student && <p className="preview-time">
      <strong>{dateTimeLabel(start)}</strong> for you{student.timezone !== localZone && <> · <strong>{dateTimeLabel(start, student.timezone)}</strong> for {first(student.full_name)} in {placeName(student.timezone)}</>}
    </p>}
  </div>;
}

/** With `fixedStudent`, schedules for that one student (used inside their workspace). */
export function ScheduleForm({ students, classes, reload, fixedStudent = null }) {
  const [studentId, setStudentId] = useState('');
  const [when, setWhen] = useState({ date: todayIn(localZone), time: '', zone: 'mine' });
  const [minutes, setMinutes] = useState(60);
  const [subject, setSubject] = useState('Maths');
  const [topic, setTopic] = useState('');
  const [link, setLink] = useState('');
  const [saveLink, setSaveLink] = useState(true);
  const [more, setMore] = useState(false);
  const [weeks, setWeeks] = useState(1);
  const [done, setDone] = useState(null);
  const { busy, error, setError, run } = useAction();
  const student = students.find((s) => s.id === studentId);

  const chooseStudent = (id) => {
    setStudentId(id); setDone(null);
    const s = students.find((x) => x.id === id);
    const last = [...classes].reverse().find((c) => c.student_id === id);
    setLink(s?.meeting_url || last?.meeting_url || '');
    if (last) { setMinutes(last.duration_minutes); setSubject(last.subject); }
  };
  useEffect(() => { if (fixedStudent) chooseStudent(fixedStudent.id); }, [fixedStudent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (event) => {
    event.preventDefault();
    if (!student) { setError('Choose a student.'); return; }
    if (!when.date || !when.time) { setError('Choose a day and type a time.'); return; }
    let url;
    try { url = new URL(link.trim()); } catch { setError('Paste the full Zoom or Google Meet link, starting with https://'); return; }
    if (url.protocol !== 'https:') { setError('The class link must start with https://'); return; }
    const zone = when.zone === 'student' ? student.timezone : localZone;
    const rows = Array.from({ length: Number(weeks) }, (_, i) => ({
      student_id: student.id, subject: subject.trim(), topic: topic.trim() || null, duration_minutes: Number(minutes), meeting_url: url.href,
      starts_at: zonedToDate(addDays(`${when.date}T${when.time}`, 7 * i), zone).toISOString(),
    }));
    if (new Date(rows[0].starts_at).getTime() < Date.now() - 5 * 60000 && !confirm('That time is in the past. Schedule it anyway?')) return;
    run(async () => {
      must(await supabase.from('classes').insert(rows));
      if (saveLink && url.href !== student.meeting_url) must(await supabase.from('profiles').update({ meeting_url: url.href }).eq('id', student.id));
      setDone({ student, start: new Date(rows[0].starts_at), minutes: Number(minutes), link: url.href, count: rows.length });
      setTopic(''); setWhen((w) => ({ ...w, time: '' })); setWeeks(1);
      await reload();
    });
  };

  if (!students.length) return <Empty icon={CalendarPlus} title="Add a student first">Go to the Students tab to create a login, then schedule their classes here.</Empty>;

  return <form className="card form" onSubmit={submit}>
    <h2 className="card-title"><CalendarPlus size={20}/>{fixedStudent ? `Schedule a class for ${first(fixedStudent.full_name)}` : 'Schedule a class'}</h2>
    {!fixedStudent && <div className="student-chips" role="group" aria-label="Student">
      {students.map((s) => <button type="button" key={s.id} className={studentId === s.id ? 'chip active' : 'chip'} aria-pressed={studentId === s.id} onClick={() => chooseStudent(s.id)}>{s.full_name}</button>)}
    </div>}
    {student && <>
      <WhenPicker student={student} value={when} onChange={setWhen}/>
      <div className="length-chips" role="group" aria-label="Length">
        <span className="chips-label">Length</span>
        {LENGTHS.map((m) => <button type="button" key={m} className={Number(minutes) === m ? 'chip active' : 'chip'} aria-pressed={Number(minutes) === m} onClick={() => setMinutes(m)}>{m} min</button>)}
      </div>
      <div className="grid-2">
        <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} list="subject-list" required maxLength={60}/></label>
        <label>Topic <span className="optional">(optional)</span><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Quadratic equations" maxLength={200}/></label>
      </div>
      <datalist id="subject-list">{SUBJECTS.map((s) => <option key={s} value={s}/>)}</datalist>
      <label>Zoom / Meet link<input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" required maxLength={500}/></label>
      {link && link !== student.meeting_url && <label className="inline-check small"><input type="checkbox" checked={saveLink} onChange={(e) => setSaveLink(e.target.checked)}/>Remember this as {first(student.full_name)}’s usual link</label>}
      <button type="button" className="link-btn" onClick={() => setMore(!more)} aria-expanded={more}><ChevronDown size={15} className={more ? 'chev open' : 'chev'}/>More options</button>
      {more && <label className="inset"><span className="label-icon"><Repeat size={15}/>Repeat at the same time every week</span>
        <select value={weeks} onChange={(e) => setWeeks(e.target.value)}><option value={1}>No, just this one class</option>{[2, 4, 6, 8, 12].map((w) => <option key={w} value={w}>Yes, for {w} weeks</option>)}</select></label>}
      <Notice>{error}</Notice>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : weeks > 1 ? `Schedule ${weeks} classes` : 'Schedule class'}</button>
    </>}
    {done && <div className="done-box">
      <strong>{done.count > 1 ? `${done.count} weekly classes scheduled` : 'Class scheduled'} for {done.student.full_name}.</strong>
      <span className="muted small">They’ll see it in their portal with a Join button.</span>
      <a className="btn btn-ghost btn-small" href={`https://wa.me/?text=${encodeURIComponent(whatsappText(done.student, done.start, done.minutes, done.link, false))}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16}/>Send details on WhatsApp</a>
    </div>}
  </form>;
}

function RescheduleForm({ cls, student, onDone, reload }) {
  const start = new Date(cls.starts_at);
  const [when, setWhen] = useState({ date: ymdIn(start, localZone), time: hhmmIn(start, localZone), zone: 'mine' });
  const [minutes, setMinutes] = useState(cls.duration_minutes);
  const [link, setLink] = useState(cls.meeting_url);
  const [topic, setTopic] = useState(cls.topic ?? '');
  const [saved, setSaved] = useState(null);
  const { busy, error, setError, run } = useAction();
  const save = (event) => {
    event.preventDefault();
    let url;
    try { url = new URL(link.trim()); } catch { setError('The class link must be a full https:// link.'); return; }
    const zone = when.zone === 'student' && student ? student.timezone : localZone;
    const newStart = zonedToDate(`${when.date}T${when.time}`, zone);
    const moved = newStart.getTime() !== start.getTime();
    if (moved && newStart.getTime() < Date.now() - 5 * 60000 && !confirm('That time is in the past. Move the class there anyway?')) return;
    run(async () => {
      must(await supabase.from('classes').update({
        starts_at: newStart.toISOString(), duration_minutes: Number(minutes), meeting_url: url.href, topic: topic.trim() || null, status: 'scheduled',
        ...(moved && !cls.rescheduled_from ? { rescheduled_from: cls.starts_at } : {}),
      }).eq('id', cls.id));
      setSaved({ start: newStart, moved, link: url.href });
      await reload();
    });
  };
  if (saved) return <div className="done-box">
    <strong>{saved.moved ? `Moved to ${dateTimeLabel(saved.start)} (your time).` : 'Class updated.'}</strong>
    {student && saved.moved && <a className="btn btn-ghost btn-small" href={`https://wa.me/?text=${encodeURIComponent(whatsappText(student, saved.start, Number(minutes), saved.link, true))}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16}/>Tell {first(student.full_name)} on WhatsApp</a>}
    <button className="link-btn" onClick={onDone}>Done</button>
  </div>;
  return <form className="form inset reschedule" onSubmit={save}>
    <strong>Reschedule or edit</strong>
    <WhenPicker student={student} value={when} onChange={setWhen}/>
    <div className="length-chips" role="group" aria-label="Length">
      <span className="chips-label">Length</span>
      {LENGTHS.map((m) => <button type="button" key={m} className={Number(minutes) === m ? 'chip active' : 'chip'} onClick={() => setMinutes(m)}>{m} min</button>)}
    </div>
    <div className="grid-2">
      <label>Topic <span className="optional">(optional)</span><input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200}/></label>
      <label>Link<input type="url" value={link} onChange={(e) => setLink(e.target.value)} required maxLength={500}/></label>
    </div>
    <Notice>{error}</Notice>
    <div className="row"><button className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button><button type="button" className="link-btn" onClick={onDone}>Cancel</button></div>
  </form>;
}

export function ClassRow({ cls, student, now, reload }) {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const state = classState(cls, now);
  const setStatus = (status) => run(async () => { must(await supabase.from('classes').update({ status }).eq('id', cls.id)); await reload(); });
  const remove = () => { if (confirm(`Delete this ${cls.subject} class with ${student?.full_name ?? 'this student'}?`)) run(async () => { must(await supabase.from('classes').delete().eq('id', cls.id)); await reload(); }); };
  return <li className={`class-row state-${state}`}>
    <div className="class-time"><strong>{timeLabel(cls.starts_at)}</strong><span>{cls.duration_minutes} min</span></div>
    <div className="class-info">
      <strong>{student?.full_name ?? 'Removed student'} · {cls.subject}</strong>
      {cls.topic && <span>{cls.topic}</span>}
      {student && <span className="muted small">{timeLabel(cls.starts_at, student.timezone)} for them in {placeName(student.timezone)} · {platformName(cls.meeting_url)}</span>}
      {cls.rescheduled_from && <span className="badge badge-accent moved">Moved from {dateTimeLabel(cls.rescheduled_from)}</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
    <div className="class-actions">
      <JoinButton cls={cls} now={now} teacher/>
      {state !== 'ended' && cls.status !== 'cancelled' && <button className="btn btn-ghost btn-small" onClick={() => setEditing(!editing)} aria-expanded={editing}><CalendarClock size={15}/>Reschedule</button>}
      {state !== 'ended' && (cls.status === 'cancelled'
        ? <button className="icon-btn" onClick={() => setStatus('scheduled')} disabled={busy} title="Restore class" aria-label="Restore class"><Undo2 size={18}/></button>
        : <button className="icon-btn" onClick={() => setStatus('cancelled')} disabled={busy} title="Cancel class (student sees “Cancelled”)" aria-label="Cancel class"><XCircle size={18}/></button>)}
      <button className="icon-btn danger" onClick={remove} disabled={busy} title="Delete class" aria-label="Delete class"><Trash2 size={18}/></button>
    </div>
    {editing && <div className="class-edit"><RescheduleForm cls={cls} student={student} reload={reload} onDone={() => setEditing(false)}/></div>}
  </li>;
}

export default function TeacherClasses({ students, classes, reload, now }) {
  const byId = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students]);
  const [showPast, setShowPast] = useState(false);
  const upcoming = classes.filter((c) => classState(c, now) !== 'ended');
  const past = classes.filter((c) => classState(c, now) === 'ended').reverse();
  const shown = showPast ? past : upcoming;
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86400000));
  const groups = [];
  for (const cls of shown) {
    const key = dayKey(cls.starts_at);
    if (groups.at(-1)?.key !== key) groups.push({ key, label: key === today ? `Today · ${dayLabel(cls.starts_at)}` : key === tomorrow ? `Tomorrow · ${dayLabel(cls.starts_at)}` : dayLabel(cls.starts_at), items: [] });
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
        : <Empty icon={CalendarDays} title={showPast ? 'No past classes' : 'No upcoming classes'}>{showPast ? null : 'Schedule one on the left.'}</Empty>}
    </section>
  </div>;
}
