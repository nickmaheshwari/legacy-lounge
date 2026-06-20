// Synthesized sound effects via the Web Audio API — no audio files needed.
// All effects are generated from oscillators + filtered noise. Muted state
// persists in localStorage. The AudioContext is created lazily and resumed on
// the first user gesture (browsers block audio before interaction).

let ctx = null, master = null;
let muted = localStorage.getItem("ll_muted") === "1";
let fire = null, wheelOn = false, wheelSrc = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  return ctx;
}
function resume() { if (ctx && ctx.state === "suspended") ctx.resume(); }
// unlock on first interaction
const unlock = () => { ac(); resume(); };
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m; localStorage.setItem("ll_muted", m ? "1" : "0");
  if (master) master.gain.value = m ? 0 : 0.5;
  if (m) stopFire();
}

function noiseBuffer(dur) {
  const c = ac(), b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function blip(freq, dur, type = "sine", vol = 0.3, slideTo) {
  if (muted) return; const c = ac(); resume();
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
  o.connect(g).connect(master); o.start(); o.stop(c.currentTime + dur);
}
function burst(dur, filterFreq, vol, type = "lowpass") {
  if (muted) return; const c = ac(); resume();
  const src = c.createBufferSource(); src.buffer = noiseBuffer(dur);
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
  const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
  src.connect(f).connect(g).connect(master); src.start(); src.stop(c.currentTime + dur);
}

// ---- one-shot effects ----
export function chessMove() { blip(190, 0.09, "triangle", 0.32, 95); burst(0.045, 2200, 0.16); }
export function cardFlip() { burst(0.06, 6500, 0.22, "highpass"); blip(760, 0.05, "square", 0.05, 380); }
export function chip() { blip(1300, 0.05, "square", 0.12, 700); setTimeout(() => blip(950, 0.04, "square", 0.08, 520), 35); }
export function click() { blip(620, 0.03, "square", 0.07); }
export function win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.2, "triangle", 0.24), i * 95)); }
export function lose() { [420, 320, 232].forEach((f, i) => setTimeout(() => blip(f, 0.22, "sawtooth", 0.18), i * 120)); }

// ---- fire ambience (lounge) ----
export function startFire() {
  if (muted || fire) return; const c = ac(); resume();
  const src = c.createBufferSource(); src.buffer = noiseBuffer(2); src.loop = true;
  const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 480;
  const g = c.createGain(); g.gain.value = 0.05;
  src.connect(f).connect(g).connect(master); src.start();
  const id = setInterval(() => { if (!muted) burst(0.035, 2800, 0.04 + Math.random() * 0.06); }, 180 + Math.random() * 280);
  fire = { src, id };
}
export function stopFire() { if (!fire) return; clearInterval(fire.id); try { fire.src.stop(); } catch {} fire = null; }

// ---- roulette wheel (whirr + decelerating ticks) ----
export function startWheel(durMs) {
  if (muted) return; const c = ac(); resume(); stopWheel(); wheelOn = true;
  const src = c.createBufferSource(); src.buffer = noiseBuffer(durMs / 1000 + 0.3);
  const f = c.createBiquadFilter(); f.type = "bandpass";
  f.frequency.setValueAtTime(1200, c.currentTime);
  f.frequency.exponentialRampToValueAtTime(280, c.currentTime + durMs / 1000);
  const g = c.createGain(); g.gain.setValueAtTime(0.07, c.currentTime);
  g.gain.linearRampToValueAtTime(0.012, c.currentTime + durMs / 1000);
  src.connect(f).connect(g).connect(master); src.start(); wheelSrc = src;
  const t0 = performance.now();
  (function tick() {
    if (!wheelOn) return;
    blip(2400, 0.015, "square", 0.05, 2000);
    const e = performance.now() - t0;
    if (e < durMs) setTimeout(tick, 35 + (e / durMs) * 230);
  })();
}
export function stopWheel() { wheelOn = false; if (wheelSrc) { try { wheelSrc.stop(); } catch {} wheelSrc = null; } }
