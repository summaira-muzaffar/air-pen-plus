import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const $ = (s) => document.querySelector(s);
const video = $("#cam"), core = $("#core"), glow = $("#glow"), cursor = $("#cursor"),
      target = $("#target"), statusEl = $("#status"), help = $("#help"), perf = $("#perf");
const cctx = core.getContext("2d"), gctx = glow.getContext("2d");

// ---- settings you can tweak ----
const COLORS = ["#39ff88", "#2ee6ff", "#ff4fd8", "#ffd23f", "#ffffff", "#ff6a3d"];
const GLOW_SCALE = 0.25;               // glow layer resolution (1/4 = fast)
const PINCH_ON = 0.30, PINCH_OFF = 0.45; // pinch ratio with hysteresis (no flicker)
const MIN_STEP = 0.0015;               // skip points closer than this (fewer points = faster)
const LOST_MS = 250, DWELL_MS = 1000;
const CORNERS = [[.1, .1], [.9, .1], [.9, .9], [.1, .9]];

// ---- state ----
let strokes = [], lastCleared = null, cur = null;
let colorIdx = 0, size = 6, shift = false, mirror = true;
let W = 0, sh = 0, dpr = 1, lastSeen = 0, pinch = false, lastRaw = null, calib = null;
let hom = null;
try { hom = JSON.parse(localStorage.getItem("airpen.hom")); } catch {}

// ---- One Euro filter: smooth when slow, responsive when fast ----
class OneEuro {
  constructor(minCutoff = 1.5, beta = 8, dCutoff = 1) { Object.assign(this, { minCutoff, beta, dCutoff, t: null, x: 0, dx: 0 }); }
  a(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  f(x, t) {
    if (this.t === null) { this.t = t; this.x = x; return x; }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.dx += this.a(this.dCutoff, dt) * ((x - this.x) / dt - this.dx);
    this.x += this.a(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (x - this.x);
    this.t = t; return this.x;
  }
  reset() { this.t = null; }
}
const fx = new OneEuro(), fy = new OneEuro();

// ---- projector calibration: 4 points -> homography ----
function solveHomography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-10) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((row, i) => row[8] / row[i]);
}
const applyH = (h, x, y) => { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
const clamp = (v) => Math.min(1, Math.max(0, v));
function toScreen(x, y) {
  if (hom) { const [u, v] = applyH(hom, x, y); return [clamp(u), clamp(v)]; }
  return [clamp(((mirror ? 1 - x : x) - .1) / .8), clamp((y - .1) / .8)];
}

// ---- drawing (incremental: only the newest piece is painted) ----
function setup() {
  W = innerWidth; sh = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
  core.width = W * dpr; core.height = sh * dpr;
  glow.width = Math.max(1, Math.round(W * GLOW_SCALE)); glow.height = Math.max(1, Math.round(sh * GLOW_SCALE));
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0); gctx.setTransform(GLOW_SCALE, 0, 0, GLOW_SCALE, 0, 0);
  for (const c of [cctx, gctx]) { c.lineCap = "round"; c.lineJoin = "round"; }
  redraw();
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function paint(s, build) {
  const w = s.w * sh / 1000;
  build(gctx); gctx.strokeStyle = s.c; gctx.lineWidth = w * 3.2; gctx.stroke();
  build(cctx); cctx.strokeStyle = s.c; cctx.lineWidth = w; cctx.stroke();
  cctx.strokeStyle = "#fff"; cctx.lineWidth = w * .35; cctx.stroke();   // hot white core
}
function piece(s, i) {
  const P = s.pts, p0 = P[i - 1], a = i >= 2 ? mid(P[i - 2], p0) : p0, b = mid(p0, P[i]);
  paint(s, (c) => { c.beginPath(); c.moveTo(a[0] * W, a[1] * sh); c.quadraticCurveTo(p0[0] * W, p0[1] * sh, b[0] * W, b[1] * sh); });
}
function finish(s) {
  const P = s.pts, n = P.length, last = P[n - 1];
  const from = n === 1 ? [last[0] + 1e-4, last[1]] : mid(P[n - 2], last);
  paint(s, (c) => { c.beginPath(); c.moveTo(from[0] * W, from[1] * sh); c.lineTo(last[0] * W, last[1] * sh); });
}
function redraw() {
  cctx.clearRect(0, 0, W, sh); gctx.clearRect(0, 0, W, sh);
  for (const s of strokes) { for (let i = 1; i < s.pts.length; i++) piece(s, i); if (s !== cur) finish(s); }
}
function addPoint(u, v) {
  if (!cur) { cur = { c: COLORS[colorIdx], w: size, pts: [[u, v]] }; strokes.push(cur); return; }
  const l = cur.pts[cur.pts.length - 1];
  if (Math.hypot(u - l[0], v - l[1]) < MIN_STEP) return;
  cur.pts.push([u, v]); piece(cur, cur.pts.length - 1);
}
function endStroke() { if (cur) { finish(cur); cur = null; } }

// ---- hand tracking ----
function loseHand() { endStroke(); pinch = false; fx.reset(); fy.reset(); cursor.classList.remove("on", "draw"); if (calib) calib.anchor = null; }

function onResult(res, t) {
  const lm = res.landmarks && res.landmarks[0];
  if (!lm) { if (t - lastSeen > LOST_MS) loseHand(); return; }
  lastSeen = t;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const ratio = d(lm[4], lm[8]) / (d(lm[0], lm[9]) || 1e-3);   // pinch size relative to hand size
  if (!pinch && ratio < PINCH_ON) pinch = true; else if (pinch && ratio > PINCH_OFF) pinch = false;
  // ONE pointer for drawing AND calibration: the pinch point (midpoint of thumb tip and index tip)
  const rx = (lm[4].x + lm[8].x) / 2, ry = (lm[4].y + lm[8].y) / 2;
  const x = fx.f(rx, t), y = fy.f(ry, t);
  lastRaw = [x, y];
  if (calib) return calibStep(x, y, t);
  const [u, v] = toScreen(x, y), drawing = pinch || shift;
  cursor.style.transform = `translate3d(${u * W}px,${v * sh}px,0)`;
  cursor.classList.add("on"); cursor.classList.toggle("draw", drawing);
  if (drawing) addPoint(u, v); else endStroke();
}

// ---- calibration flow ----
function showTarget() {
  const [u, v] = CORNERS[calib.i];
  Object.assign(target.style, { left: u * 100 + "%", top: v * 100 + "%" });
  target.style.setProperty("--p", 0); target.classList.add("on");
  say(`Calibrating ${calib.i + 1}/4: pinch and hold the pinch point on the dot on the wall (or press Enter)`, 0);
}
function startCalib() { endStroke(); calib = { i: 0, pts: [], anchor: null, since: 0, lock: null }; cursor.classList.remove("on", "draw"); showTarget(); }
function capture(x, y) {
  calib.pts.push([x, y]); calib.i++; calib.anchor = null; calib.lock = [x, y];
  if (calib.i < 4) return showTarget();
  const h = solveHomography(calib.pts, CORNERS);
  target.classList.remove("on"); calib = null;
  if (!h || h.some((n) => !isFinite(n))) return say("Calibration failed. Press K to try again.");
  hom = h; try { localStorage.setItem("airpen.hom", JSON.stringify(h)); } catch {}
  say("Calibrated. Your finger now lands where it touches the wall.");
}
function calibStep(x, y, t) {
  const c = calib;
  if (!pinch) { c.anchor = null; target.style.setProperty("--p", 0); return; }   // dwell only counts while pinching
  if (c.lock) { if (Math.hypot(x - c.lock[0], y - c.lock[1]) < .08) return; c.lock = null; }  // move to the next dot first
  if (!c.anchor || Math.hypot(x - c.anchor[0], y - c.anchor[1]) > .012) { c.anchor = [x, y]; c.since = t; }
  const p = (t - c.since) / DWELL_MS;
  target.style.setProperty("--p", Math.min(p, 1));
  if (p >= 1) capture(x, y);
}

// ---- UI helpers ----
let statusTimer;
function say(msg, ms = 3500) {
  statusEl.textContent = msg; statusEl.classList.remove("fade"); clearTimeout(statusTimer);
  if (ms) statusTimer = setTimeout(() => statusEl.classList.add("fade"), ms);
}
function setColor() { cursor.style.setProperty("--c", COLORS[colorIdx]); }

addEventListener("keydown", (e) => {
  const k = e.key;
  if (k === "Shift") shift = true;
  else if (k === " ") { e.preventDefault(); endStroke(); if (strokes.length) { lastCleared = strokes; strokes = []; redraw(); } }
  else if (k === "Enter" && calib && lastRaw) capture(...lastRaw);
  else if (k === "Escape" && calib) { calib = null; target.classList.remove("on"); say("Calibration cancelled."); }
  else if (/^z$/i.test(k)) { endStroke(); if (strokes.length) strokes.pop(); else if (lastCleared) { strokes = lastCleared; lastCleared = null; } redraw(); }
  else if (/^c$/i.test(k)) { colorIdx = (colorIdx + 1) % COLORS.length; setColor(); }
  else if (k === "[") size = Math.max(2, size - 1);
  else if (k === "]") size = Math.min(30, size + 1);
  else if (/^k$/i.test(k)) startCalib();
  else if (/^r$/i.test(k)) { hom = null; localStorage.removeItem("airpen.hom"); say("Calibration reset."); }
  else if (/^m$/i.test(k)) { mirror = !mirror; say(mirror ? "Mirror on" : "Mirror off"); }
  else if (/^v$/i.test(k)) video.classList.toggle("off");
  else if (/^h$/i.test(k)) help.classList.toggle("fade");
  else if (/^p$/i.test(k)) perf.classList.toggle("fade");
  else if (/^f$/i.test(k)) document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});
addEventListener("keyup", (e) => { if (e.key === "Shift") shift = false; });
addEventListener("blur", () => { shift = false; });
addEventListener("resize", () => requestAnimationFrame(setup));

// ---- boot ----
async function start() {
  setup(); setColor();
  try {
    const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate },
      runningMode: "VIDEO", numHands: 1,
    });
    let landmarker;
    try { landmarker = await HandLandmarker.createFromOptions(fileset, opts("GPU")); }
    catch { landmarker = await HandLandmarker.createFromOptions(fileset, opts("CPU")); }

    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } });
    await video.play();
    say(hom ? "Ready. Pinch to draw. Press K to recalibrate." : "Ready. Pinch to draw. Press K to calibrate for a projector.");

    // detect only when the camera delivers a NEW frame (not on every screen refresh)
    const next = video.requestVideoFrameCallback ? (f) => video.requestVideoFrameCallback(f) : (f) => requestAnimationFrame(f);
    let frames = 0, detMs = 0, drawMs = 0, since = performance.now();
    const tick = () => {
      if (!document.hidden) {
        const t0 = performance.now(), res = landmarker.detectForVideo(video, t0), t1 = performance.now();
        onResult(res, t0);
        const t2 = performance.now();
        frames++; detMs += t1 - t0; drawMs += t2 - t1;
        if (t2 - since >= 1000) {
          perf.textContent = `${frames} fps | detect ${(detMs / frames).toFixed(1)} ms | draw ${(drawMs / frames).toFixed(2)} ms`;
          frames = 0; detMs = 0; drawMs = 0; since = t2;
        }
      }
      next(tick);
    };
    next(tick);
  } catch (err) { say("Could not start: " + err.message, 0); }
}
start();