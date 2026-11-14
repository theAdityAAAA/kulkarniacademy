import React from 'react';
import { BookOpen, ChevronDown, PenLine, Target, Trophy } from 'lucide-react';
import { coverage, useStudentSyllabi } from './Syllabus';
import { Notice } from './shared';
import { relativeLabel } from './time';
import { firstOf } from './supabase';

// Small pieces shared by the teacher's student workspace and the student's own dashboard.
// (Kept separate so the student app never downloads teacher-only code.)

export const first = (name = '') => name.split(' ')[0];
export const pct = (a) => (Number(a?.max_points) ? Math.round((Number(a.points) / Number(a.max_points)) * 100) : null);
export const initials = (name = '') => name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** A stable soft colour per person, so the same student always has the same avatar colour. */
export function avatarTone(name = '') {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { background: `hsl(${h} 55% 92%)`, color: `hsl(${h} 45% 32%)` };
}

const SUBJECT_TONE = { maths: 'tone-maths', physics: 'tone-physics', chemistry: 'tone-chemistry', biology: 'tone-biology', science: 'tone-biology' };
export const subjectTone = (subject = '') => SUBJECT_TONE[subject.toLowerCase().split(' ')[0]] ?? 'tone-other';

/** "Good morning" etc. in the given time zone (the student's own time). */
export function greeting(zone) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function SectionHead({ title, count, children, open, onToggle }) {
  return <div className="ws-section-head">
    {onToggle
      ? <button type="button" className="ws-section-title as-button" onClick={onToggle} aria-expanded={open}>{title}{count !== undefined && ` (${count})`}<ChevronDown size={18} className={open ? 'rot' : ''}/></button>
      : <h2 className="ws-section-title">{title}{count !== undefined && ` (${count})`}</h2>}
    <div className="ws-section-actions">{children}</div>
  </div>;
}

/** Label + badge colour for a test, from the teacher's or the student's point of view. */
export function testStatus(t, now) {
  const a = firstOf(t.test_attempts);
  if (a?.finished_at) return a.pending_marks ? { label: 'Being marked', cls: 'badge-accent' } : { label: `${pct(a)}%`, cls: pct(a) >= 70 ? 'badge-success' : pct(a) >= 40 ? 'badge-warn' : 'badge-danger', score: pct(a) };
  if (now < new Date(t.opens_at).getTime()) return { label: `Opens ${relativeLabel(t.opens_at, now)}`, cls: 'badge-muted' };
  if (now > new Date(t.closes_at).getTime()) return { label: a ? 'Not finished' : 'Missed', cls: 'badge-warn' };
  return { label: a ? 'In progress' : 'Open now', cls: 'badge-accent' };
}

export function Ring({ done, total, size = 74 }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg"/>
    <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform={`rotate(-90 ${size / 2} ${size / 2})`}/>
    <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">{Math.round(f * 100)}%</text>
  </svg>;
}

/** Exam goal cards with a ring per chapter. `forStudent` = the student's own read-only view. */
export function Goals({ student, onOpen, forStudent = false }) {
  const { state, error } = useStudentSyllabi(student.id);
  if (error) return <Notice>{error}</Notice>;
  if (!state) return <div className="ws-goal ws-goal-loading"/>;
  if (!state.rows.length) {
    return forStudent
      ? <div className="ws-goal-empty is-static"><Target size={22}/><span><strong>Your exam goal will appear here</strong><span className="muted small">Your teacher will add your exam syllabus, so you can see every topic you’ve covered.</span></span></div>
      : <button className="ws-goal-empty" onClick={onOpen}><Target size={22}/><span><strong>Add {first(student.full_name)}’s exam syllabus</strong><span className="muted small">Track every topic until the exam, and show progress to parents.</span></span></button>;
  }
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
          <span className="ws-label accent">{forStudent ? 'MY EXAM GOAL' : 'EXAM GOAL'} · {syl.board.toUpperCase()}</span>
          <h3>{syl.title}</h3>
          <p className="muted small">{cov.percent}% complete{days !== null ? ` · ${days > 0 ? `${days} days left` : days === 0 ? 'exam today' : 'exam passed'}` : ''} · {cov.mastered} mastered, {cov.taught} taught of {cov.total}</p>
        </div>
        <button className="btn btn-ghost btn-small" onClick={onOpen}>{forStudent ? <><BookOpen size={15}/>See all topics</> : <><PenLine size={15}/>Tick topics</>}</button>
      </header>
      <ol className="ws-chapters">
        {syl.topics.map((t, n) => {
          const items = t.subtopics.length ? t.subtopics : [t];
          const done = items.filter((x) => statuses[x.code]).length;
          return <li key={t.code}><button className="ws-chapter" onClick={onOpen} title={`${t.title}: ${done} of ${items.length} covered`}>
            <span className="ws-chapter-no">{n + 1}</span>
            <Ring done={done} total={items.length}/>
            <span className="ws-chapter-title">{t.title}</span>
          </button></li>;
        })}
      </ol>
    </article>;
  });
}
