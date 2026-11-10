import React, { useCallback, useEffect, useState } from 'react';
import { Copy, FileText, HardDrive, KeyRound, LineChart, MessageCircle, Pencil, Trash2, UserPlus, Users, Wand2 } from 'lucide-react';
import ParentReport from './ParentReport';
import ProgressChart, { progressPoints } from './ProgressChart';
import { api, must, supabase } from './supabase';
import { Empty, Notice, useAction } from './shared';
import { commonZones, dateTimeLabel, isValidZone, otherZones, placeName, timeLabel } from './time';

const portalUrl = `${location.origin}/portal/`;

function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function ZoneSelect({ value, onChange }) {
  return <select value={value} onChange={onChange} required>
    <optgroup label="Common">{commonZones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</optgroup>
    <optgroup label="All time zones">{otherZones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</optgroup>
  </select>;
}

function loginMessage(name, email, password) {
  return `Hi ${name.split(' ')[0]}! Your Kulkarni Academy student portal is ready.\n\nSign in here: ${portalUrl}\nEmail: ${email}\nPassword: ${password}\n\nYou'll find your class links and homework there. You can change your password after signing in (key icon at the top).`;
}

function CredentialsCard({ name, email, password }) {
  const [copied, setCopied] = useState(false);
  const message = loginMessage(name, email, password);
  const copy = async () => { try { await navigator.clipboard.writeText(message); setCopied(true); } catch { setCopied(false); } };
  return <div className="credentials">
    <strong>Send these login details to {name.split(' ')[0]} (or their parent):</strong>
    <pre>{message}</pre>
    <div className="row">
      <button type="button" className="btn btn-ghost btn-small" onClick={copy}><Copy size={16}/>{copied ? 'Copied' : 'Copy message'}</button>
      <a className="btn btn-ghost btn-small" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16}/>Send on WhatsApp</a>
    </div>
    <p className="hint">This password is shown only now. If it’s lost, use “Reset password”.</p>
  </div>;
}

function AddStudent({ reload, onCreated }) {
  const blank = { fullName: '', email: '', password: generatePassword(), timezone: 'Europe/London', grade: '', board: '' };
  const [form, setForm] = useState(blank);
  const [created, setCreated] = useState(null);
  const { busy, error, run } = useAction();
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));
  const submit = (event) => {
    event.preventDefault();
    run(async () => {
      await api('/admin/students', { method: 'POST', body: form });
      setCreated({ name: form.fullName.trim(), email: form.email.trim().toLowerCase(), password: form.password });
      setForm({ ...blank, password: generatePassword() });
      await Promise.all([reload(), onCreated()]);
    });
  };
  return <form className="card form" onSubmit={submit}>
    <h2 className="card-title"><UserPlus size={20}/>Add a student</h2>
    <label>Student’s name<input value={form.fullName} onChange={set('fullName')} required maxLength={80} placeholder="e.g. Riya Sharma"/></label>
    <label>Login email <span className="optional">(student’s or parent’s)</span><input type="email" value={form.email} onChange={set('email')} required maxLength={254} autoComplete="off"/></label>
    <label>Password
      <span className="input-with-btn"><input value={form.password} onChange={set('password')} required minLength={8} maxLength={72} autoComplete="off"/><button type="button" className="icon-btn" onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))} title="Make a new password" aria-label="Make a new password"><Wand2 size={18}/></button></span>
    </label>
    <div className="grid-2">
      <label>Year / grade <span className="optional">(optional)</span><input value={form.grade} onChange={set('grade')} maxLength={60} placeholder="e.g. Year 9"/></label>
      <label>Board <span className="optional">(optional)</span><input value={form.board} onChange={set('board')} maxLength={100} placeholder="e.g. IGCSE"/></label>
    </div>
    <label>Student’s time zone<ZoneSelect value={form.timezone} onChange={set('timezone')}/></label>
    <Notice>{error}</Notice>
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create login'}</button>
    {created && <CredentialsCard {...created}/>}
  </form>;
}

function StudentCard({ student, login, upcoming, now, reload, homework, tests }) {
  const points = progressPoints(homework, tests);
  const [report, setReport] = useState(false);
  const [mode, setMode] = useState(null); // 'edit' | 'password' | 'progress'
  const [form, setForm] = useState({ full_name: student.full_name, grade: student.grade ?? '', board: student.board ?? '', timezone: student.timezone });
  const [newPassword, setNewPassword] = useState('');
  const [resetDone, setResetDone] = useState(null);
  const { busy, error, run } = useAction();
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const save = (event) => {
    event.preventDefault();
    if (!isValidZone(form.timezone)) return;
    run(async () => {
      must(await supabase.from('profiles').update({ full_name: form.full_name.trim(), grade: form.grade.trim() || null, board: form.board.trim() || null, timezone: form.timezone }).eq('id', student.id));
      setMode(null);
      await reload();
    });
  };
  const reset = (event) => {
    event.preventDefault();
    run(async () => {
      await api(`/admin/students/${student.id}/password`, { method: 'POST', body: { password: newPassword } });
      setResetDone({ name: student.full_name, email: login?.email ?? '(their login email)', password: newPassword });
      setNewPassword('');
    });
  };

  return <li className="student-card">
    <div className="student-head">
      <span className="avatar" aria-hidden="true">{student.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
      <div className="student-main">
        <strong>{student.full_name}</strong>
        <span className="muted small">{[student.grade, student.board].filter(Boolean).join(' · ') || 'No grade or board yet'}</span>
        <span className="muted small">{login?.email ?? '…'}</span>
      </div>
    </div>
    <dl className="facts">
      <div><dt>Their time now</dt><dd>{timeLabel(now, student.timezone)} in {placeName(student.timezone)}</dd></div>
      <div><dt>Upcoming classes</dt><dd>{upcoming}</dd></div>
      <div><dt>Last signed in</dt><dd>{login?.last_sign_in_at ? dateTimeLabel(login.last_sign_in_at) : 'Never'}</dd></div>
    </dl>
    <div className="row">
      <button className="btn btn-ghost btn-small" onClick={() => setMode(mode === 'progress' ? null : 'progress')} aria-pressed={mode === 'progress'}><LineChart size={15}/>Progress</button>
      <button className="btn btn-ghost btn-small" onClick={() => setReport(true)}><FileText size={15}/>Parent report</button>
      <button className="btn btn-ghost btn-small" onClick={() => { setMode(mode === 'edit' ? null : 'edit'); setResetDone(null); }}><Pencil size={15}/>Edit details</button>
      <button className="btn btn-ghost btn-small" onClick={() => { setMode(mode === 'password' ? null : 'password'); setNewPassword(generatePassword()); setResetDone(null); }}><KeyRound size={15}/>Reset password</button>
    </div>
    {report && <ParentReport student={student} homework={homework} tests={tests} onClose={() => setReport(false)}/>}
    {mode === 'progress' && <div className="inset"><ProgressChart points={points} title={`${student.full_name.split(' ')[0]}’s scores`}/></div>}
    {mode === 'edit' && <form className="form inset" onSubmit={save}>
      <label>Name<input value={form.full_name} onChange={set('full_name')} required maxLength={80}/></label>
      <div className="grid-2">
        <label>Year / grade<input value={form.grade} onChange={set('grade')} maxLength={60}/></label>
        <label>Board<input value={form.board} onChange={set('board')} maxLength={100}/></label>
      </div>
      <label>Time zone<ZoneSelect value={form.timezone} onChange={set('timezone')}/></label>
      <button className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>}
    {mode === 'password' && !resetDone && <form className="form inset" onSubmit={reset}>
      <label>New password<span className="input-with-btn"><input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} maxLength={72} autoComplete="off"/><button type="button" className="icon-btn" onClick={() => setNewPassword(generatePassword())} title="Make a new password" aria-label="Make a new password"><Wand2 size={18}/></button></span></label>
      <button className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
    </form>}
    {resetDone && <CredentialsCard {...resetDone}/>}
    <Notice>{error}</Notice>
  </li>;
}

const megabytes = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Deleting homework, tests or students removes their records, but files live in separate storage.
 *  This finds files nothing uses any more and deletes them, after showing you first. */
function StorageCleanup() {
  const [report, setReport] = useState(null);
  const [done, setDone] = useState(null);
  const { busy, error, run } = useAction();
  const check = () => run(async () => { setDone(null); setReport(await api('/admin/cleanup-storage', { method: 'POST', body: { dryRun: true } })); });
  const clean = () => run(async () => { const r = await api('/admin/cleanup-storage', { method: 'POST', body: { dryRun: false } }); setDone(r); setReport(null); });
  return <section className="card storage-card">
    <h2 className="card-title"><HardDrive size={20}/>Storage</h2>
    <p className="hint">When you delete homework, a test or a student, their files (worksheets, photos, diagrams) are cleaned up automatically once a day when you open this dashboard. Files from the last 24 hours are never touched. You can also check now.</p>
    {report && <div className="storage-report">
      <p>You have <strong>{report.totalFiles} files</strong> ({megabytes(report.totalBytes)}) of the 1 GB in Supabase’s free plan.</p>
      {report.unusedFiles
        ? <><p><strong>{report.unusedFiles} file{report.unusedFiles > 1 ? 's are' : ' is'} no longer used</strong> by anything ({megabytes(report.unusedBytes)}).</p>
            <button className="btn btn-primary btn-small" onClick={clean} disabled={busy}><Trash2 size={15}/>{busy ? 'Deleting…' : `Delete ${report.unusedFiles} unused file${report.unusedFiles > 1 ? 's' : ''}`}</button></>
        : <p>Nothing to clean up. Every file is still in use. 👍</p>}
    </div>}
    {done && <Notice kind="success">{`Deleted ${done.removed} unused file${done.removed === 1 ? '' : 's'} and freed ${megabytes(done.unusedBytes)}.`}</Notice>}
    <Notice>{error}</Notice>
    {!report && <button className="btn btn-ghost btn-small" onClick={check} disabled={busy}><HardDrive size={15}/>{busy ? 'Checking…' : 'Check for unused files'}</button>}
  </section>;
}

export default function TeacherStudents({ students, classes, homework = [], tests = [], reload, now }) {
  const [logins, setLogins] = useState({});
  const [loginError, setLoginError] = useState('');
  const loadLogins = useCallback(async () => {
    try {
      const { logins: list } = await api('/admin/logins');
      setLogins(Object.fromEntries(list.map((l) => [l.id, l])));
      setLoginError('');
    } catch (err) { setLoginError(err.message); }
  }, []);
  useEffect(() => { loadLogins(); }, [loadLogins]);

  return <div className="split">
    <div className="stack">
      <AddStudent reload={reload} onCreated={loadLogins}/>
      <StorageCleanup/>
    </div>
    <section className="card">
      <h2 className="card-title"><Users size={20}/>Your students</h2>
      {loginError && <Notice>{`${loginError} Adding students and resetting passwords need the backend.`}</Notice>}
      {students.length ? <ul className="student-list">{students.map((s) => <StudentCard key={s.id} student={s} login={logins[s.id]} now={now} reload={reload}
        homework={homework.filter((h) => h.student_id === s.id)} tests={tests.filter((t) => t.student_id === s.id)}
        upcoming={classes.filter((c) => c.student_id === s.id && c.status !== 'cancelled' && new Date(c.starts_at).getTime() > now).length}/>)}</ul>
        : <Empty icon={Users} title="No students yet">Create the first login with the form.</Empty>}
    </section>
  </div>;
}
