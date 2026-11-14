import React, { useState } from 'react';
import { Copy, HardDrive, MessageCircle, Trash2, UserPlus, Wand2 } from 'lucide-react';
import { BoardGradeFields } from './boards';
import { api } from './supabase';
import { Notice, useAction } from './shared';
import { commonZones, otherZones } from './time';

const portalUrl = `${location.origin}/portal/`;

export function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function ZoneSelect({ value, onChange }) {
  return <select value={value} onChange={onChange} required>
    <optgroup label="Common">{commonZones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</optgroup>
    <optgroup label="All time zones">{otherZones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</optgroup>
  </select>;
}

function loginMessage(name, email, password) {
  return `Hi ${name.split(' ')[0]}! Your Kulkarni Academy student portal is ready.\n\nSign in here: ${portalUrl}\nEmail: ${email}\nPassword: ${password}\n\nYou'll find your class links and homework there. You can change your password after signing in (key icon at the top).`;
}

export function CredentialsCard({ name, email, password }) {
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

export function AddStudent({ reload, onCreated }) {
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
    <BoardGradeFields board={form.board} grade={form.grade} onChange={(v) => setForm((f) => ({ ...f, ...v }))}/>
    <label>Student’s time zone<ZoneSelect value={form.timezone} onChange={set('timezone')}/></label>
    <Notice>{error}</Notice>
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create login'}</button>
    {created && <CredentialsCard {...created}/>}
  </form>;
}

const megabytes = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Deleting homework, tests or students removes their records, but files live in separate storage.
 *  This finds files nothing uses any more and deletes them, after showing you first. */
export function StorageCleanup() {
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
