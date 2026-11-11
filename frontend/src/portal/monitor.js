// Camera & microphone monitoring for tests. Everything runs on the student's device:
// no photo, video or audio ever leaves it. Only text flags are reported, e.g. { kind: 'no_face', seconds: 25 }.
//
// Flags (after a grace period, so a quick glance away is not flagged):
//   no_face         no face visible for 10 s or more
//   multiple_faces  two or more faces for 3 s or more
//   camera_off      camera stopped / disconnected for 5 s or more
//   talking         loud talking for most of 6 seconds (sound level only, nothing recorded)
//   mic_off         microphone stopped / disconnected
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const GRACE = { no_face: 10, multiple_faces: 2, camera_off: 5, talking: 4 }; // a second person must already be steady for 4 s before this grace starts
// Measured with real and fake cameras: a clear face scores ~0.8, smaller faces further back ~0.6-0.66,
// and random patterns can flicker up to ~0.65. Real faces are steady from frame to frame; false ones flicker.
// So a face counts if it is confident twice in a row, or seen in every one of the last 5 checks.
const CONFIDENT = 0.7;
const POSSIBLE = 0.55;

let detectorPromise = null;
/** Loads the face detector (≈11 MB once, then cached by the browser). Safe to call early to preload. */
export function loadDetector() {
  detectorPromise ??= FilesetResolver.forVisionTasks('/mediapipe/wasm')
    .then((vision) => FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/mediapipe/blaze_face_short_range.tflite', delegate: 'CPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    }))
    .catch((error) => { detectorPromise = null; throw error; });
  return detectorPromise;
}

export function cameraErrorMessage(error) {
  const name = error?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera or microphone permission was blocked. Click the camera icon in your browser’s address bar (or your phone’s site settings), allow both, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera or microphone was found on this device. Please use a laptop or phone with a camera.';
  if (name === 'NotReadableError') return 'Your camera is being used by another app (for example Zoom). Close it, then try again.';
  if (/fetch|network|wasm|load|import/i.test(error?.message ?? '')) return 'The camera checker couldn’t download (it’s a one-time 11 MB download). Check your internet connection and try again.';
  return `The camera couldn’t start (${error?.message ?? 'unknown error'}). Please try again or use another device.`;
}

/**
 * Starts monitoring.
 * @param {HTMLVideoElement} video  element that shows the student their own camera
 * @param {(flag: {kind: string, seconds: number}) => void} onFlag
 * @param {(status: {faces: number, warning: string|null, ready: boolean}) => void} onStatus
 */
export async function startMonitor({ video, onFlag, onStatus }) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('This browser cannot use the camera. Please update it or use Chrome.'), { name: 'NotFoundError' });
  let stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const attach = async () => { video.srcObject = stream; video.muted = true; video.playsInline = true; try { await video.play(); } catch { /* autoplay hiccup: next tick retries */ } };
  await attach();
  const detector = await loadDetector();

  // ── Sound level (no recording): RMS of the microphone signal ──
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  let analyser = null;
  const connectMic = () => {
    try {
      const source = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
    } catch { analyser = null; }
  };
  connectMic();
  const samples = new Float32Array(1024);
  let noiseFloor = null; const floorSamples = [];
  let loudTicks = 0, ticks = 0;
  const talkingSeconds = []; // last 6 seconds: true if mostly loud

  const state = { no_face: null, multiple_faces: null, camera_off: null, talking: null }; // start time (ms) while condition holds
  const flagged = { no_face: false, multiple_faces: false, camera_off: false, talking: false };
  let micOffReported = false;
  let pausedUntil = 0;
  let lastFaces = 0;
  const recentOne = []; // last 5 checks: was any possible face seen?
  const recentTwo = []; // last 4 checks: were two or more possible faces seen?
  const recentConfident = []; // last 2 checks: was a confident face seen? (one confident blip is not enough)
  let faceStreak = 0; // consecutive checks with a face: one blip must not end a "no face" period
  const remember = (list, value, size) => { list.push(value); if (list.length > size) list.shift(); return list.filter(Boolean).length; };
  let stopped = false;

  const end = (kind, now) => {
    if (state[kind] !== null && flagged[kind]) onFlag({ kind, seconds: Math.round((now - state[kind]) / 1000) });
    state[kind] = null; flagged[kind] = false;
  };
  const hold = (kind, active, now) => {
    if (active) {
      if (state[kind] === null) state[kind] = now;
      if (!flagged[kind] && now - state[kind] >= GRACE[kind] * 1000) flagged[kind] = true;
    } else end(kind, now);
  };

  const restartIfEnded = async () => {
    const ended = stream.getTracks().some((t) => t.readyState === 'ended');
    if (!ended) return;
    try {
      stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true } });
      await attach(); connectMic(); micOffReported = false;
    } catch { /* stays off: will be flagged */ }
  };

  // Microphone: 10 readings a second, summarised every second.
  const audioTimer = setInterval(() => {
    if (!analyser || stopped) return;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0; for (const s of samples) sum += s * s;
    const rms = Math.sqrt(sum / samples.length);
    if (noiseFloor === null) { floorSamples.push(rms); if (floorSamples.length >= 30) noiseFloor = floorSamples.sort((a, b) => a - b)[15]; return; }
    ticks += 1; if (rms > Math.max(0.04, noiseFloor * 4)) loudTicks += 1;
  }, 100);

  const mainTimer = setInterval(async () => {
    if (stopped) return;
    const now = Date.now();
    if (now < pausedUntil) { Object.keys(state).forEach((k) => { state[k] = null; flagged[k] = false; }); talkingSeconds.length = 0; onStatus({ faces: lastFaces, warning: null, ready: true, paused: true }); return; }
    await restartIfEnded();
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    const cameraOff = !videoTrack || videoTrack.readyState === 'ended' || videoTrack.muted || !videoTrack.enabled;
    hold('camera_off', cameraOff, now);
    if (!cameraOff && video.readyState >= 2) {
      try {
        const scores = detector.detectForVideo(video, performance.now()).detections.map((d) => d.categories?.[0]?.score ?? 0);
        const possible = scores.filter((x) => x >= POSSIBLE).length;
        const steadyOne = remember(recentOne, possible >= 1, 5) === 5;   // seen in every one of the last 5 checks
        const steadyTwo = remember(recentTwo, possible >= 2, 4) === 4;   // two faces in every one of the last 4
        const confidentTwice = remember(recentConfident, scores.some((x) => x >= CONFIDENT), 2) === 2;
        lastFaces = steadyTwo ? possible : (confidentTwice || steadyOne) ? 1 : 0;
      } catch { /* a skipped frame is fine */ }
    } else lastFaces = 0;
    faceStreak = lastFaces > 0 ? faceStreak + 1 : 0;
    hold('no_face', !cameraOff && (lastFaces === 0 || (state.no_face !== null && faceStreak < 2)), now);
    hold('multiple_faces', lastFaces >= 2, now);
    // Talking: a second counts as "talking" if most readings were loud; flag when 4 of the last 6 seconds were.
    if (ticks > 0) { talkingSeconds.push(loudTicks / ticks > 0.4); if (talkingSeconds.length > 6) talkingSeconds.shift(); loudTicks = 0; ticks = 0; }
    const talkingNow = talkingSeconds.filter(Boolean).length >= 4;
    if (talkingNow && state.talking === null) state.talking = now - 4000;
    if (talkingNow && !flagged.talking) flagged.talking = true;
    if (!talkingNow && talkingSeconds.filter(Boolean).length <= 1) end('talking', now);
    if (!micOffReported && (!audioTrack || audioTrack.readyState === 'ended')) { micOffReported = true; onFlag({ kind: 'mic_off', seconds: 0 }); }

    const warning = flagged.camera_off || cameraOff ? 'camera_off' : flagged.multiple_faces ? 'multiple_faces' : (state.no_face !== null && now - state.no_face > 4000) ? 'no_face' : flagged.talking ? 'talking' : null;
    onStatus({ faces: lastFaces, steady: faceStreak >= 2, warning, ready: true, paused: false });
  }, 1000);

  return {
    /** Ignore everything until `ms` from now (e.g. while the photo picker is open). */
    pause(ms) { pausedUntil = Date.now() + ms; },
    resume() { pausedUntil = Date.now() + 1500; },
    stop() {
      if (stopped) return;
      const now = Date.now();
      Object.keys(state).forEach((k) => end(k, now)); // report anything still going on
      stopped = true;
      clearInterval(mainTimer); clearInterval(audioTimer);
      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close().catch(() => {});
      video.srcObject = null;
    },
  };
}
