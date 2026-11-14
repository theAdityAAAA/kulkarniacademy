import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Clock, ExternalLink, Loader2, MessageCircle, MessageSquare, Mic, MicOff, MonitorOff, MonitorUp, PenLine, PhoneOff, Presentation, RefreshCw, Send, SwitchCamera, Video, VideoOff, Volume2, WifiOff, X } from 'lucide-react';
import { LiveSession, STUN_ONLY } from './live';
import Whiteboard from './Whiteboard';
import { api, friendlyError, supabase } from './supabase';
import { platformName } from './shared';
import { timeLabel } from './time';
import { avatarTone, first, initials } from './workspaceParts';
import './live.css';

// The class room: "Get ready" (camera + microphone check) → the call → "You left".
// Opened from any Join button as #live/<class id>, on top of the rest of the portal.

const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canShareScreen = () => Boolean(navigator.mediaDevices?.getDisplayMedia) && !isMobile();
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const videoConstraints = (deviceId, facingMode = 'user') => (deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } });

function mediaProblem(error) {
  const name = error?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'blocked', text: 'Your browser is blocking the camera and microphone. Click the camera icon in the address bar (or your phone’s site settings), choose Allow, then press “Try again”.' };
  if (name === 'NotReadableError' || name === 'AbortError') return { kind: 'busy', text: 'Your camera or microphone is being used by another app (for example Zoom or Teams). Close it, then press “Try again”.' };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { kind: 'missing', text: 'No camera or microphone was found on this device.' };
  return { kind: 'other', text: `The camera couldn’t start (${error?.message || 'unknown problem'}).` };
}

/** Opens the camera and/or microphone, falling back to whatever works. Returns { audio, video, problem }. */
async function openMedia({ audioId, videoId, wantVideo = true } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) return { audio: null, video: null, problem: { kind: 'unsupported', text: 'This browser can’t use a camera. Please update it, or use Chrome, Edge or Safari.' } };
  const audio = audioId ? { ...AUDIO, deviceId: { exact: audioId } } : AUDIO;
  const tries = wantVideo ? [{ audio, video: videoConstraints(videoId) }, { audio }, { video: videoConstraints(videoId) }] : [{ audio }];
  let problem = null;
  for (const constraints of tries) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const got = { audio: stream.getAudioTracks()[0] ?? null, video: stream.getVideoTracks()[0] ?? null };
      if (wantVideo && (!got.audio || !got.video)) problem = { kind: 'partial', text: !got.video ? 'No camera found, so you’ll join with your microphone only.' : 'No microphone found, so the other person won’t hear you.' };
      return { ...got, problem };
    } catch (error) {
      problem = mediaProblem(error);
      if (problem.kind === 'blocked') break; // trying again won't help until they allow it
    }
  }
  return { audio: null, video: null, problem };
}

/** A small level bar that moves when you speak. */
function MicMeter({ track }) {
  const bar = useRef(null);
  useEffect(() => {
    if (!track) return undefined;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return undefined;
    const ctx = new Ctx();
    let raf = 0;
    try {
      const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        if (bar.current) bar.current.style.transform = `scaleX(${track.enabled ? Math.min(1, peak / 60) : 0})`;
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* meter is optional */ }
    return () => { cancelAnimationFrame(raf); ctx.close().catch(() => {}); };
  }, [track]);
  return <span className="live-meter" aria-hidden="true"><span ref={bar}/></span>;
}

function VideoEl({ stream, track, muted = true, mirror = false, className = '', onPlayBlocked }) {
  const ref = useRef(null);
  const blocked = useRef(onPlayBlocked);
  blocked.current = onPlayBlocked;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const src = stream ?? (track ? new MediaStream([track]) : null);
    if (el.srcObject !== src) el.srcObject = src;
    if (src) el.play().catch((error) => { if (error?.name === 'NotAllowedError') blocked.current?.(); });
  }, [stream, track]);
  return <video ref={ref} className={`${className} ${mirror ? 'mirror' : ''}`} autoPlay playsInline muted={muted}/>;
}

function useClock(offset) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => { const id = setInterval(() => setNow(Date.now() + offset), 1000); return () => clearInterval(id); }, [offset]);
  return now;
}

const mmss = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`; };
/** Countdown for the top bar: before the class, the time left, then how far over time it is. */
function timeChip(info, now) {
  const start = new Date(info.class.starts_at).getTime();
  const end = start + info.class.duration_minutes * 60000;
  if (now < start) return { text: `Starts in ${mmss(start - now)}`, level: '' };
  if (now <= end) return { text: `Time left ${mmss(end - now)}`, level: end - now <= 5 * 60000 ? 'warn' : '' };
  return { text: `Time’s up · ${mmss(now - end)} over`, level: 'over' };
}

// ─── Before joining ───────────────────────────────────────────────────────
function Lobby({ info, peerName, onJoin, onBack }) {
  const [media, setMedia] = useState(null); // { audio, video, problem }
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [devices, setDevices] = useState({ audio: [], video: [] });
  const [chosen, setChosen] = useState({ audioId: '', videoId: '' });
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef(null);

  const open = useCallback(async (opts = {}) => {
    setBusy(true);
    mediaRef.current?.audio?.stop(); mediaRef.current?.video?.stop();
    const m = await openMedia(opts);
    mediaRef.current = m;
    setMedia(m);
    setBusy(false);
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({ audio: list.filter((d) => d.kind === 'audioinput' && d.deviceId), video: list.filter((d) => d.kind === 'videoinput' && d.deviceId) });
    } catch { /* lists are optional */ }
  }, []);
  useEffect(() => { open(); return () => { /* tracks are handed to the room, or stopped by leave() */ }; }, [open]);
  useEffect(() => { if (media?.audio) media.audio.enabled = mic; }, [mic, media]);

  const choose = (field) => (e) => { const next = { ...chosen, [field]: e.target.value }; setChosen(next); open(next); };
  const join = () => {
    const m = mediaRef.current ?? { audio: null, video: null };
    if (m.video && !cam) { m.video.stop(); m.video = null; }
    mediaRef.current = null; // the room owns the tracks now
    onJoin({ audio: m.audio, video: m.video, mic, cam: cam && Boolean(m.video), chosen });
  };
  const back = () => { mediaRef.current?.audio?.stop(); mediaRef.current?.video?.stop(); onBack(); };
  const c = info.class;

  return <div className="live-lobby">
    <div className="live-preview">
      {media?.video && cam ? <VideoEl track={media.video} mirror className="live-preview-video"/>
        : <div className="live-preview-off">{busy || !media ? <Loader2 className="spin" size={28}/> : <><VideoOff size={30}/><span>{media?.video ? 'Camera is off' : 'No camera'}</span></>}</div>}
      <div className="live-preview-bar">
        <button className={`live-round ${mic ? '' : 'off'}`} onClick={() => setMic(!mic)} disabled={!media?.audio} aria-label={mic ? 'Turn microphone off' : 'Turn microphone on'} title={mic ? 'Microphone on' : 'Microphone off'}>{mic && media?.audio ? <Mic size={20}/> : <MicOff size={20}/>}</button>
        <button className={`live-round ${cam ? '' : 'off'}`} onClick={() => setCam(!cam)} disabled={!media?.video} aria-label={cam ? 'Turn camera off' : 'Turn camera on'} title={cam ? 'Camera on' : 'Camera off'}>{cam && media?.video ? <Video size={20}/> : <VideoOff size={20}/>}</button>
        {media?.audio && <MicMeter track={media.audio}/>}
      </div>
    </div>
    <div className="live-lobby-side">
      <span className="live-eyebrow">{c.subject.toUpperCase()}{c.topic ? ` · ${c.topic}` : ''}</span>
      <h1>Ready to join?</h1>
      <p className="live-muted">{timeLabel(c.starts_at)} · {c.duration_minutes} minutes with {peerName}</p>
      {media?.problem && <div className={`live-note ${media.problem.kind === 'partial' ? '' : 'warn'}`}><AlertTriangle size={17}/><span>{media.problem.text}</span></div>}
      {(devices.video.length > 1 || devices.audio.length > 1) && <div className="live-devices">
        {devices.video.length > 1 && <label>Camera<select value={chosen.videoId} onChange={choose('videoId')}><option value="">Default camera</option>{devices.video.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>}
        {devices.audio.length > 1 && <label>Microphone<select value={chosen.audioId} onChange={choose('audioId')}><option value="">Default microphone</option>{devices.audio.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label>}
      </div>}
      <button className="live-btn primary" onClick={join} disabled={busy || !media}>{media && !media.audio && !media.video ? 'Join without camera and microphone' : 'Join class'}</button>
      {media?.problem && media.problem.kind !== 'partial' && <button className="live-btn ghost" onClick={() => open(chosen)} disabled={busy}><RefreshCw size={16}/>Try again</button>}
      {c.meeting_url && <a className="live-link" href={c.meeting_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>Use the {platformName(c.meeting_url)} backup link instead</a>}
      <button className="live-link" onClick={back}><ArrowLeft size={15}/>Back to the portal</button>
    </div>
  </div>;
}

// ─── In the class ─────────────────────────────────────────────────────────
function Room({ info, me, peerName, iceServers, start, onLeft, onReplaced, onEnded, clockOffset }) {
  const [status, setStatus] = useState('starting');
  const [error, setError] = useState('');
  const [remote, setRemote] = useState(null);
  const [peerMedia, setPeerMedia] = useState(null);
  const [peerHere, setPeerHere] = useState(false);
  const [quality, setQuality] = useState(null);
  const [needSound, setNeedSound] = useState(false);
  const [mic, setMic] = useState(start.mic && Boolean(start.audio));
  const [cam, setCam] = useState(start.cam && Boolean(start.video));
  const [videoTrack, setVideoTrack] = useState(start.video);
  const [audioTrack, setAudioTrack] = useState(start.audio);
  const [screen, setScreen] = useState(null);
  const [facing, setFacing] = useState('user');
  const [chatOpen, setChatOpen] = useState(() => !isMobile() && window.innerWidth > 1100);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState('');
  const [cameras, setCameras] = useState(0);
  const [, setRemoteTick] = useState(0); // redraw when the other camera pauses/resumes
  const [boardOpen, setBoardOpen] = useState(false);
  const board = useRef(null);
  const boardOpenRef = useRef(false);
  boardOpenRef.current = boardOpen;
  const session = useRef(null);
  const tracks = useRef({ audio: start.audio, video: start.video, screen: null });
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const now = useClock(clockOffset);
  const c = info.class;

  const flash = (text) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? '' : t)), 4000); };
  const stopAll = () => { Object.values(tracks.current).forEach((t) => t?.stop()); tracks.current = { audio: null, video: null, screen: null }; };

  // Join the room once.
  useEffect(() => {
    const s = new LiveSession({
      supabase, classId: c.id, iceServers,
      me: { userId: me.id, role: info.role, name: me.full_name },
      on: {
        status: setStatus,
        peer: (p) => setPeerHere(Boolean(p)),
        remoteStream: (stream) => setRemote(stream ? new MediaStream(stream.getTracks()) : null),
        peerMedia: setPeerMedia,
        quality: setQuality,
        chat: (msg) => { setMessages((list) => [...list.slice(-199), msg]); if (!chatOpenRef.current) setUnread((n) => n + 1); },
        replaced: () => { stopAll(); onReplaced(); },
        ended: () => { stopAll(); s.leave({ quiet: true }); onEnded(); },
        data: (msg) => { if (msg.t.startsWith('b-')) board.current?.receive(msg); },
        // A (re)connected call: the teacher sends the whole board so both always match.
        dataOpen: () => { if (info.role === 'teacher') board.current?.syncTo(boardOpenRef.current); },
      },
    });
    session.current = s;
    s.local = { audio: start.audio, video: start.video };
    s.media = { mic: start.mic && Boolean(start.audio), cam: start.cam && Boolean(start.video), screen: false };
    if (start.audio) start.audio.enabled = s.media.mic;
    s.connect().catch((e) => {
      setError(/unauthori|denied|permission|policy|closed|not allowed/i.test(e.message)
        ? 'This class room is closed right now, or live classes aren’t switched on yet (supabase/010_live_classes.sql).'
        : `Couldn’t open the class room: ${friendlyError(e.message)}`);
    });
    navigator.mediaDevices?.enumerateDevices?.().then((list) => setCameras(list.filter((d) => d.kind === 'videoinput').length)).catch(() => {});
    return () => { s.leave(); stopAll(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A remote track is "muted" while the other side sends nothing (camera off, or a network gap).
  useEffect(() => {
    if (!remote) return undefined;
    const bump = () => setRemoteTick((n) => n + 1);
    const list = remote.getTracks();
    list.forEach((t) => { t.addEventListener('mute', bump); t.addEventListener('unmute', bump); t.addEventListener('ended', bump); });
    return () => list.forEach((t) => { t.removeEventListener('mute', bump); t.removeEventListener('unmute', bump); t.removeEventListener('ended', bump); });
  }, [remote]);

  // Attendance: once now and then every minute while in the room.
  useEffect(() => {
    const beat = () => supabase.rpc('live_heartbeat', { p_class: c.id }).then(() => {}, () => {});
    beat();
    const id = setInterval(beat, 60000);
    return () => clearInterval(id);
  }, [c.id]);

  // Keep the screen awake, warn before closing the tab, and reconnect after sleep or a network drop.
  useEffect(() => {
    let lock = null;
    const getLock = () => { navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {}); };
    getLock();
    const onVisible = () => { if (document.visibilityState === 'visible') { getLock(); session.current?.nudge(); } };
    const onOnline = () => session.current?.nudge();
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      lock?.release().catch(() => {});
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  // If a microphone or camera is unplugged mid-class, pick up the next one by itself.
  useEffect(() => {
    const watch = (kind, track) => {
      if (!track) return undefined;
      const onEnded = async () => {
        if (tracks.current[kind] !== track) return;
        const m = await openMedia({ wantVideo: kind === 'video' }).catch(() => null);
        const next = kind === 'video' ? m?.video : m?.audio;
        if (kind === 'video') m?.audio?.stop(); else m?.video?.stop();
        if (!next) { flash(kind === 'video' ? 'Your camera was disconnected.' : 'Your microphone was disconnected.'); if (kind === 'video') { setCam(false); session.current?.setMedia({ cam: false }); } return; }
        if (kind === 'audio') next.enabled = mic;
        tracks.current[kind] = next;
        if (kind === 'video') setVideoTrack(next); else setAudioTrack(next);
        await session.current?.setLocalTrack(kind, next);
        flash(kind === 'video' ? 'Switched to another camera.' : 'Switched to another microphone.');
      };
      track.addEventListener('ended', onEnded);
      return () => track.removeEventListener('ended', onEnded);
    };
    const a = watch('audio', audioTrack), v = watch('video', videoTrack);
    return () => { a?.(); v?.(); };
  }, [audioTrack, videoTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMic = async () => {
    if (!tracks.current.audio) {
      const m = await openMedia({ wantVideo: false });
      if (!m.audio) { flash(m.problem?.text ?? 'No microphone found.'); return; }
      tracks.current.audio = m.audio; setAudioTrack(m.audio);
      await session.current?.setLocalTrack('audio', m.audio);
      setMic(true); session.current?.setMedia({ mic: true });
      return;
    }
    const next = !mic; setMic(next); session.current?.setMedia({ mic: next });
  };

  const toggleCam = async () => {
    if (cam) {
      setCam(false);
      await session.current?.setMedia({ cam: false });
      tracks.current.video?.stop(); tracks.current.video = null; setVideoTrack(null);   // camera light off
      await session.current?.setLocalTrack('video', null);
      return;
    }
    const m = await openMedia({ videoId: start.chosen?.videoId });
    m.audio?.stop();
    if (!m.video) { flash(m.problem?.text ?? 'No camera found.'); return; }
    tracks.current.video = m.video; setVideoTrack(m.video);
    await session.current?.setLocalTrack('video', m.video);
    setCam(true); await session.current?.setMedia({ cam: true });
  };

  const flipCamera = async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(null, next) });
      const track = stream.getVideoTracks()[0];
      tracks.current.video?.stop(); tracks.current.video = track; setVideoTrack(track); setFacing(next);
      await session.current?.setLocalTrack('video', track);
      if (!cam) { setCam(true); await session.current?.setMedia({ cam: true }); }
    } catch (e) { flash(mediaProblem(e).text); }
  };

  const stopShare = useCallback(async () => {
    tracks.current.screen?.stop(); tracks.current.screen = null; setScreen(null);
    await session.current?.setScreen(null);
  }, []);
  const toggleShare = async () => {
    if (screen) { await stopShare(); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      const track = stream.getVideoTracks()[0];
      if ('contentHint' in track) track.contentHint = 'detail';
      track.addEventListener('ended', () => { if (tracks.current.screen === track) stopShare(); });
      tracks.current.screen = track; setScreen(track);
      await session.current?.setScreen(track);
    } catch (e) {
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') flash('Couldn’t share your screen. Try again, or share a single window.');
    }
  };

  const sendChat = (e) => {
    e.preventDefault();
    const msg = session.current?.sendChat(draft);
    if (msg) { setMessages((list) => [...list.slice(-199), msg]); setDraft(''); }
  };
  const openChat = () => { setChatOpen(!chatOpen); setUnread(0); };

  const sendBoard = useCallback((msg) => session.current?.sendData(msg) ?? false, []);
  const setBoard = useCallback((open, tellOther) => {
    setBoardOpen(open);
    if (tellOther) session.current?.sendData({ t: 'b-open', open });
  }, []);
  /** Teacher: freeze the student's shared screen onto the whiteboard and open it for both. */
  const explainOnBoard = () => {
    const v = document.querySelector('.live-remote-video');
    if (v?.videoWidth) {
      const scale = Math.min(1, 1600 / v.videoWidth);
      const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      board.current?.setBackground(c.toDataURL('image/jpeg', 0.82));
    }
    setBoard(true, true);
    flash(`${first(peerName)} can now see the question on the whiteboard.`);
  };

  const leave = () => { session.current?.leave(); stopAll(); onLeft(); };
  const endForBoth = () => {
    if (!confirm(`End the class for you and ${peerName}?`)) return;
    session.current?.endForBoth(); stopAll(); onLeft();
  };

  const time = timeChip(info, now);
  const remoteHasVideo = Boolean(remote?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted)) && (peerMedia?.cam !== false || peerMedia?.screen);
  const statusText = error ? null
    : status === 'waiting' || (!peerHere && status !== 'starting') ? `Waiting for ${peerName} to join…`
    : status === 'connecting' || status === 'starting' ? `Connecting to ${peerName}…`
    : status === 'reconnecting' ? 'Connection lost. Reconnecting…'
    : status === 'trouble' ? `Can’t connect to ${peerName}.` : null;
  const reminder = info.role === 'teacher' && `Hi ${first(peerName)}! Our ${c.subject} class has started. Join from the student portal: ${location.origin}/portal/`;

  return <div className={`live-room ${chatOpen ? 'with-chat' : ''} ${boardOpen ? 'board-open' : ''}`}>
    <header className="live-top">
      <div className="live-title"><strong>{c.subject}</strong>{c.topic && <span>{c.topic}</span>}</div>
      <span className={`live-chip live-timer ${time.level}`} role="timer" aria-live="off"><Clock size={15}/>{time.text}</span>
      {quality && <span className={`live-chip q-${quality.level}`} title={`Round trip ${quality.rtt ? Math.round(quality.rtt * 1000) : '?'} ms · loss ${quality.loss}%${quality.relay ? ' · via relay' : ''}`}>
        <span className="live-dot"/>{quality.level === 'good' ? 'Good connection' : quality.level === 'fair' ? 'OK connection' : 'Weak connection'}</span>}
    </header>

    <main className="live-stage">
      <Whiteboard ref={board} role={info.role} send={sendBoard} open={boardOpen} onOpenChange={setBoard} peerName={first(peerName)}/>
      <div className="live-remote">
        <VideoEl stream={remote} muted={false} className={`live-remote-video ${remoteHasVideo ? '' : 'hidden'}`} onPlayBlocked={() => setNeedSound(true)}/>
        {!remoteHasVideo && <div className="live-avatar-wrap">
          <span className="live-avatar" style={avatarTone(peerName)}>{initials(peerName)}</span>
          <strong>{peerName}</strong>
          {statusText ? <span className="live-muted">{statusText}</span> : <span className="live-muted">Camera is off</span>}
          {status === 'trouble' && <div className="live-note warn"><WifiOff size={17}/><span>Ask {first(peerName)} to refresh the page.{c.meeting_url ? ' If it still doesn’t work, use the backup link.' : ''}</span></div>}
          {status === 'trouble' && <div className="live-row">
            <button className="live-btn ghost" onClick={() => session.current?.nudge()}><RefreshCw size={16}/>Try again</button>
            {c.meeting_url && <a className="live-btn ghost" href={c.meeting_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>{platformName(c.meeting_url)} backup</a>}
          </div>}
          {reminder && !peerHere && status !== 'starting' && !error && <a className="live-btn ghost" href={`https://wa.me/?text=${encodeURIComponent(reminder)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16}/>Remind {first(peerName)} on WhatsApp</a>}
        </div>}
        {remoteHasVideo && statusText && <span className="live-banner">{statusText}</span>}
        {peerHere && <span className="live-name">{peerName}{peerMedia && !peerMedia.mic && <MicOff size={14}/>}{peerMedia?.screen && ' · sharing screen'}</span>}
        {info.role === 'teacher' && peerMedia?.screen && remoteHasVideo && !boardOpen && <button className="live-btn primary live-explain" onClick={explainOnBoard}><PenLine size={17}/>Explain on whiteboard</button>}
        {needSound && <button className="live-btn primary live-sound" onClick={() => { document.querySelectorAll('.live-remote-video').forEach((v) => v.play().catch(() => {})); setNeedSound(false); }}><Volume2 size={18}/>Tap to hear {first(peerName)}</button>}
        {error && <div className="live-avatar-wrap"><div className="live-note warn"><AlertTriangle size={17}/><span>{error}</span></div><button className="live-btn ghost" onClick={leave}><ArrowLeft size={16}/>Back</button></div>}
      </div>

      <div className={`live-self ${screen ? 'is-screen' : ''}`}>
        {screen ? <VideoEl track={screen} className="live-self-video"/> : cam && videoTrack ? <VideoEl track={videoTrack} mirror={facing === 'user'} className="live-self-video"/>
          : <span className="live-avatar small" style={avatarTone(me.full_name)}>{initials(me.full_name)}</span>}
        <span className="live-name small">You{!mic && <MicOff size={12}/>}{screen && ' · sharing'}</span>
      </div>

      {chatOpen && <aside className="live-chat" aria-label="Chat">
        <div className="live-chat-head"><strong>Chat</strong><button className="live-icon" onClick={() => setChatOpen(false)} aria-label="Close chat"><X size={18}/></button></div>
        <ol className="live-chat-list">
          {messages.length === 0 && <li className="live-muted small">Messages are only for this class and aren’t saved.</li>}
          {messages.map((m) => <li key={m.id} className={m.role === info.role ? 'mine' : ''}><span className="live-chat-who">{m.role === info.role ? 'You' : m.name || peerName} · {timeLabel(new Date(m.at))}</span><span className="live-chat-text">{m.text}</span></li>)}
        </ol>
        <form className="live-chat-form" onSubmit={sendChat}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder={peerHere ? `Message ${first(peerName)}` : 'Type a message'} aria-label="Chat message"/>
          <button className="live-icon" disabled={!draft.trim()} aria-label="Send"><Send size={18}/></button>
        </form>
      </aside>}
    </main>

    {toast && <div className="live-toast" role="status">{toast}</div>}

    <footer className="live-controls">
      <button className={`live-round ${mic ? '' : 'off'}`} onClick={toggleMic} aria-label={mic ? 'Mute' : 'Unmute'} title={mic ? 'Mute' : 'Unmute'}>{mic ? <Mic size={22}/> : <MicOff size={22}/>}<span>{mic ? 'Mute' : 'Unmute'}</span></button>
      <button className={`live-round ${cam ? '' : 'off'}`} onClick={toggleCam} aria-label={cam ? 'Stop camera' : 'Start camera'} title={cam ? 'Stop camera' : 'Start camera'}>{cam ? <Video size={22}/> : <VideoOff size={22}/>}<span>Camera</span></button>
      {isMobile() && cameras > 1 && <button className="live-round" onClick={flipCamera} aria-label="Switch camera" title="Switch camera"><SwitchCamera size={22}/><span>Flip</span></button>}
      {canShareScreen() && <button className={`live-round ${screen ? 'active' : ''}`} onClick={toggleShare} aria-label={screen ? 'Stop sharing' : 'Share screen'} title={screen ? 'Stop sharing' : 'Share your screen'}>{screen ? <MonitorOff size={22}/> : <MonitorUp size={22}/>}<span>{screen ? 'Stop share' : 'Share'}</span></button>}
      <button className={`live-round ${boardOpen ? 'active' : ''}`} onClick={() => setBoard(!boardOpen, true)} aria-label={boardOpen ? 'Close whiteboard' : 'Open whiteboard'} title={boardOpen ? 'Close the whiteboard for both' : 'Open the whiteboard for both'}><Presentation size={22}/><span>Board</span></button>
      <button className={`live-round ${chatOpen ? 'active' : ''}`} onClick={openChat} aria-label="Chat" title="Chat"><MessageSquare size={22}/><span>Chat</span>{unread > 0 && <span className="live-badge">{unread}</span>}</button>
      <button className="live-round leave" onClick={leave} aria-label="Leave class" title="Leave class"><PhoneOff size={22}/><span>Leave</span></button>
      {info.role === 'teacher' && peerHere && <button className="live-btn ghost small live-end" onClick={endForBoth}>End class for both</button>}
    </footer>
  </div>;
}

// ─── The whole screen ─────────────────────────────────────────────────────
export default function LiveClass({ classId, profile, onClose }) {
  const [info, setInfo] = useState(null);
  const [problem, setProblem] = useState('');
  const [phase, setPhase] = useState('loading'); // loading | closed | lobby | room | left | replaced | ended
  const [start, setStart] = useState(null);
  const [ice, setIce] = useState(STUN_ONLY);
  const [round, setRound] = useState(0);

  const load = useCallback(async () => {
    setPhase('loading'); setProblem('');
    try {
      const [{ data, error }, iceResult] = await Promise.all([
        supabase.rpc('live_join', { p_class: classId }),
        api('/live/ice-servers').catch(() => null),
      ]);
      if (error) throw new Error(/live_join|function|schema cache/i.test(error.message) ? 'Live classes aren’t switched on yet. Your teacher needs to run supabase/010_live_classes.sql.' : friendlyError(error.message));
      if (iceResult?.iceServers?.length) setIce(iceResult.iceServers);
      setInfo(data);
      setPhase(data.state === 'open' ? 'lobby' : 'closed');
    } catch (e) {
      setProblem(e.message); setPhase('closed');
    }
  }, [classId]);
  useEffect(() => { load(); }, [load]);

  // While waiting for the room to open, check again when it should be open.
  const offset = info ? new Date(info.server_now).getTime() - Date.now() : 0;
  useEffect(() => {
    if (phase !== 'closed' || info?.state !== 'early') return undefined;
    const wait = Math.max(1000, new Date(info.opens_at).getTime() - (Date.now() + offset) + 1000);
    const id = setTimeout(load, Math.min(wait, 60000));
    return () => clearTimeout(id);
  }, [phase, info, offset, load]);

  // Escape key does nothing in the room (too easy to leave by accident); the page stays scroll-locked.
  useEffect(() => { document.body.classList.add('live-open'); return () => document.body.classList.remove('live-open'); }, []);

  const peerName = info ? (info.role === 'teacher' ? info.student?.name : info.teacher_name) || (info.role === 'teacher' ? 'your student' : 'your teacher') : '';
  const c = info?.class;
  const center = (children) => <div className="live-center"><div className="live-card">{children}</div></div>;

  let body;
  if (phase === 'loading') body = center(<><Loader2 className="spin" size={28}/><p>Opening your class…</p></>);
  else if (phase === 'closed') {
    const opens = info && new Date(info.opens_at);
    body = center(problem ? <><AlertTriangle size={30}/><h1>Can’t open this class</h1><p>{problem}</p><div className="live-row"><button className="live-btn ghost" onClick={load}><RefreshCw size={16}/>Try again</button><button className="live-btn primary" onClick={onClose}>Back to the portal</button></div></>
      : info.state === 'early' ? <><Clock size={30}/><h1>{c.subject} starts at {timeLabel(c.starts_at)}</h1><p>The class room opens at {timeLabel(opens)}. This page will open it by itself, so you can leave it open.</p><button className="live-btn primary" onClick={onClose}>Back to the portal</button></>
      : info.state === 'cancelled' ? <><AlertTriangle size={30}/><h1>This class was cancelled</h1><p>Check the portal for your next class.</p><button className="live-btn primary" onClick={onClose}>Back to the portal</button></>
      : <><Clock size={30}/><h1>This class has ended</h1><p>The class room closes an hour after the class finishes.</p><button className="live-btn primary" onClick={onClose}>Back to the portal</button></>);
  } else if (phase === 'lobby') body = <Lobby info={info} peerName={peerName} onBack={onClose} onJoin={(s) => { setStart(s); setRound((r) => r + 1); setPhase('room'); }}/>;
  else if (phase === 'room') body = <Room key={round} info={info} me={profile} peerName={peerName} iceServers={ice} start={start} clockOffset={offset}
    onLeft={() => setPhase('left')} onReplaced={() => setPhase('replaced')} onEnded={() => setPhase('ended')}/>;
  else if (phase === 'left') body = center(<><PhoneOff size={30}/><h1>You left the class</h1><p>{c.subject} with {peerName}</p><div className="live-row"><button className="live-btn ghost" onClick={load}><RefreshCw size={16}/>Rejoin</button><button className="live-btn primary" onClick={onClose}>Back to the portal</button></div></>);
  else if (phase === 'ended') body = center(<><PhoneOff size={30}/><h1>Your teacher ended the class</h1><p>Well done today! Your homework and next class are in the portal.</p><button className="live-btn primary" onClick={onClose}>Back to the portal</button></>);
  else body = center(<><AlertTriangle size={30}/><h1>You joined on another device</h1><p>This class is now open in another tab or device, so it was closed here.</p><div className="live-row"><button className="live-btn ghost" onClick={load}>Use this one instead</button><button className="live-btn primary" onClick={onClose}>Back to the portal</button></div></>);

  return <div className="live" role="dialog" aria-label="Live class">{body}</div>;
}
