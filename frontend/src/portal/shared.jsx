import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, Video } from 'lucide-react';
import { fileLabel, signedUrl } from './supabase';

export const JOIN_EARLY_MINUTES = 10;
export const TEST_SUBJECTS = ['Maths', 'Physics', 'Chemistry', 'Biology', 'Science', 'Logical reasoning'];

export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
}

export function platformName(url) {
  if (!url) return 'Live class in the portal';
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('zoom.us')) return 'Zoom';
    if (host === 'meet.google.com') return 'Google Meet';
  } catch { /* fall through */ }
  return 'Online class';
}

/** cancelled | live | soon (join opens within the hour) | later | ended */
export function classState(cls, now) {
  if (cls.status === 'cancelled') return 'cancelled';
  const start = new Date(cls.starts_at).getTime();
  const end = start + cls.duration_minutes * 60000;
  if (now > end) return 'ended';
  if (now >= start - JOIN_EARLY_MINUTES * 60000) return 'live';
  if (now >= start - 60 * 60000) return 'soon';
  return 'later';
}

/** Opens the live class room (LiveClass, shown on top of the portal) for a class. */
export function openLiveClass(classId) {
  history.pushState({ live: true }, '', `#live/${classId}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

const TEACHER_EARLY_MINUTES = 30;  // the class room opens this early for the teacher (see 010_live_classes.sql)
const ROOM_STAYS_OPEN_MINUTES = 60; // and stays open this long after the class should have ended

export function JoinButton({ cls, now, teacher = false }) {
  const state = classState(cls, now);
  const start = new Date(cls.starts_at).getTime();
  const end = start + cls.duration_minutes * 60000;
  const backup = cls.meeting_url && <a className="join-backup" href={cls.meeting_url} target="_blank" rel="noopener noreferrer">{platformName(cls.meeting_url)} backup</a>;
  if (state === 'cancelled') return <span className="badge badge-muted">Cancelled</span>;
  if (state === 'ended') {
    // The room stays open a while after the class, so anyone who dropped out can get back in.
    if (now <= end + ROOM_STAYS_OPEN_MINUTES * 60000) return <span className="join-group"><button className="btn btn-ghost" onClick={() => openLiveClass(cls.id)}><Video size={17}/>Rejoin class</button>{backup}</span>;
    return <span className="badge badge-muted">Finished</span>;
  }
  const open = teacher ? now >= start - TEACHER_EARLY_MINUTES * 60000 : state === 'live';
  if (open) return <span className="join-group"><button className="btn btn-primary" onClick={() => openLiveClass(cls.id)}><Video size={17}/>Join class</button>{backup}</span>;
  if (teacher) return <span className="join-group"><span className="join-locked" title={`The class room opens ${TEACHER_EARLY_MINUTES} minutes before class`}><Video size={16}/>Room opens {TEACHER_EARLY_MINUTES} min before</span>{backup}</span>;
  return <span className="join-locked" title={`The button turns on ${JOIN_EARLY_MINUTES} minutes before class`}><Video size={16}/>Join opens {JOIN_EARLY_MINUTES} min before</span>;
}

export function FileLink({ path }) {
  const [href, setHref] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; signedUrl(path).then((url) => live && setHref(url)).catch(() => live && setFailed(true)); return () => { live = false; }; }, [path]);
  const name = fileLabel(path);
  if (failed) return <span className="file-link file-link-error"><FileText size={16}/>{name} (unavailable)</span>;
  if (!href) return <span className="file-link"><Loader2 className="spin" size={16}/>{name}</span>;
  return <a className="file-link" href={href} target="_blank" rel="noopener noreferrer"><FileText size={16}/>{name}</a>;
}

export function Notice({ kind = 'error', children }) {
  if (!children) return null;
  const Icon = kind === 'error' ? AlertCircle : CheckCircle2;
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}><Icon size={18}/><div>{children}</div></div>;
}

export function Empty({ icon: Icon, title, children }) {
  return <div className="empty">{Icon && <Icon size={26}/>}<strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="loading" role="status"><Loader2 className="spin" size={22}/>{label}</div>;
}

/** Runs an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true); setError('');
    try { return await fn(); } catch (err) { setError(err.message || String(err)); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}
