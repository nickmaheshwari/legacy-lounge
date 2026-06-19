// Canvas 2D room. You move with WASD/arrow keys OR click-to-move; your avatar is
// an animal (dog/cat/capybara). Your own position is simulated locally for
// snappy input and published to others via presence on a throttle (so WASD
// doesn't flood realtime). Other players are interpolated toward their last
// published position.
import { joinRoom } from "./realtime.js";

const WORLD_W = 960;
const WORLD_H = 540;
const SPEED = 190;        // px/sec
const AVATAR_R = 18;
const PUBLISH_MS = 120;   // cap presence updates to ~8/sec while moving

const TABLE = { x: WORLD_W / 2, y: 150, r: 46 };
const SIT_RANGE = 90;

const KEY_VEC = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

export function startWorld({ canvas, userId, username, avatar = "dog", onEnterChess }) {
  const ctx = canvas.getContext("2d");
  canvas.width = WORLD_W;
  canvas.height = WORLD_H;

  // local, authoritative self
  const me = {
    id: userId, username, avatar,
    x: WORLD_W / 2 + (Math.abs(hash(userId)) % 200) - 100,
    y: WORLD_H - 80,
    target: null,
  };
  // others: id -> { username, avatar, x, y, tx, ty }
  const others = new Map();
  const keys = new Set();

  const room = joinRoom({
    userId, username, avatar,
    color: null,
    spawn: { x: me.x, y: me.y },
    onState(list) {
      const seen = new Set();
      for (const p of list) {
        if (p.id === userId) continue; // self is local
        seen.add(p.id);
        const ex = others.get(p.id);
        if (ex) { ex.tx = p.x; ex.ty = p.y; ex.username = p.username; ex.avatar = p.avatar; }
        else others.set(p.id, { username: p.username, avatar: p.avatar, x: p.x, y: p.y, tx: p.x, ty: p.y });
      }
      for (const id of others.keys()) if (!seen.has(id)) others.delete(id);
      console.log("[presence] players:", list.map((p) => `${p.username}@${Math.round(p.x)},${Math.round(p.y)}`), "others:", others.size);
    },
  });

  // ---------- input ----------
  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (k in KEY_VEC) { keys.add(k); me.target = null; if (k.startsWith("arrow")) e.preventDefault(); }
  }
  function onKeyUp(e) { keys.delete(e.key.toLowerCase()); }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  function toWorld(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (canvas.width / rect.width),
      y: (evt.clientY - rect.top) * (canvas.height / rect.height),
    };
  }
  function onClick(evt) {
    const { x, y } = toWorld(evt);
    if (dist(x, y, TABLE.x, TABLE.y) < TABLE.r + 10 && dist(me.x, me.y, TABLE.x, TABLE.y) < SIT_RANGE) {
      onEnterChess();
      return;
    }
    me.target = { x: clamp(x, AVATAR_R, WORLD_W - AVATAR_R), y: clamp(y, AVATAR_R, WORLD_H - AVATAR_R) };
  }
  canvas.addEventListener("click", onClick);

  // ---------- loop ----------
  let last = performance.now();
  let sincePublish = 0;
  let wasMoving = false;
  let raf = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const moving = step(dt);
    publishMaybe(dt, moving);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function step(dt) {
    let moving = false;

    // keyboard velocity
    let kx = 0, ky = 0;
    for (const k of keys) { const v = KEY_VEC[k]; if (v) { kx += v[0]; ky += v[1]; } }
    if (kx || ky) {
      const len = Math.hypot(kx, ky) || 1;
      me.x = clamp(me.x + (kx / len) * SPEED * dt, AVATAR_R, WORLD_W - AVATAR_R);
      me.y = clamp(me.y + (ky / len) * SPEED * dt, AVATAR_R, WORLD_H - AVATAR_R);
      moving = true;
    } else if (me.target) {
      const dx = me.target.x - me.x, dy = me.target.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) { me.x = me.target.x; me.y = me.target.y; me.target = null; }
      else { const m = Math.min(d, SPEED * dt); me.x += (dx / d) * m; me.y += (dy / d) * m; moving = true; }
    }

    // interpolate others
    for (const p of others.values()) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      if (d < 1) { p.x = p.tx; p.y = p.ty; continue; }
      const m = Math.min(d, SPEED * dt);
      p.x += (dx / d) * m; p.y += (dy / d) * m;
    }
    return moving;
  }

  function publishMaybe(dt, moving) {
    sincePublish += dt * 1000;
    if (moving && sincePublish >= PUBLISH_MS) {
      room.move(Math.round(me.x), Math.round(me.y));
      sincePublish = 0;
    } else if (!moving && wasMoving) {
      // send final resting position so others land exactly where we stopped
      room.move(Math.round(me.x), Math.round(me.y));
      sincePublish = 0;
    }
    wasMoving = moving;
  }

  // ---------- render ----------
  function draw() {
    ctx.fillStyle = "#0d1830";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    drawGrid();
    drawTable();
    const all = [...others.values(), me].sort((a, b) => a.y - b.y);
    for (const p of all) drawAvatar(p);
    drawHud();
  }

  function drawHud() {
    const names = [me.username, ...[...others.values()].map((p) => p.username)];
    ctx.fillStyle = "rgba(13,24,48,0.7)";
    ctx.fillRect(8, 8, 190, 18 + names.length * 16);
    ctx.fillStyle = "#9fb3d8";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${names.length} online`, 14, 24);
    names.forEach((n, i) => ctx.fillText("• " + n, 14, 42 + i * 16));
  }

  function drawGrid() {
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke(); }
    for (let y = 0; y <= WORLD_H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke(); }
  }

  function drawTable() {
    const s = 64;
    ctx.save();
    ctx.translate(TABLE.x - s / 2, TABLE.y - s / 2);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = (r + c) % 2 ? "#3a4a6b" : "#cdd6e8";
        ctx.fillRect((c * s) / 4, (r * s) / 4, s / 4, s / 4);
      }
    ctx.restore();
    ctx.fillStyle = "rgba(245,247,251,0.85)";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("♟ Chess — walk up & click", TABLE.x, TABLE.y + 52);
  }

  function drawAvatar(p) {
    drawAnimal(ctx, p.avatar || "dog", p.x, p.y, AVATAR_R);
    ctx.fillStyle = "#f5f7fb";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.username || "?", p.x, p.y - AVATAR_R - 8);
  }

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      room.leave();
    },
  };
}

// ---------- animal sprites (drawn, no assets) ----------
const SKIN = { dog: "#c8854f", cat: "#9aa3b2", capybara: "#a87b54" };
const EAR = { dog: "#a86c3c", cat: "#7e8794", capybara: "#8a6543" };

function drawAnimal(ctx, type, x, y, r) {
  const skin = SKIN[type] || SKIN.dog;
  const ear = EAR[type] || EAR.dog;

  // ears (behind head)
  ctx.fillStyle = ear;
  if (type === "cat") {
    triangle(ctx, x - r * 0.6, y - r * 0.5, x - r * 0.1, y - r * 1.3, x - r * 0.05, y - r * 0.6);
    triangle(ctx, x + r * 0.6, y - r * 0.5, x + r * 0.1, y - r * 1.3, x + r * 0.05, y - r * 0.6);
  } else if (type === "dog") {
    ellipse(ctx, x - r * 0.85, y - r * 0.1, r * 0.35, r * 0.6);
    ellipse(ctx, x + r * 0.85, y - r * 0.1, r * 0.35, r * 0.6);
  } else { // capybara: small rounded ears on top
    circle(ctx, x - r * 0.55, y - r * 0.8, r * 0.22);
    circle(ctx, x + r * 0.55, y - r * 0.8, r * 0.22);
  }

  // head
  ctx.fillStyle = skin;
  circle(ctx, x, y, r);

  // muzzle (capybara: blocky; others: small)
  ctx.fillStyle = shade(skin, -18);
  if (type === "capybara") roundRect(ctx, x - r * 0.45, y + r * 0.15, r * 0.9, r * 0.6, 4);
  else ellipse(ctx, x, y + r * 0.35, r * 0.45, r * 0.35);

  // eyes
  ctx.fillStyle = "#1b2230";
  circle(ctx, x - r * 0.35, y - r * 0.1, r * 0.13);
  circle(ctx, x + r * 0.35, y - r * 0.1, r * 0.13);

  // nose
  ctx.fillStyle = "#1b2230";
  circle(ctx, x, y + (type === "capybara" ? r * 0.3 : r * 0.25), r * 0.1);

  // cat whiskers
  if (type === "cat") {
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    seg(ctx, x - r * 0.2, y + r * 0.3, x - r * 0.9, y + r * 0.2);
    seg(ctx, x - r * 0.2, y + r * 0.35, x - r * 0.9, y + r * 0.45);
    seg(ctx, x + r * 0.2, y + r * 0.3, x + r * 0.9, y + r * 0.2);
    seg(ctx, x + r * 0.2, y + r * 0.35, x + r * 0.9, y + r * 0.45);
  }
}

function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function ellipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
function triangle(ctx, ax, ay, bx, by, cx, cy) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill(); }
function roundRect(ctx, x, y, w, h, rad) { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); ctx.fill(); }
function seg(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
