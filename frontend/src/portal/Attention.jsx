import React, { useState } from 'react';
import { AlertTriangle, BellRing, CalendarPlus, CheckCircle2, ClipboardCheck, MessageCircle, PenLine, Video } from 'lucide-react';
import { firstOf } from './supabase';
import { JoinButton, classState } from './shared';
import { dateTimeLabel, dayKey, placeName, timeLabel } from './time';

// "Needs your attention": everything the teacher should act on today, worked out from data
// the dashboard already has (no extra loading). Each line has one button that does the next step.

const first = (name = '') => name.split(' ')[0];
const DAY = 86400000;

function reminderText(student, test) {
  return `Hi ${first(student.full_name)}! Reminder: your test “${test.title}” closes on ${dateTimeLabel(test.closes_at, student.timezone)} (${placeName(student.timezone)} time). You can start it from the student portal. Good luck! 🍀`;
}

export default function Attention({ data, now, goTo, openTest }) {
  const [showAll, setShowAll] = useState(false);
  const byId = Object.fromEntries(data.students.map((s) => [s.id, s]));
  const today = dayKey(new Date(now));
  const items = [];

  // 1. Classes today that haven't finished.
  for (const c of data.classes) {
    const state = classState(c, now);
    if (c.status !== 'cancelled' && state !== 'ended' && dayKey(c.starts_at) === today) {
      const s = byId[c.student_id];
      items.push({ key: `c-${c.id}`, rank: 0, icon: Video, text: <><strong>{timeLabel(c.starts_at)}</strong> class with {s?.full_name ?? 'a student'} · {c.subject}</>, action: <JoinButton cls={c} now={now} teacher/> });
    }
  }
  // 2. Marking: written test answers and handed-in homework.
  const testsToMark = data.tests.filter((t) => firstOf(t.test_attempts)?.pending_marks > 0);
  for (const t of testsToMark) {
    items.push({ key: `m-${t.id}`, rank: 1, icon: PenLine, text: <>Mark {firstOf(t.test_attempts).pending_marks} written answer{firstOf(t.test_attempts).pending_marks > 1 ? 's' : ''} from <strong>{byId[t.student_id]?.full_name ?? 'a student'}</strong> in “{t.title}”</>,
      action: <button className="btn btn-ghost btn-small" onClick={() => openTest(t.paper_id)}>Mark</button> });
  }
  const hwToMark = data.homework.filter((h) => h.submission && !h.marked_at);
  if (hwToMark.length) {
    const names = [...new Set(hwToMark.map((h) => first(byId[h.student_id]?.full_name)))].join(', ');
    items.push({ key: 'hw-mark', rank: 1, icon: ClipboardCheck, text: <>Mark {hwToMark.length} homework{hwToMark.length > 1 ? 's' : ''} handed in by {names}</>, action: <button className="btn btn-ghost btn-small" onClick={() => goTo('homework')}>Mark</button> });
  }
  // 3. Tests: closing within a day and not started → remind; missed in the last 2 weeks → reopen.
  const latestPerStudentTest = new Map();
  for (const t of data.tests) { const k = t.retake_of ?? t.id; const cur = latestPerStudentTest.get(k); if (!cur || t.attempt_no > cur.attempt_no) latestPerStudentTest.set(k, t); }
  for (const t of latestPerStudentTest.values()) {
    const a = firstOf(t.test_attempts);
    const s = byId[t.student_id];
    const closes = new Date(t.closes_at).getTime(), opens = new Date(t.opens_at).getTime();
    if (!a && s && opens <= now && closes > now && closes - now < DAY) {
      items.push({ key: `r-${t.id}`, rank: 2, icon: BellRing, text: <><strong>{s.full_name}</strong> hasn’t started “{t.title}”, which closes {dateTimeLabel(t.closes_at)}</>,
        action: <a className="btn btn-ghost btn-small" href={`https://wa.me/?text=${encodeURIComponent(reminderText(s, t))}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={15}/>Remind</a> });
    }
    if (!a && s && closes <= now && now - closes < 14 * DAY) {
      items.push({ key: `x-${t.id}`, rank: 3, icon: AlertTriangle, text: <><strong>{s.full_name}</strong> missed “{t.title}” (closed {dateTimeLabel(t.closes_at)})</>,
        action: <button className="btn btn-ghost btn-small" onClick={() => openTest(t.paper_id)}>Reopen</button> });
    }
  }
  // 4. Homework past its due date and not handed in (last 2 weeks).
  const overdue = data.homework.filter((h) => !h.submission && !h.marked_at && h.due_at && new Date(h.due_at).getTime() < now && now - new Date(h.due_at).getTime() < 14 * DAY);
  for (const h of overdue) {
    const s = byId[h.student_id];
    items.push({ key: `o-${h.id}`, rank: 4, icon: AlertTriangle, text: <><strong>{s?.full_name ?? 'A student'}</strong> hasn’t handed in “{h.title}” (due {dateTimeLabel(h.due_at)})</>,
      action: s ? <a className="btn btn-ghost btn-small" href={`https://wa.me/?text=${encodeURIComponent(`Hi ${first(s.full_name)}! Just a reminder to hand in your homework “${h.title}” on the student portal. 🙂`)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={15}/>Remind</a> : null });
  }
  // 5. Students with no class booked in the next 7 days.
  for (const s of data.students) {
    const booked = data.classes.some((c) => c.student_id === s.id && c.status !== 'cancelled' && new Date(c.starts_at).getTime() > now && new Date(c.starts_at).getTime() < now + 7 * DAY);
    if (!booked) items.push({ key: `n-${s.id}`, rank: 5, icon: CalendarPlus, text: <>No class booked for <strong>{s.full_name}</strong> in the next 7 days</>, action: <button className="btn btn-ghost btn-small" onClick={() => goTo('classes')}>Schedule</button> });
  }

  items.sort((x, y) => x.rank - y.rank);
  const shown = showAll ? items : items.slice(0, 6);
  return <section className="card attention">
    <h2 className="card-title"><BellRing size={20}/>Needs your attention</h2>
    {items.length === 0
      ? <p className="attention-clear"><CheckCircle2 size={18}/> All clear. Nothing needs you right now.</p>
      : <ul className="attention-list">{shown.map(({ key, icon: Icon, text, action }) => <li key={key}><Icon size={17} className="attention-icon"/><span>{text}</span>{action}</li>)}</ul>}
    {items.length > 6 && <button className="link-btn" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${items.length}`}</button>}
  </section>;
}
