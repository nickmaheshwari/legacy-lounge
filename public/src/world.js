// Canvas 2D engine. Room-agnostic: it handles the camera, movement (WASD +
// click), presence, avatars, and exits/hotspots. The actual scene art and the
// list of exits/hotspots come from a `room` descriptor (see rooms.js).
import { joinRoom } from "./realtime.js";

export const WORLD_W = 1280;
export const WORLD_H = 720;
const SPEED = 230;
const AVATAR_R = 22;
const PUBLISH_MS = 120;

const KEY_VEC = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

export function startWorld({ canvas, userId, username, avatar = "dog", room, onExit }) {
  const ctx = canvas.getContext("2d");
  const floorY = room.floorY ?? 250;
  let dpr = 1, cam = { scale: 1, ox: 0, oy: 0 };

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || 960, ch = canvas.clientHeight || 540;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const scale = Math.min(cw / WORLD_W, ch / WORLD_H);
    cam = { scale, ox: (cw - WORLD_W * scale) / 2, oy: (ch - WORLD_H * scale) / 2 };
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const me = {
    id: userId, username, avatar,
    x: room.spawn.x + (Math.abs(hash(userId)) % 120) - 60,
    y: room.spawn.y + (Math.abs(hash(userId + "y")) % 80),
    target: null, moving: false, face: 1,
  };
  const others = new Map();
  const keys = new Set();

  const room0 = room;
  const conn = joinRoom({
    channel: room.channel, userId, username, avatar,
    spawn: { x: me.x, y: me.y },
    // presence: who is here. New players spawn at their presence position;
    // for known players we only refresh identity (live movement comes via onMove).
    onPresence(list) {
      const seen = new Set();
      for (const p of list) {
        if (p.id === userId) continue;
        seen.add(p.id);
        const ex = others.get(p.id);
        if (ex) { ex.username = p.username; ex.avatar = p.avatar; }
        else others.set(p.id, { username: p.username, avatar: p.avatar, x: p.x, y: p.y, tx: p.x, ty: p.y });
      }
      for (const id of others.keys()) if (!seen.has(id)) others.delete(id);
    },
    // broadcast: live position updates.
    onMove(p) {
      const ex = others.get(p.id);
      if (ex) { ex.tx = p.x; ex.ty = p.y; }
      else others.set(p.id, { username: "…", avatar: "dog", x: p.x, y: p.y, tx: p.x, ty: p.y });
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
      x: (evt.clientX - rect.left - cam.ox) / cam.scale,
      y: (evt.clientY - rect.top - cam.oy) / cam.scale,
    };
  }
  function onClick(evt) {
    const { x, y } = toWorld(evt);
    for (const ex of room0.exits || []) {
      if (dist(x, y, ex.x, ex.y) < (ex.r || 46)) { onExit(ex.target); return; }
    }
    for (const h of room0.hotspots || []) {
      if (dist(x, y, h.x, h.y) < (h.r || 60) + 12 && dist(me.x, me.y, h.x, h.y) < (h.range || 120)) {
        h.onEnter(); return;
      }
    }
    me.target = { x: clamp(x, AVATAR_R, WORLD_W - AVATAR_R), y: clamp(y, floorY + 10, WORLD_H - AVATAR_R) };
  }
  canvas.addEventListener("click", onClick);

  // ---------- loop ----------
  let last = performance.now();
  let sincePublish = 0, wasMoving = false, raf = 0, t = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now; t += dt;
    const moving = step(dt);
    publishMaybe(dt, moving);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function step(dt) {
    let moving = false, kx = 0, ky = 0;
    for (const k of keys) { const v = KEY_VEC[k]; if (v) { kx += v[0]; ky += v[1]; } }
    if (kx || ky) {
      const len = Math.hypot(kx, ky) || 1;
      me.x = clamp(me.x + (kx / len) * SPEED * dt, AVATAR_R, WORLD_W - AVATAR_R);
      me.y = clamp(me.y + (ky / len) * SPEED * dt, floorY + 10, WORLD_H - AVATAR_R);
      if (kx) me.face = kx > 0 ? 1 : -1;
      moving = true;
    } else if (me.target) {
      const dx = me.target.x - me.x, dy = me.target.y - me.y, d = Math.hypot(dx, dy);
      if (d < 1) { me.x = me.target.x; me.y = me.target.y; me.target = null; }
      else { const m = Math.min(d, SPEED * dt); me.x += (dx / d) * m; me.y += (dy / d) * m; if (Math.abs(dx) > 0.5) me.face = dx > 0 ? 1 : -1; moving = true; }
    }
    me.moving = moving;
    for (const p of others.values()) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      p.moving = d > 1;
      if (d < 1) { p.x = p.tx; p.y = p.ty; continue; }
      if (Math.abs(dx) > 0.5) p.face = dx > 0 ? 1 : -1;
      const m = Math.min(d, SPEED * dt);
      p.x += (dx / d) * m; p.y += (dy / d) * m;
    }
    return moving;
  }

  function publishMaybe(dt, moving) {
    sincePublish += dt * 1000;
    if ((moving && sincePublish >= PUBLISH_MS) || (!moving && wasMoving)) {
      conn.move(Math.round(me.x), Math.round(me.y));
      sincePublish = 0;
    }
    wasMoving = moving;
  }

  // ---------- render ----------
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0a0705";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(cam.scale, cam.scale);

    room0.drawScene(ctx, t);
    for (const ex of room0.exits || []) drawExit(ex);
    const all = [...others.values(), me].sort((a, b) => a.y - b.y);
    for (const p of all) drawAvatar(p);
    drawHud();
  }

  function drawExit(ex) {
    const pulse = 0.6 + Math.sin(t * 4) * 0.2;
    ctx.save();
    ctx.font = "700 17px Georgia, serif";
    const label = ex.label || "Exit";
    const tw = ctx.measureText(label).width;
    const arrow = ex.dir === "right" ? "→" : "←";
    const w = tw + 60, h = 44, x = ex.x - w / 2, y = ex.y - h / 2;
    ctx.shadowColor = `rgba(243,210,122,${pulse})`;
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(28,18,12,0.85)";
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#caa45a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.stroke();
    ctx.fillStyle = "#f3d27a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const txt = ex.dir === "right" ? `${label}  ${arrow}` : `${arrow}  ${label}`;
    ctx.fillText(txt, ex.x, ex.y);
    ctx.restore();
    ctx.textBaseline = "alphabetic";
  }

  function drawHud() {
    const names = [me.username + " (you)", ...[...others.values()].map((p) => p.username)];
    ctx.font = "14px Georgia, serif";
    const w = 210, h = 16 + names.length * 20 + 8;
    ctx.fillStyle = "rgba(20,12,8,0.6)";
    ctx.beginPath(); ctx.roundRect(16, 16, w, h, 8); ctx.fill();
    ctx.strokeStyle = "rgba(202,164,90,0.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(16, 16, w, h, 8); ctx.stroke();
    ctx.fillStyle = "#e9c87a"; ctx.textAlign = "left";
    ctx.fillText(`${room0.title || "Room"} — ${names.length}`, 28, 38);
    ctx.fillStyle = "#d7c7a8";
    names.forEach((n, i) => ctx.fillText("• " + n, 28, 60 + i * 20));
  }

  function drawAvatar(p) {
    const bob = (p.moving ? Math.sin(t * 12 + (p.x + p.y) * 0.05) * 2.5 : 0);
    const x = p.x, y = p.y + bob;
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + AVATAR_R * 0.9, AVATAR_R * 0.95, AVATAR_R * 0.34, 0, 0, Math.PI * 2); ctx.fill();
    drawAnimal(ctx, p.avatar || "dog", x, y, AVATAR_R, p.face || 1, t, p.moving);
    ctx.font = "600 13px Georgia, serif"; ctx.textAlign = "center";
    const tw = ctx.measureText(p.username || "?").width + 14;
    ctx.fillStyle = "rgba(20,12,8,0.66)";
    ctx.beginPath(); ctx.roundRect(x - tw / 2, y - AVATAR_R - 30, tw, 18, 6); ctx.fill();
    ctx.fillStyle = "#f3e8cf";
    ctx.fillText(p.username || "?", x, y - AVATAR_R - 17);
  }

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      conn.leave();
    },
  };
}

// ---------- animal sprites ----------
const PALETTE = {
  dog: { body: "#c8854f", dark: "#a76a38", belly: "#e6c39a", eye: "#2a1c12", acc: "#7a4a24" },
  cat: { body: "#8d97a8", dark: "#6b7484", belly: "#cdd4df", eye: "#3ddc84", acc: "#4a5260" },
  capybara: { body: "#9c7248", dark: "#7c5934", belly: "#b8945f", eye: "#22160d", acc: "#6a4a2a" },
  penguin: { body: "#2b2f3a", dark: "#1c2029", belly: "#f3f3f5", eye: "#1b2230", acc: "#f4a300" },
  tiger: { body: "#e08a2c", dark: "#1c1208", belly: "#f5e6cf", eye: "#2a1c12", acc: "#c46a16" },
  panda: { body: "#f2f2f0", dark: "#1c1c1c", belly: "#ffffff", eye: "#1b2230", acc: "#1c1c1c" },
};

function drawAnimal(ctx, type, x, y, r, face, t, moving) {
  const c = PALETTE[type] || PALETTE.dog;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(face, 1);

  ctx.fillStyle = c.body;
  ctx.beginPath(); ctx.ellipse(0, r * 0.7, r * 0.78, r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.belly;
  ctx.beginPath(); ctx.ellipse(0, r * 0.85, r * 0.42, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();

  const sw = moving ? Math.sin(t * 12) * 3 : 0;
  ctx.fillStyle = c.dark;
  ctx.fillRect(-r * 0.5 + sw, r * 1.3, r * 0.3, r * 0.4);
  ctx.fillRect(r * 0.2 - sw, r * 1.3, r * 0.3, r * 0.4);

  ctx.strokeStyle = c.dark; ctx.lineWidth = r * 0.28; ctx.lineCap = "round";
  ctx.beginPath();
  if (type === "cat") { ctx.moveTo(-r * 0.6, r * 0.7); ctx.quadraticCurveTo(-r * 1.4, r * 0.2, -r * 1.1, -r * 0.5); }
  else if (type === "dog") { ctx.moveTo(-r * 0.6, r * 0.5); ctx.quadraticCurveTo(-r * 1.2, r * 0.1, -r * 0.9, -r * 0.4); }
  else { ctx.moveTo(-r * 0.6, r * 0.9); ctx.lineTo(-r * 0.85, r * 0.95); }
  ctx.stroke();

  ctx.fillStyle = c.dark;
  if (type === "cat" || type === "tiger") {
    tri(ctx, -r * 0.55, -r * 0.45, -r * 0.15, -r * 1.25, -r * 0.05, -r * 0.55);
    tri(ctx, r * 0.55, -r * 0.45, r * 0.15, -r * 1.25, r * 0.05, -r * 0.55);
  } else if (type === "dog") {
    ctx.beginPath(); ctx.ellipse(-r * 0.78, -r * 0.15, r * 0.3, r * 0.55, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.78, -r * 0.15, r * 0.3, r * 0.55, -0.3, 0, Math.PI * 2); ctx.fill();
  } else if (type === "panda") {
    ctx.beginPath(); ctx.arc(-r * 0.6, -r * 0.78, r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.78, r * 0.3, 0, Math.PI * 2); ctx.fill();
  } else if (type === "penguin") {
    // small head, no protruding ears
  } else {
    ctx.beginPath(); ctx.arc(-r * 0.5, -r * 0.7, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.5, -r * 0.7, r * 0.2, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = c.body;
  ctx.beginPath(); ctx.arc(0, -r * 0.15, r * 0.82, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = c.belly;
  if (type === "capybara") { ctx.beginPath(); ctx.roundRect(-r * 0.5, r * 0.05, r, r * 0.6, 6); ctx.fill(); }
  else if (type === "penguin") { ctx.beginPath(); ctx.ellipse(0, r * 0.1, r * 0.6, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.beginPath(); ctx.ellipse(0, r * 0.18, r * 0.42, r * 0.32, 0, 0, Math.PI * 2); ctx.fill(); }

  // panda eye patches (behind the eyes)
  if (type === "panda") {
    ctx.fillStyle = "#1c1c1c";
    ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.22, r * 0.2, r * 0.27, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.3, -r * 0.22, r * 0.2, r * 0.27, -0.4, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.25, r * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.25, r * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.eye;
  ctx.beginPath(); ctx.arc(-r * 0.27, -r * 0.25, r * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.33, -r * 0.25, r * 0.09, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#241812";
  ctx.beginPath(); ctx.arc(0, r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();

  if (type === "cat") {
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.2;
    for (const dy of [0.12, 0.26]) { seg(ctx, r * 0.15, r * 0.05 + r * dy, r * 0.95, r * dy); seg(ctx, -r * 0.15, r * 0.05 + r * dy, -r * 0.95, r * dy); }
  } else if (type === "dog") {
    if (moving) { ctx.fillStyle = "#e0697a"; ctx.beginPath(); ctx.roundRect(-r * 0.08, r * 0.16, r * 0.16, r * 0.3, 4); ctx.fill(); }
  } else if (type === "tiger") {
    ctx.strokeStyle = c.dark; ctx.lineWidth = r * 0.1; ctx.lineCap = "round";
    seg(ctx, -r * 0.55, -r * 0.5, -r * 0.38, -r * 0.18);
    seg(ctx, 0, -r * 0.72, 0, -r * 0.45);
    seg(ctx, r * 0.55, -r * 0.5, r * 0.38, -r * 0.18);
    seg(ctx, -r * 0.42, r * 0.45, -r * 0.32, r * 0.85);
    seg(ctx, r * 0.42, r * 0.45, r * 0.32, r * 0.85);
  } else if (type === "penguin") {
    ctx.fillStyle = c.acc; // orange beak over the nose
    tri(ctx, -r * 0.14, r * 0.02, r * 0.14, r * 0.02, 0, r * 0.24);
  } else if (type === "capybara") {
    ctx.fillStyle = c.acc; ctx.fillRect(-r * 0.16, r * 0.32, r * 0.32, r * 0.12);
  }
  ctx.restore();
}

function tri(ctx, ax, ay, bx, by, cx, cy) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill(); }
function seg(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
