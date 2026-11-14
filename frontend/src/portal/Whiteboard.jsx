import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Download, Eraser, Grid3x3, ImageOff, PenLine, Trash2, Undo2, X } from 'lucide-react';

// Shared whiteboard for the live class. Both people can draw; the teacher can clear it.
// Everything is in "board units" (0–1 across, 0–1 down on a 16:9 board) so it lines up on any screen.
// Messages go over the call's direct data channel (see live.js), never through Supabase.

export const COLORS = ['#1d3352', '#d93a2b', '#2f7a4d', '#2d5596', '#7155ba'];
const SIZES = { thin: 3, thick: 7 };
const ERASER = 22;
const MAX_STROKES = 4000;
const MAX_POINTS = 20000; // per stroke (x and y each count)
const SEND_EVERY_MS = 40;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const okNum = (n) => typeof n === 'number' && Number.isFinite(n) && n > -0.2 && n < 1.2;
const okId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 64;
const okStroke = (s) => s && okId(s.id) && (s.erase || COLORS.includes(s.color)) && typeof s.size === 'number' && s.size > 0 && s.size <= 40
  && Array.isArray(s.pts) && s.pts.length <= MAX_POINTS && s.pts.every(okNum) && (s.by === 'teacher' || s.by === 'student');
const okImage = (img) => img === null || (typeof img === 'string' && img.length < 6_000_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img));

function drawStroke(ctx, s, w, h, from = 0) {
  const pts = s.pts;
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.erase ? '#000' : s.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = (s.erase ? ERASER : s.size) * (w / 1000);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const start = Math.max(0, from - 2);
  if (pts.length === 2) { ctx.beginPath(); ctx.arc(pts[0] * w, pts[1] * h, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
  ctx.beginPath();
  ctx.moveTo(pts[start] * w, pts[start + 1] * h);
  for (let i = start + 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * w, pts[i + 1] * h);
  ctx.stroke();
  ctx.restore();
}

const Whiteboard = forwardRef(function Whiteboard({ role, send, open, onOpenChange, peerName }, ref) {
  const wrap = useRef(null);
  const bgCanvas = useRef(null);
  const inkCanvas = useRef(null);
  const strokes = useRef([]);          // all strokes, in order
  const byId = useRef(new Map());
  const bg = useRef(null);             // { src, img } or null
  const drawing = useRef(null);        // the stroke I'm drawing now
  const outbox = useRef([]);           // points not yet sent
  const grid = useRef(false);          // squared paper (for graphs and geometry)
  const [tool, setTool] = useState({ color: COLORS[0], size: 'thin', erase: false });
  const [, setVersion] = useState(0);  // redraw the toolbar when undo/clear availability changes
  const bump = () => setVersion((v) => v + 1);

  const dims = () => { const c = inkCanvas.current; return c ? { w: c.width, h: c.height } : { w: 0, h: 0 }; };
  const redrawInk = useCallback(() => {
    const c = inkCanvas.current; if (!c) return;
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
    for (const s of strokes.current) drawStroke(ctx, s, c.width, c.height);
  }, []);
  const redrawBg = useCallback(() => {
    const c = bgCanvas.current; if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    if (grid.current) {
      // 32 squares across; every 4th line a little darker, like maths exercise-book paper.
      const step = c.width / 32;
      ctx.lineWidth = Math.max(1, c.width / 1600);
      for (let i = 1; i * step < Math.max(c.width, c.height); i++) {
        ctx.strokeStyle = i % 4 === 0 ? '#b9c6dd' : '#e1e7f1';
        const p = Math.round(i * step) + 0.5;
        if (p < c.width) { ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, c.height); ctx.stroke(); }
        if (p < c.height) { ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(c.width, p); ctx.stroke(); }
      }
    }
    const img = bg.current?.img;
    if (img?.complete && img.naturalWidth) {
      const scale = Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
    }
  }, []);

  // Keep the canvases sharp at any size (and on high-resolution screens).
  useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const resize = () => {
      const r = el.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvases = [bgCanvas.current, inkCanvas.current];
      if (canvases.some((c) => !c)) return; // the class room is closing
      for (const c of canvases) { c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr)); }
      redrawBg(); redrawInk();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    return () => ro.disconnect();
  }, [redrawBg, redrawInk]);

  const setBackgroundLocal = (src) => {
    if (!src) { bg.current = null; redrawBg(); bump(); return; }
    const img = new Image();
    img.onload = () => { if (bg.current?.img === img) { redrawBg(); bump(); } };
    img.src = src;
    bg.current = { src, img };
    redrawBg();
  };
  const addStroke = (s) => {
    if (byId.current.has(s.id) || strokes.current.length >= MAX_STROKES) return null;
    strokes.current.push(s); byId.current.set(s.id, s); return s;
  };
  const removeStroke = (id) => {
    const s = byId.current.get(id); if (!s) return;
    strokes.current = strokes.current.filter((x) => x !== s); byId.current.delete(id);
    redrawInk(); bump();
  };
  const clearAll = () => { strokes.current = []; byId.current.clear(); redrawInk(); bump(); };
  const setGridLocal = (on) => { grid.current = Boolean(on); redrawBg(); bump(); };
  const toggleGrid = () => { setGridLocal(!grid.current); send({ t: 'b-grid', on: grid.current }); };

  // ── Sending what I draw (batched) ──
  useEffect(() => {
    const id = setInterval(() => {
      const d = drawing.current;
      if (!d || !outbox.current.length) return;
      send({ t: 'b-pts', id: d.id, pts: outbox.current.splice(0) });
    }, SEND_EVERY_MS);
    return () => clearInterval(id);
  }, [send]);

  const point = (e) => { const r = inkCanvas.current.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const down = (e) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    inkCanvas.current.setPointerCapture?.(e.pointerId);
    const [x, y] = point(e);
    const s = addStroke({ id: newId(), by: role, color: tool.color, size: SIZES[tool.size], erase: tool.erase, pts: [x, y] });
    if (!s) return;
    drawing.current = s; outbox.current = [];
    send({ t: 'b-start', id: s.id, by: s.by, color: s.color, size: s.size, erase: s.erase, x, y });
    const { w, h } = dims(); drawStroke(inkCanvas.current.getContext('2d'), s, w, h);
  };
  const move = (e) => {
    const s = drawing.current; if (!s) return;
    e.preventDefault();
    const events = e.getCoalescedEvents?.() ?? [e];
    const from = s.pts.length;
    for (const ev of events) {
      if (s.pts.length >= MAX_POINTS) break;
      const [x, y] = point(ev);
      s.pts.push(x, y); outbox.current.push(x, y);
    }
    const { w, h } = dims(); drawStroke(inkCanvas.current.getContext('2d'), s, w, h, from);
  };
  const up = () => {
    const s = drawing.current; if (!s) return;
    if (outbox.current.length) send({ t: 'b-pts', id: s.id, pts: outbox.current.splice(0) });
    send({ t: 'b-end', id: s.id });
    drawing.current = null; bump();
  };

  const myLast = () => [...strokes.current].reverse().find((s) => s.by === role);
  const undo = () => { const s = myLast(); if (!s) return; removeStroke(s.id); send({ t: 'b-undo', id: s.id }); };
  const clear = () => { if (!confirm('Clear everything drawn on the board?')) return; clearAll(); send({ t: 'b-clear' }); };
  const removePicture = () => { setBackgroundLocal(null); send({ t: 'b-bg', img: null }); };
  const save = () => {
    const out = document.createElement('canvas'); out.width = bgCanvas.current.width; out.height = bgCanvas.current.height;
    const ctx = out.getContext('2d'); ctx.drawImage(bgCanvas.current, 0, 0); ctx.drawImage(inkCanvas.current, 0, 0);
    const a = document.createElement('a'); a.href = out.toDataURL('image/png'); a.download = `whiteboard-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`; a.click();
  };

  useImperativeHandle(ref, () => ({
    /** A whiteboard message from the other person. */
    receive(msg) {
      if (msg.t === 'b-open') { onOpenChange(Boolean(msg.open), false); return; }
      if (msg.t === 'b-start' && okId(msg.id) && okNum(msg.x) && okNum(msg.y)) {
        const s = { id: msg.id, by: msg.by === 'teacher' ? 'teacher' : 'student', color: msg.color, size: msg.size, erase: Boolean(msg.erase), pts: [msg.x, msg.y] };
        if (okStroke(s) && addStroke(s)) { const { w, h } = dims(); drawStroke(inkCanvas.current.getContext('2d'), s, w, h); }
      } else if (msg.t === 'b-pts' && okId(msg.id) && Array.isArray(msg.pts) && msg.pts.length % 2 === 0 && msg.pts.every(okNum)) {
        const s = byId.current.get(msg.id); if (!s || s.pts.length + msg.pts.length > MAX_POINTS) return;
        const from = s.pts.length; s.pts.push(...msg.pts);
        const { w, h } = dims(); drawStroke(inkCanvas.current.getContext('2d'), s, w, h, from);
      } else if (msg.t === 'b-undo' && okId(msg.id)) removeStroke(msg.id);
      else if (msg.t === 'b-clear' && role === 'student') clearAll();
      else if (msg.t === 'b-bg' && okImage(msg.img)) setBackgroundLocal(msg.img);
      else if (msg.t === 'b-grid') setGridLocal(msg.on === true);
      else if (msg.t === 'b-sync' && role === 'student' && Array.isArray(msg.strokes) && okImage(msg.bg)) {
        // The teacher's copy is the full picture (it includes what I drew before reconnecting).
        strokes.current = []; byId.current.clear();
        for (const s of msg.strokes.slice(0, MAX_STROKES)) if (okStroke(s)) addStroke({ ...s, erase: Boolean(s.erase) });
        grid.current = msg.grid === true;
        setBackgroundLocal(msg.bg); redrawInk(); bump();
        onOpenChange(Boolean(msg.open), false);
      }
    },
    /** Teacher: send the whole board to a (re)connected student. */
    syncTo(isOpen) {
      if (role !== 'teacher') return;
      send({ t: 'b-sync', open: isOpen, grid: grid.current, bg: bg.current?.src ?? null, strokes: strokes.current.map(({ id, by, color, size, erase, pts }) => ({ id, by, color, size, erase, pts })) });
    },
    /** Put a picture (e.g. the student's shared screen) behind the drawing, for both. */
    setBackground(src) { setBackgroundLocal(src); send({ t: 'b-bg', img: src }); },
    hasDrawing() { return strokes.current.length > 0; },
  }));

  const canUndo = Boolean(myLast());
  return <div className={`wb ${open ? '' : 'wb-hidden'}`} aria-hidden={!open}>
    <div className="wb-tools" role="toolbar" aria-label="Whiteboard tools">
      {COLORS.map((c) => <button key={c} className={`wb-swatch ${!tool.erase && tool.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setTool((t) => ({ ...t, color: c, erase: false }))} aria-label={`Pen colour ${c}`} title="Pen"/>)}
      <span className="wb-sep"/>
      <button className={`wb-tool ${!tool.erase && tool.size === 'thin' ? 'on' : ''}`} onClick={() => setTool((t) => ({ ...t, size: 'thin', erase: false }))} title="Thin pen"><PenLine size={16}/>Thin</button>
      <button className={`wb-tool ${!tool.erase && tool.size === 'thick' ? 'on' : ''}`} onClick={() => setTool((t) => ({ ...t, size: 'thick', erase: false }))} title="Thick pen"><PenLine size={19}/>Thick</button>
      <button className={`wb-tool ${tool.erase ? 'on' : ''}`} onClick={() => setTool((t) => ({ ...t, erase: true }))} title="Eraser"><Eraser size={17}/>Eraser</button>
      <button className="wb-tool" onClick={undo} disabled={!canUndo} title="Undo your last line"><Undo2 size={17}/>Undo</button>
      <button className={`wb-tool ${grid.current ? 'on' : ''}`} onClick={toggleGrid} title="Squared paper, for graphs and geometry (for both)" aria-pressed={grid.current}><Grid3x3 size={17}/>Grid</button>
      {role === 'teacher' && <button className="wb-tool" onClick={clear} title="Clear the drawing for both"><Trash2 size={17}/>Clear</button>}
      {role === 'teacher' && bg.current && <button className="wb-tool" onClick={removePicture} title="Remove the picture behind the drawing"><ImageOff size={17}/>Picture</button>}
      <button className="wb-tool" onClick={save} title="Save the board as a picture"><Download size={17}/>Save</button>
      <span className="wb-spacer"/>
      <span className="wb-hint">{peerName} sees this board live</span>
      <button className="wb-tool" onClick={() => onOpenChange(false, true)} title="Close the whiteboard for both"><X size={17}/>Close</button>
    </div>
    <div className="wb-area">
      <div className="wb-paper" ref={wrap}>
        <canvas ref={bgCanvas} className="wb-canvas"/>
        <canvas ref={inkCanvas} className={`wb-canvas wb-ink ${tool.erase ? 'erasing' : ''}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={(e) => { if (e.pointerType === 'mouse' && e.buttons === 0) up(); }}/>
      </div>
    </div>
  </div>;
});

export default Whiteboard;
