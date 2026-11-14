// Live class engine: a one-to-one video call between the teacher and a student.
//
// Video and sound go DIRECTLY between the two browsers (WebRTC). Supabase Realtime is only used
// to find each other and exchange the short connection messages, in a private room
// "class:<id>" that only this class's student and the teacher can enter (see 010_live_classes.sql).
//
// Who calls whom: the teacher always makes the offer and the student answers, so the two sides
// never talk over each other. Every browser tab gets its own sessionId; when someone refreshes or
// rejoins, the other side sees a new sessionId and starts a fresh call. Each call has a callId so
// messages from an old call are ignored. Turning the camera on/off or sharing the screen only
// swaps the track on an existing sender, so the call never has to be renegotiated for that.
//
// The whiteboard uses a direct data channel inside the same call (also peer-to-peer), so drawing
// never goes through Supabase. Big messages (a picture of the shared screen) are sent in chunks.

export const STUN_ONLY = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const KINDS = ['audio', 'video'];
const DISCONNECT_GRACE_MS = 4000; // a short "disconnected" often fixes itself
const TROUBLE_AFTER_MS = 25000;   // not connected for this long: suggest the backup link
const GONE_AFTER_MS = 8000;       // the other person vanished from the room (battery died, Wi-Fi dropped)
const CHUNK = 15000;            // characters per data-channel message
const MAX_ASSEMBLED = 8_000_000; // refuse anything bigger than ~8 MB of text
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export class LiveSession {
  /**
   * @param {object} o
   * @param {object} o.supabase    signed-in Supabase client
   * @param {string} o.classId
   * @param {{userId: string, role: 'teacher'|'student', name: string}} o.me
   * @param {RTCIceServer[]} o.iceServers
   * @param {object} o.on  callbacks: status(s), peer(p|null), remoteStream(stream), peerMedia(m), chat(msg), quality(q), replaced()
   */
  constructor({ supabase, classId, me, iceServers, on, clockOffset = 0 }) {
    Object.assign(this, { supabase, classId, me, iceServers: iceServers?.length ? iceServers : STUN_ONLY, on });
    this.sessionId = newId();
    // Join time on the SERVER's clock, so a phone whose clock is wrong can't look "newer" than it is.
    this.joinedAt = Date.now() + (Number.isFinite(clockOffset) ? clockOffset : 0);
    this.local = { audio: null, video: null };
    this.media = { mic: true, cam: true, screen: false };
    this.peer = null;          // { sessionId, userId, role, name, joinedAt }
    this.pc = null;
    this.callId = null;
    this.pendingCandidates = [];
    this.everSubscribed = false;
    this.closed = false;
    this.timers = new Set();
    this.troubleTimer = null;
    this.restarts = 0;
    this.dc = null;
    this.incoming = new Map(); // chunked data-channel messages being put back together
    this.departed = new Set(); // sessions that said goodbye or closed their page: never call them again
  }

  // ── Room (Realtime channel) ────────────────────────────────────────────
  async connect() {
    try { await this.supabase.realtime.setAuth(); } catch { /* the client also does this itself */ }
    const channel = this.supabase.channel(`class:${this.classId}`, {
      config: { private: true, broadcast: { self: false, ack: false }, presence: { key: this.sessionId } },
    });
    this.channel = channel;
    channel.on('presence', { event: 'sync' }, () => this.onPresence());
    channel.on('broadcast', { event: 'hello' }, ({ payload }) => this.onHello(payload));
    channel.on('broadcast', { event: 'signal' }, ({ payload }) => this.onSignal(payload).catch((e) => this.report('signal', e)));
    channel.on('broadcast', { event: 'media' }, ({ payload }) => { if (payload?.from === this.peer?.sessionId) this.on.peerMedia?.(payload.media); });
    channel.on('broadcast', { event: 'chat' }, ({ payload }) => { if (payload && payload.from !== this.sessionId) this.on.chat?.(sanitizeChat(payload)); });
    channel.on('broadcast', { event: 'bye' }, ({ payload }) => {
      if (!payload?.from) return;
      this.departed.add(payload.from);
      if (payload.from === this.peer?.sessionId) this.peerLeft();
    });
    // "Class ended" may arrive just after the call itself closed, so also accept it from a teacher who just left.
    channel.on('broadcast', { event: 'end' }, ({ payload }) => {
      if (payload?.from && this.me.role === 'student' && (payload.from === this.peer?.sessionId || this.departed.has(payload.from))) this.on.ended?.();
    });
    return new Promise((resolve, reject) => {
      channel.subscribe(async (status, error) => {
        if (this.closed) return;
        if (status === 'SUBSCRIBED') {
          const first = !this.everSubscribed;
          this.everSubscribed = true;
          await channel.track(this.presenceMeta());
          // "fresh" = this device has just joined: any older tab/device of the same person hands over to it.
          this.send('hello', { ...this.presenceMeta(), reply: false, fresh: first });
          this.on.status?.(this.peer ? (this.isConnected() ? 'connected' : 'connecting') : 'waiting');
          if (first) resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (!this.everSubscribed) { reject(new Error(error?.message || status)); return; }
          // Realtime reconnects by itself; the video may well still be flowing meanwhile.
          if (!this.isConnected()) this.on.status?.('reconnecting');
        }
      });
    });
  }

  presenceMeta() { return { sessionId: this.sessionId, userId: this.me.userId, role: this.me.role, name: this.me.name, joinedAt: this.joinedAt }; }

  send(event, payload) {
    if (!this.channel || this.closed) return;
    this.channel.send({ type: 'broadcast', event, payload: { ...payload, from: this.sessionId } }).catch(() => { /* resent by the next state change */ });
  }

  onPresence() {
    if (this.closed) return;
    const metas = Object.values(this.channel.presenceState()).flat();
    // The same person joined from another tab or device more recently: hand over to it.
    if (metas.some((m) => m.userId === this.me.userId && m.sessionId !== this.sessionId && m.joinedAt > this.joinedAt)) { this.replacedElsewhere(); return; }
    // A closed page can linger in the room's list for a few seconds: skip anyone who has already left.
    const peer = metas.filter((m) => m.role !== this.me.role && m.sessionId && !this.departed.has(m.sessionId)).sort((a, b) => b.joinedAt - a.joinedAt)[0];
    clearTimeout(this.goneTimer); this.goneTimer = null;
    if (peer) { this.setPeer(peer); return; }
    if (!this.peer) return;
    // An explicit "bye" is handled immediately. Without one, the other person may just have had a short
    // network blip (their video can even still be flowing), so wait a few seconds before calling them gone.
    if (!this.isConnected()) { this.peerLeft(); return; }
    const gone = this.peer.sessionId;
    this.goneTimer = setTimeout(() => {
      if (this.closed || this.peer?.sessionId !== gone || !this.channel) return;
      const still = Object.values(this.channel.presenceState()).flat().some((m) => m.sessionId === gone);
      if (!still) this.peerLeft();
    }, GONE_AFTER_MS);
  }

  onHello(meta) {
    if (!meta?.sessionId || this.closed) return;
    if (meta.userId === this.me.userId) {
      if (meta.sessionId !== this.sessionId && (meta.fresh || meta.joinedAt > this.joinedAt)) this.replacedElsewhere();
      return;
    }
    if (meta.role === this.me.role || this.departed.has(meta.sessionId)) return;
    this.setPeer(meta);
    if (!meta.reply) this.send('hello', { ...this.presenceMeta(), reply: true });
  }

  setPeer(meta) {
    if (this.peer?.sessionId === meta.sessionId) return;
    if (this.peer && meta.joinedAt < this.peer.joinedAt) return; // an older tab of theirs: ignore
    this.peer = { sessionId: meta.sessionId, userId: meta.userId, role: meta.role, name: meta.name, joinedAt: meta.joinedAt };
    this.on.peer?.(this.peer);
    this.resetCall();
    this.on.status?.('connecting');
    if (this.me.role === 'teacher') this.call().catch((e) => this.report('call', e));
    this.armTrouble();
  }

  peerLeft() {
    this.peer = null;
    this.resetCall();
    this.on.peer?.(null);
    this.on.peerMedia?.(null);
    this.on.status?.('waiting');
  }

  replacedElsewhere() {
    if (this.closed) return;
    this.leave({ quiet: true });
    this.on.replaced?.();
  }

  // ── Call (RTCPeerConnection) ───────────────────────────────────────────
  resetCall() {
    clearTimeout(this.troubleTimer);
    if (this.dc) { try { this.dc.close(); } catch { /* fine */ } }
    this.dc = null;
    this.incoming.clear();
    if (this.pc) { try { this.pc.close(); } catch { /* already closed */ } }
    this.pc = null;
    this.callId = null;
    this.pendingCandidates = [];
    this.restarts = 0;
    this.on.remoteStream?.(null);
    this.on.quality?.(null);
  }

  newPeerConnection(callId) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    this.callId = callId;
    const remote = new MediaStream();
    pc.ontrack = ({ track }) => {
      if (this.pc !== pc) return;
      if (!remote.getTracks().includes(track)) remote.addTrack(track);
      this.on.remoteStream?.(remote);
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate && this.pc === pc) this.signal({ candidate: candidate.toJSON() }); };
    pc.ondatachannel = ({ channel }) => { if (this.pc === pc && channel.label === 'board') this.setupData(channel); };
    pc.onconnectionstatechange = () => this.onConnectionState(pc);
    pc.oniceconnectionstatechange = () => this.onConnectionState(pc);
    return pc;
  }

  /** Teacher: start a new call to the current peer. */
  async call() {
    if (!this.peer || this.closed) return;
    const pc = this.newPeerConnection(newId());
    this.setupData(pc.createDataChannel('board', { ordered: true }));
    for (const kind of KINDS) {
      const tx = pc.addTransceiver(kind, { direction: 'sendrecv' });
      await tx.sender.replaceTrack(this.outgoing(kind));
    }
    await this.sendOffer(pc);
  }

  async sendOffer(pc, iceRestart = false) {
    if (this.pc !== pc || pc.signalingState === 'closed') return;
    const offer = await pc.createOffer({ iceRestart });
    if (this.pc !== pc) return;
    await pc.setLocalDescription(offer);
    this.signal({ description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : { type: offer.type, sdp: offer.sdp } });
  }

  signal(data) {
    if (!this.peer) return;
    this.send('signal', { to: this.peer.sessionId, callId: this.callId, ...data });
  }

  async onSignal(msg) {
    if (!msg || msg.to !== this.sessionId || this.closed) return;
    // A message from someone we haven't seen yet (their "hello" may still be on its way).
    if (!this.peer || this.peer.sessionId !== msg.from) {
      if (this.me.role === 'student' && msg.description?.type === 'offer') {
        this.peer = { sessionId: msg.from, role: 'teacher', name: this.peer?.name ?? '', joinedAt: Date.now() };
        this.on.peer?.(this.peer);
      } else return;
    }
    if (msg.description) {
      const { type } = msg.description;
      if (type === 'offer' && this.me.role === 'student') {
        let pc = this.pc;
        if (!pc || msg.callId !== this.callId) { this.resetCall(); pc = this.newPeerConnection(msg.callId); this.on.status?.('connecting'); this.armTrouble(); }
        await pc.setRemoteDescription(msg.description);
        for (const tx of pc.getTransceivers()) {
          const kind = tx.receiver.track?.kind;
          if (!KINDS.includes(kind)) continue;
          tx.direction = 'sendrecv';
          await tx.sender.replaceTrack(this.outgoing(kind));
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signal({ description: { type: answer.type, sdp: pc.localDescription.sdp } });
        await this.flushCandidates();
      } else if (type === 'answer' && this.me.role === 'teacher') {
        if (!this.pc || msg.callId !== this.callId || this.pc.signalingState !== 'have-local-offer') return;
        await this.pc.setRemoteDescription(msg.description);
        await this.flushCandidates();
      }
    } else if (msg.candidate) {
      if (msg.callId !== this.callId) return;
      if (!this.pc?.remoteDescription) { this.pendingCandidates.push(msg.candidate); return; }
      await this.pc.addIceCandidate(msg.candidate).catch(() => { /* a stale candidate is harmless */ });
    } else if (msg.restart && this.me.role === 'teacher' && msg.callId === this.callId) {
      this.restartIce();
    }
  }

  async flushCandidates() {
    const list = this.pendingCandidates.splice(0);
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => {});
  }

  isConnected() { return ['connected', 'completed'].includes(this.pc?.iceConnectionState) || this.pc?.connectionState === 'connected'; }

  onConnectionState(pc) {
    if (this.pc !== pc || this.closed) return;
    const ice = pc.iceConnectionState;
    if (this.isConnected()) {
      clearTimeout(this.troubleTimer); this.troubleTimer = null;
      this.restarts = 0;
      this.on.status?.('connected');
      this.sendMediaState();
      this.startQuality();
    } else if (ice === 'disconnected') {
      this.on.status?.('reconnecting');
      this.later(() => { if (this.pc === pc && pc.iceConnectionState === 'disconnected') this.restartIce(); }, DISCONNECT_GRACE_MS);
      this.armTrouble();
    } else if (ice === 'failed' || pc.connectionState === 'failed') {
      this.on.status?.('reconnecting');
      this.restartIce();
      this.armTrouble();
    }
  }

  restartIce() {
    if (!this.pc || this.closed || !this.peer) return;
    this.restarts += 1;
    if (this.me.role === 'teacher') {
      // After a few tries, start a completely fresh call instead.
      if (this.restarts > 3) { this.restarts = 0; this.resetCall(); this.call().catch((e) => this.report('call', e)); return; }
      try { this.pc.restartIce?.(); } catch { /* older browsers */ }
      this.sendOffer(this.pc, true).catch((e) => this.report('restart', e));
    } else {
      this.signal({ restart: true });
    }
  }

  armTrouble() {
    clearTimeout(this.troubleTimer);
    this.troubleTimer = setTimeout(() => { if (!this.closed && this.peer && !this.isConnected()) this.on.status?.('trouble'); }, TROUBLE_AFTER_MS);
  }

  /** Called when the browser comes back online or the tab becomes visible again. */
  nudge() {
    if (this.closed) return;
    if (this.peer && this.pc && !this.isConnected()) this.restartIce();
    if (this.channel && this.everSubscribed) this.send('hello', { ...this.presenceMeta(), reply: false, fresh: false });
  }

  // ── Data channel (whiteboard) ──────────────────────────────────────────
  setupData(dc) {
    this.dc = dc;
    dc.onopen = () => { if (this.dc === dc) this.on.dataOpen?.(); };
    dc.onmessage = (e) => { if (this.dc === dc) this.onData(e.data); };
    // The other side closed the call (closed or refreshed their page): this arrives within about a
    // second, much sooner than the room notices. If the network is the problem instead, the call isn't
    // "connected" any more and the normal reconnect logic handles it.
    dc.onclose = () => {
      if (this.dc !== dc || this.closed || !this.peer || !this.isConnected()) return;
      this.departed.add(this.peer.sessionId);
      this.peerLeft();
    };
  }

  dataReady() { return this.dc?.readyState === 'open'; }

  /** Sends an object to the other person over the call. Returns false if the call isn't ready. */
  sendData(obj) {
    if (!this.dataReady()) return false;
    const text = JSON.stringify(obj);
    try {
      if (text.length <= CHUNK) { this.dc.send(text); return true; }
      const id = newId(), n = Math.ceil(text.length / CHUNK);
      for (let i = 0; i < n; i++) this.dc.send(JSON.stringify({ t: '_chunk', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
      return true;
    } catch (error) { this.report('sendData', error); return false; }
  }

  onData(raw) {
    if (typeof raw !== 'string' || raw.length > CHUNK * 2) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg?.t === '_chunk') {
      const { id, i, n, d } = msg;
      if (typeof id !== 'string' || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n * CHUNK > MAX_ASSEMBLED || i < 0 || i >= n || typeof d !== 'string') return;
      if (!this.incoming.has(id)) { if (this.incoming.size > 4) this.incoming.clear(); this.incoming.set(id, { n, parts: new Array(n), got: 0 }); }
      const entry = this.incoming.get(id);
      if (entry.n !== n || entry.parts[i] !== undefined) return;
      entry.parts[i] = d; entry.got += 1;
      if (entry.got < n) return;
      this.incoming.delete(id);
      try { msg = JSON.parse(entry.parts.join('')); } catch { return; }
    }
    if (msg?.t === '_end') { if (this.me.role === 'student') this.on.ended?.(); return; }
    if (msg && typeof msg === 'object' && typeof msg.t === 'string') this.on.data?.(msg);
  }

  // ── Local media ────────────────────────────────────────────────────────
  /** What we send for a kind right now (the shared screen replaces the camera). */
  outgoing(kind) {
    if (kind === 'video') return this.screenTrack ?? (this.media.cam ? this.local.video : null);
    return this.local.audio;
  }

  senderFor(kind) {
    return this.pc?.getTransceivers().find((t) => (t.receiver.track?.kind ?? t.sender.track?.kind) === kind && t.currentDirection !== 'stopped')?.sender ?? null;
  }

  async refreshSender(kind) {
    const sender = this.senderFor(kind);
    if (sender) await sender.replaceTrack(this.outgoing(kind)).catch((e) => this.report('replaceTrack', e));
  }

  async setLocalTrack(kind, track) {
    this.local[kind] = track;
    await this.refreshSender(kind);
  }

  async setScreen(track) {
    this.screenTrack = track;
    this.media.screen = Boolean(track);
    await this.refreshSender('video');
    this.sendMediaState();
  }

  async setMedia(changes) {
    Object.assign(this.media, changes);
    if (this.local.audio) this.local.audio.enabled = this.media.mic;
    await this.refreshSender('video');
    this.sendMediaState();
  }

  sendMediaState() {
    this.send('media', { media: { mic: this.media.mic && Boolean(this.local.audio), cam: this.media.cam && Boolean(this.local.video), screen: this.media.screen } });
  }

  sendChat(text) {
    const msg = sanitizeChat({ id: newId(), name: this.me.name, role: this.me.role, text, at: Date.now() });
    if (!msg.text) return null;
    this.send('chat', msg);
    return msg;
  }

  // ── Connection quality (every 3 s while connected) ─────────────────────
  startQuality() {
    if (this.qualityTimer) return;
    let last = null;
    this.qualityTimer = setInterval(async () => {
      const pc = this.pc;
      if (!pc || !this.isConnected()) return;
      try {
        const stats = await pc.getStats();
        let rtt = null, lost = 0, received = 0, relay = false;
        const byId = new Map(); stats.forEach((r) => byId.set(r.id, r));
        stats.forEach((r) => {
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) {
            rtt = r.currentRoundTripTime ?? rtt;
            relay = byId.get(r.localCandidateId)?.candidateType === 'relay' || byId.get(r.remoteCandidateId)?.candidateType === 'relay';
          }
          if (r.type === 'inbound-rtp' && !r.isRemote) { lost += r.packetsLost ?? 0; received += r.packetsReceived ?? 0; }
        });
        const dLost = last ? Math.max(0, lost - last.lost) : 0, dRecv = last ? Math.max(0, received - last.received) : 0;
        last = { lost, received };
        const loss = dRecv + dLost ? (dLost / (dRecv + dLost)) * 100 : 0;
        const level = rtt > 0.45 || loss > 8 ? 'poor' : rtt > 0.25 || loss > 3 ? 'fair' : 'good';
        this.on.quality?.({ level, rtt, loss: Math.round(loss * 10) / 10, relay });
      } catch { /* stats are best-effort */ }
    }, 3000);
  }

  // ── Leaving ────────────────────────────────────────────────────────────
  later(fn, ms) { const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms); this.timers.add(id); }

  /** Teacher: end the class for both (the student sees "Your teacher ended the class"). */
  endForBoth() {
    if (this.me.role !== 'teacher') return;
    this.sendData({ t: '_end' }); // fastest: over the call itself
    this.send('end', {});         // backup: through the room
    this.leave({ delayMs: 400 }); // keep the call open a moment so both get through
  }

  leave({ quiet = false, delayMs = 0 } = {}) {
    if (this.closed) return;
    if (!quiet) this.send('bye', {});
    this.closed = true;
    clearInterval(this.qualityTimer); clearTimeout(this.troubleTimer); clearTimeout(this.goneTimer);
    this.timers.forEach(clearTimeout); this.timers.clear();
    const pc = this.pc, dc = this.dc, channel = this.channel;
    this.pc = null; this.dc = null; this.channel = null;
    const finish = () => {
      if (dc) { try { dc.close(); } catch { /* fine */ } }
      if (pc) { try { pc.close(); } catch { /* fine */ } }
      // Give the "bye" a moment to go out before closing the room connection.
      if (channel) setTimeout(() => { channel.untrack().catch(() => {}).finally(() => this.supabase.removeChannel(channel)); }, quiet ? 0 : 150);
    };
    if (delayMs) setTimeout(finish, delayMs); else finish();
  }

  report(where, error) {
    console.warn(`[live] ${where}:`, error?.message ?? error);
  }
}

function sanitizeChat(m) {
  const text = String(m?.text ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, 1000);
  return { id: String(m?.id ?? newId()).slice(0, 64), name: String(m?.name ?? '').slice(0, 80), role: m?.role === 'teacher' ? 'teacher' : 'student', text, at: Number(m?.at) || Date.now() };
}
