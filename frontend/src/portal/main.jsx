import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Download, LogIn, LogOut, MessageCircle, X } from 'lucide-react';
import { configured, friendlyError, supabase } from './supabase';
import { Notice, Spinner, useAction } from './shared';
const Teacher = lazy(() => import('./Teacher'));
const Student = lazy(() => import('./Student'));
import './portal.css';
import './tests.css';

const WHATSAPP = 'https://wa.me/919373438129?text=' + encodeURIComponent('Hi! I need help signing in to the Kulkarni Academy student portal.');

function Brand() {
  return <a className="portal-brand" href="/" aria-label="Kulkarni Academy website"><span className="portal-logo"><img src="/kulkarni-academy-logo.png" alt="" width="300" height="538"/></span><span>Kulkarni<small>ACADEMY</small></span></a>;
}

function Login() {
  const { busy, error, run } = useAction();
  const submit = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(async () => {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: String(data.get('email')).trim(), password: String(data.get('password')) });
      if (signInError) throw new Error(signInError.message === 'Invalid login credentials' ? 'That email or password is not right. Please check and try again.' : friendlyError(signInError.message));
    });
  };
  return <main className="login-page">
    <div className="login-card">
      <Brand/>
      <span className="eyebrow">STUDENT PORTAL</span>
      <h1>Welcome back.</h1>
      <p className="muted">Sign in to see your classes and homework.</p>
      <form onSubmit={submit} className="form">
        <label>Email<input name="email" type="email" autoComplete="username" required/></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required/></label>
        <Notice>{error}</Notice>
        <button className="btn btn-primary btn-wide" disabled={busy}><LogIn size={18}/>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="login-help">Forgot your password? <a href={WHATSAPP} target="_blank" rel="noopener noreferrer"><MessageCircle size={15}/> Ask your teacher</a></p>
      <InstallHint/>
    </div>
    <a className="back-link small" href="/privacy/">Privacy policy</a>
    <a className="back-link" href="/"><ArrowLeft size={16}/> Back to the website</a>
  </main>;
}

/** "Add to home screen": a real install button where the browser offers one (Android/desktop Chrome),
 *  and a short how-to on iPhone/iPad, where it is done from the Share menu. Hidden once installed. */
let deferredInstall = null;
if (typeof window !== 'undefined') window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; window.dispatchEvent(new Event('ka-install-ready')); });
function InstallHint() {
  const [canInstall, setCanInstall] = useState(Boolean(deferredInstall));
  const [showIosTip, setShowIosTip] = useState(false);
  useEffect(() => { const on = () => setCanInstall(true); window.addEventListener('ka-install-ready', on); return () => window.removeEventListener('ka-install-ready', on); }, []);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (standalone) return null;
  if (canInstall) return <button className="btn btn-ghost btn-wide install-btn" onClick={async () => { deferredInstall?.prompt(); await deferredInstall?.userChoice; deferredInstall = null; setCanInstall(false); }}><Download size={17}/>Add the portal to your home screen</button>;
  if (ios) return <div className="install-tip">
    <button className="link-btn" onClick={() => setShowIosTip(!showIosTip)}><Download size={15}/>Add to your home screen</button>
    {showIosTip && <p className="small muted">In Safari, tap the <strong>Share</strong> button (square with an arrow), then <strong>Add to Home Screen</strong>.</p>}
  </div>;
  return null;
}

function ChangePassword({ onClose }) {
  const dialog = useRef(null);
  const { busy, error, setError, run } = useAction();
  const [done, setDone] = useState(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  const submit = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password'));
    if (password !== data.get('confirm')) { setError('The two passwords don’t match.'); return; }
    run(async () => {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
    });
  };
  return <dialog ref={dialog} className="modal" onClose={onClose} onCancel={onClose}>
    <button className="icon-btn modal-close" onClick={onClose} aria-label="Close"><X size={20}/></button>
    <h2>Change password</h2>
    {done ? <><Notice kind="success">Your password has been changed.</Notice><button className="btn btn-primary btn-wide" onClick={onClose}>Done</button></> :
      <form className="form" onSubmit={submit}>
        <label>New password<input name="password" type="password" minLength={8} maxLength={72} autoComplete="new-password" required/></label>
        <label>Type it again<input name="confirm" type="password" minLength={8} maxLength={72} autoComplete="new-password" required/></label>
        <p className="hint">At least 8 characters.</p>
        <Notice>{error}</Notice>
        <button className="btn btn-primary btn-wide" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>}
  </dialog>;
}

/** Teacher and student both get a full-screen app layout (rail + pages); the password dialog lives here. */
function AppFrame({ children }) {
  const [changing, setChanging] = useState(false);
  return <>
    <SafetyNet><Suspense fallback={<Spinner/>}>{children(() => setChanging(true))}</Suspense></SafetyNet>
    {changing && <ChangePassword onClose={() => setChanging(false)}/>}
  </>;
}

function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(undefined);
  const userId = session?.user?.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) { setProfile(undefined); return; }
    let live = true;
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle().then(({ data }) => live && setProfile(data ?? null));
    return () => { live = false; };
  }, [userId]);

  if (session === undefined || (session && profile === undefined)) return <Spinner/>;
  if (!session) return <Login/>;
  if (!profile) {
    return <main className="login-page"><div className="login-card"><Brand/><h1>Almost there.</h1><p className="muted">Your login works, but your student account hasn’t been set up yet. Please message your teacher.</p><button className="btn btn-ghost btn-wide" onClick={() => supabase.auth.signOut()}><LogOut size={16}/>Sign out</button></div></main>;
  }
  if (profile.role === 'teacher') return <AppFrame>{(changePassword) => <Teacher profile={profile} onChangePassword={changePassword}/>}</AppFrame>;
  return <AppFrame>{(changePassword) => <Student profile={profile} onChangePassword={changePassword} onProfileChange={(changes) => setProfile((p) => ({ ...p, ...changes }))}/>}</AppFrame>;
}

/** If anything unexpected goes wrong while drawing a screen, show a friendly card instead of a blank page. */
class SafetyNet extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('Portal screen error:', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="login-card safety-net" role="alert">
      <h1>Something went wrong on this screen</h1>
      <p className="muted">Your saved work is safe. Reloading the page usually fixes it. If it keeps happening, please tell your teacher.</p>
      <button className="btn btn-primary btn-wide" onClick={() => window.location.reload()}>Reload the page</button>
    </div>;
  }
}

function NotConfigured() {
  return <main className="login-page"><div className="login-card"><Brand/><h1>Portal not connected</h1><p className="muted">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to <code>frontend/.env</code>, then restart <code>npm run dev</code>.</p></div></main>;
}

createRoot(document.getElementById('root')).render(configured ? <App/> : <NotConfigured/>);
