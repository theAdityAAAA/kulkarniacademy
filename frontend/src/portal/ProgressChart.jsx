import React, { useMemo, useState } from 'react';
import { LineChart, Table2 } from 'lucide-react';
import { dayLabel } from './time';
import { firstOf } from './supabase';

/** Turns marked homework + finished tests into chart points: { id, date, pct, subject, label, kind, detail }. */
export function progressPoints(homework = [], tests = []) {
  const points = [];
  for (const h of homework) {
    if (!h.marked_at || h.score == null || !h.out_of) continue;
    points.push({ id: `h-${h.id}`, date: h.marked_at, pct: Math.min(100, (Number(h.score) / Number(h.out_of)) * 100), subject: h.subject, label: h.title, kind: 'Homework', detail: `${h.score}/${h.out_of}` });
  }
  for (const t of tests) {
    const a = firstOf(t.test_attempts);
    if (!a?.finished_at || !Number(a.max_points) || a.pending_marks > 0) continue; // wait until written answers are marked
    points.push({ id: `t-${t.id}`, date: a.finished_at, pct: (Number(a.points) / Number(a.max_points)) * 100, subject: t.subject, label: t.title, kind: 'Test', detail: `${a.correct_count}/${a.asked_count} correct` });
  }
  return points.sort((x, y) => new Date(x.date) - new Date(y.date));
}

const W = 640, H = 240, PAD = { top: 16, right: 18, bottom: 34, left: 44 };

export default function ProgressChart({ points, title = 'Progress' }) {
  const subjects = useMemo(() => [...new Set(points.map((p) => p.subject))].sort(), [points]);
  const [subject, setSubject] = useState('');
  const [active, setActive] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const shown = subject ? points.filter((p) => p.subject === subject) : points;

  if (!points.length) {
    return <div className="chart-empty"><LineChart size={24}/><strong>No scores yet</strong><p>Marked homework (with a score) and finished tests will appear here as a line.</p></div>;
  }

  const innerW = W - PAD.left - PAD.right, innerH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (shown.length === 1 ? innerW / 2 : (i / (shown.length - 1)) * innerW);
  const y = (pct) => PAD.top + innerH - (pct / 100) * innerH;
  const path = shown.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ');
  const avg = Math.round(shown.reduce((s, p) => s + p.pct, 0) / shown.length);
  const last = Math.round(shown.at(-1).pct);
  const firstFew = shown.slice(0, Math.min(3, shown.length)), lastFew = shown.slice(-Math.min(3, shown.length));
  const trend = shown.length >= 4 ? Math.round(lastFew.reduce((s, p) => s + p.pct, 0) / lastFew.length - firstFew.reduce((s, p) => s + p.pct, 0) / firstFew.length) : null;
  const selected = active && shown.find((p) => p.id === active);

  return <div className="chart">
    <div className="chart-head">
      <h3 className="chart-title">{title}{subject ? `: ${subject}` : ''}</h3>
      <button className="link-btn" onClick={() => setAsTable(!asTable)}><Table2 size={15}/>{asTable ? 'Show chart' : 'Show as table'}</button>
    </div>
    {subjects.length > 1 && <div className="chart-filters" role="group" aria-label="Subject">
      {['', ...subjects].map((s) => <button key={s || 'all'} aria-pressed={subject === s} className={subject === s ? 'chip active' : 'chip'} onClick={() => { setSubject(s); setActive(null); }}>{s || 'All subjects'}</button>)}
    </div>}
    <div className="chart-stats">
      <span><small>Average</small><strong>{avg}%</strong></span>
      <span><small>Latest</small><strong>{last}%</strong></span>
      {trend !== null && <span><small>Change</small><strong>{trend > 0 ? '▲ +' : trend < 0 ? '▼ ' : ''}{trend}%</strong></span>}
      <span><small>Results</small><strong>{shown.length}</strong></span>
    </div>
    {asTable ? <table className="chart-table">
      <thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Subject</th><th>Score</th></tr></thead>
      <tbody>{shown.map((p) => <tr key={p.id}><td>{dayLabel(p.date)}</td><td>{p.kind}</td><td>{p.label}</td><td>{p.subject}</td><td>{Math.round(p.pct)}% <span className="muted">({p.detail})</span></td></tr>)}</tbody>
    </table> : <>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${shown.length} results, average ${avg}%, latest ${last}%`} onMouseLeave={() => setActive(null)}>
        {[0, 25, 50, 75, 100].map((g) => <g key={g}>
          <line className={g === 0 ? 'chart-baseline' : 'chart-grid'} x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)}/>
          <text className="chart-axis" x={PAD.left - 8} y={y(g) + 4} textAnchor="end">{g}%</text>
        </g>)}
        <text className="chart-axis" x={x(0)} y={H - 10} textAnchor={shown.length === 1 ? 'middle' : 'start'}>{dayLabel(shown[0].date)}</text>
        {shown.length > 1 && <text className="chart-axis" x={x(shown.length - 1)} y={H - 10} textAnchor="end">{dayLabel(shown.at(-1).date)}</text>}
        {selected && <line className="chart-crosshair" x1={x(shown.indexOf(selected))} x2={x(shown.indexOf(selected))} y1={PAD.top} y2={PAD.top + innerH}/>}
        {shown.length > 1 && <path className="chart-line" d={path}/>}
        {shown.map((p, i) => <g key={p.id}>
          <circle className={p.kind === 'Test' ? 'chart-dot test' : 'chart-dot homework'} cx={x(i)} cy={y(p.pct)} r={p.id === active ? 6.5 : 5}/>
          <circle className="chart-hit" cx={x(i)} cy={y(p.pct)} r={14} tabIndex={0} aria-label={`${p.kind}: ${p.label}, ${Math.round(p.pct)}%`}
            onMouseEnter={() => setActive(p.id)} onFocus={() => setActive(p.id)} onClick={() => setActive(p.id)}/>
        </g>)}
      </svg>
      <div className="chart-legend"><span><i className="dot test"/>Test</span><span><i className="dot homework"/>Homework</span></div>
      <p className="chart-detail" aria-live="polite">{selected
        ? <><strong>{Math.round(selected.pct)}%</strong> · {selected.kind}: {selected.label} ({selected.detail}) · {selected.subject} · {dayLabel(selected.date)}</>
        : <span className="muted">Hover or tap a dot to see the details.</span>}</p>
    </>}
  </div>;
}
