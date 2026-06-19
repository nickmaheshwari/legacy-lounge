// Canvas 2D lounge. A drawn aristocrat lounge (wood floor, hearth, rug,
// paintings) with animal avatars. Move with WASD/arrows or click-to-move.
// The world is a fixed logical 1280x720 scene; a "contain" camera scales it to
// fill the canvas element crisply (DPR-aware, letterboxed, no stretch).
import { joinRoom } from "./realtime.js";

const WORLD_W = 1280;
const WORLD_H = 720;
const SPEED = 230;        // px/sec
const AVATAR_R = 22;
const PUBLISH_MS = 120;
const FLOOR_Y = 250;      // wall/floor boundary

const TABLE = { x: WORLD_W / 2, y: 470, r: 60 };
const SIT_RANGE = 120;

const KEY_VEC = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

export function startWorld({ canvas, userId, username, avatar = "dog", onEnterChess }) {
  const ctx = canvas.getContext("2d");
  let dpr = 1, cam = { scale: 1, ox: 0, oy: 0 };

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || 960;
    const ch = canvas.clientHeight || 540;
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
    x: WORLD_W / 2 + (Math.abs(hash(userId)) % 300) - 150,
    y: FLOOR_Y + 160 + (Math.abs(hash(userId + "y")) % 120),
    target: null, moving: false, face: 1,
  };
  const others = new Map();
  const keys = new Set();

  const room = joinRoom({
    userId, username, avatar, color: null,
    spawn: { x: me.x, y: me.y },
    onState(list) {
      const seen = new Set();
      for (const p of list) {
        if (p.id === userId) continue;
        seen.add(p.id);
        const ex = others.get(p.id);
        if (ex) { ex.tx = p.x; ex.ty = p.y; ex.username = p.username; ex.avatar = p.avatar; }
        else others.set(p.id, { username: p.username, avatar: p.avatar, x: p.x, y: p.y, tx: p.x, ty: p.y });
      }
      for (const id of others.keys()) if (!seen.has(id)) others.delete(id);
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
    const cssX = evt.clientX - rect.left;
    const cssY = evt.clientY - rect.top;
    return { x: (cssX - cam.ox) / cam.scale, y: (cssY - cam.oy) / cam.scale };
  }
  function onClick(evt) {
    const { x, y } = toWorld(evt);
    if (dist(x, y, TABLE.x, TABLE.y) < TABLE.r + 12 && dist(me.x, me.y, TABLE.x, TABLE.y) < SIT_RANGE) {
      onEnterChess();
      return;
    }
    me.target = {
      x: clamp(x, AVATAR_R, WORLD_W - AVATAR_R),
      y: clamp(y, FLOOR_Y + 10, WORLD_H - AVATAR_R),
    };
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
    let moving = false;
    let kx = 0, ky = 0;
    for (const k of keys) { const v = KEY_VEC[k]; if (v) { kx += v[0]; ky += v[1]; } }
    if (kx || ky) {
      const len = Math.hypot(kx, ky) || 1;
      me.x = clamp(me.x + (kx / len) * SPEED * dt, AVATAR_R, WORLD_W - AVATAR_R);
      me.y = clamp(me.y + (ky / len) * SPEED * dt, FLOOR_Y + 10, WORLD_H - AVATAR_R);
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
      room.move(Math.round(me.x), Math.round(me.y));
      sincePublish = 0;
    }
    wasMoving = moving;
  }

  // ---------- render ----------
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // letterbox backdrop
    ctx.fillStyle = "#0a0705";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(cam.scale, cam.scale);

    drawScene();
    const all = [...others.values(), me].sort((a, b) => a.y - b.y);
    for (const p of all) drawAvatar(p);
    drawHud();
  }

  function drawScene() {
    drawWall();
    drawFloor();
    drawRug();
    drawHearth();
    drawPaintings();
    drawSconce(170, 150); drawSconce(WORLD_W - 170, 150);
    drawTable();
  }

  function drawWall() {
    const g = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    g.addColorStop(0, "#3a1f2b");
    g.addColorStop(1, "#52303d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_W, FLOOR_Y);
    // damask stripes
    ctx.fillStyle = "rgba(255,210,150,0.04)";
    for (let x = 0; x < WORLD_W; x += 64) ctx.fillRect(x, 0, 32, FLOOR_Y);
    // crown molding + baseboard
    ctx.fillStyle = "#caa45a";
    ctx.fillRect(0, FLOOR_Y - 12, WORLD_W, 12);
    ctx.fillStyle = "#8a6a2f";
    ctx.fillRect(0, FLOOR_Y - 4, WORLD_W, 4);
  }

  function drawFloor() {
    const g = ctx.createLinearGradient(0, FLOOR_Y, 0, WORLD_H);
    g.addColorStop(0, "#6b4426");
    g.addColorStop(1, "#3f2715");
    ctx.fillStyle = g;
    ctx.fillRect(0, FLOOR_Y, WORLD_W, WORLD_H - FLOOR_Y);
    // plank seams in perspective
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 14; i++) {
      const x = (WORLD_W / 14) * i;
      const cxp = WORLD_W / 2;
      ctx.beginPath();
      ctx.moveTo(x, WORLD_H);
      ctx.lineTo(cxp + (x - cxp) * 0.5, FLOOR_Y);
      ctx.stroke();
    }
    for (let i = 1; i <= 5; i++) {
      const y = FLOOR_Y + (WORLD_H - FLOOR_Y) * (i / 5.2);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }
  }

  function drawRug() {
    const cx = WORLD_W / 2, cy = 540, rx = 360, ry = 150;
    ctx.save();
    ctx.translate(cx, cy);
    ellipseFill(0, 0, rx, ry, "#5a2230");
    ellipseStroke(0, 0, rx, ry, "#caa45a", 6);
    ellipseStroke(0, 0, rx * 0.78, ry * 0.78, "#caa45a", 3);
    ellipseFill(0, 0, rx * 0.2, ry * 0.2, "#caa45a");
    ctx.restore();
  }

  function drawHearth() {
    const x = WORLD_W / 2, w = 240, h = 200, top = FLOOR_Y - h;
    // stone surround
    ctx.fillStyle = "#6e6a63";
    roundRectPath(x - w / 2, top, w, h, 8); ctx.fill();
    ctx.fillStyle = "#56524c";
    ctx.fillRect(x - w / 2 - 16, top - 18, w + 32, 22); // mantel
    // firebox
    const fbW = w - 80, fbH = h - 60, fx = x - fbW / 2, fy = top + 36;
    ctx.fillStyle = "#140d0a";
    roundRectPath(fx, fy, fbW, fbH, 6); ctx.fill();
    // animated fire
    const flick = 0.75 + Math.sin(t * 9) * 0.12 + Math.sin(t * 17) * 0.06;
    const glow = ctx.createRadialGradient(x, fy + fbH, 6, x, fy + fbH, 130 * flick);
    glow.addColorStop(0, "rgba(255,180,60,0.9)");
    glow.addColorStop(0.5, "rgba(255,110,30,0.45)");
    glow.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(fx - 40, fy - 40, fbW + 80, fbH + 80);
    // logs + flames
    ctx.fillStyle = "#3a2414";
    ctx.fillRect(fx + 14, fy + fbH - 16, fbW - 28, 12);
    for (let i = 0; i < 5; i++) {
      const lx = fx + 18 + i * ((fbW - 36) / 4);
      const fh = (28 + Math.sin(t * 8 + i) * 10) * flick;
      flame(lx, fy + fbH - 10, 14, fh);
    }
    // warm cast on floor
    const cast = ctx.createRadialGradient(x, FLOOR_Y + 10, 10, x, FLOOR_Y + 10, 300);
    cast.addColorStop(0, "rgba(255,150,50,0.18)");
    cast.addColorStop(1, "rgba(255,150,50,0)");
    ctx.fillStyle = cast;
    ctx.fillRect(0, FLOOR_Y, WORLD_W, 260);
  }

  function flame(x, baseY, w, h) {
    const g = ctx.createLinearGradient(0, baseY - h, 0, baseY);
    g.addColorStop(0, "#fff2b0");
    g.addColorStop(0.4, "#ffd166");
    g.addColorStop(1, "#ff6b2c");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(x - w, baseY - h * 0.5, x, baseY - h);
    ctx.quadraticCurveTo(x + w, baseY - h * 0.5, x, baseY);
    ctx.fill();
  }

  function drawPaintings() {
    portrait(330, 70, 120, 130);
    portrait(WORLD_W - 330, 70, 120, 130);
  }
  function portrait(cx, y, w, h) {
    ctx.fillStyle = "#caa45a"; roundRectPath(cx - w / 2 - 8, y - 8, w + 16, h + 16, 6); ctx.fill();
    ctx.fillStyle = "#26323f"; ctx.fillRect(cx - w / 2, y, w, h);
    ctx.fillStyle = "#3b4b5e"; ctx.beginPath(); ctx.arc(cx, y + h * 0.42, w * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(cx - w * 0.26, y + h * 0.6, w * 0.52, h * 0.4);
  }

  function drawSconce(x, y) {
    ctx.fillStyle = "#caa45a";
    ctx.fillRect(x - 4, y, 8, 40);
    const fl = 0.8 + Math.sin(t * 11 + x) * 0.2;
    const g = ctx.createRadialGradient(x, y, 2, x, y, 60 * fl);
    g.addColorStop(0, "rgba(255,200,90,0.8)");
    g.addColorStop(1, "rgba(255,200,90,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 60 * fl, 0, Math.PI * 2); ctx.fill();
    flame(x, y, 8, 18 * fl);
  }

  function drawTable() {
    // shadow
    ellipseFill(TABLE.x, TABLE.y + 30, TABLE.r + 14, 22, "rgba(0,0,0,0.35)");
    // pedestal
    ctx.fillStyle = "#3a2414";
    ctx.fillRect(TABLE.x - 10, TABLE.y, 20, 34);
    // round tabletop
    ellipseFill(TABLE.x, TABLE.y, TABLE.r, TABLE.r * 0.62, "#5b3a1e");
    ellipseStroke(TABLE.x, TABLE.y, TABLE.r, TABLE.r * 0.62, "#caa45a", 3);
    // chessboard inlay
    const s = 64, ox = TABLE.x - s / 2, oy = TABLE.y - s / 2 + 2;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 ? "#2c3a52" : "#e6e0cf";
        ctx.fillRect(ox + (c * s) / 8, oy + (r * s) / 8, s / 8, s / 8);
      }
    ctx.fillStyle = "rgba(255,245,220,0.92)";
    ctx.font = "600 15px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("♟ Chess — walk up & click", TABLE.x, TABLE.y + TABLE.r * 0.62 + 22);
  }

  function drawHud() {
    const names = [me.username + " (you)", ...[...others.values()].map((p) => p.username)];
    ctx.font = "14px Georgia, serif";
    const w = 210, h = 16 + names.length * 20 + 8;
    ctx.fillStyle = "rgba(20,12,8,0.6)";
    roundRectPath(16, 16, w, h, 8); ctx.fill();
    ctx.strokeStyle = "rgba(202,164,90,0.5)"; ctx.lineWidth = 1; roundRectPath(16, 16, w, h, 8); ctx.stroke();
    ctx.fillStyle = "#e9c87a"; ctx.textAlign = "left";
    ctx.fillText(`♛ ${names.length} in the lounge`, 28, 38);
    ctx.fillStyle = "#d7c7a8";
    names.forEach((n, i) => ctx.fillText("• " + n, 28, 60 + i * 20));
  }

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      room.leave();
    },
  };

  // ---------- avatars ----------
  function drawAvatar(p) {
    const bob = (p.moving ? Math.sin(t * 12 + (p.x + p.y) * 0.05) * 2.5 : 0);
    const x = p.x, y = p.y + bob;
    // shadow
    ellipseFill(p.x, p.y + AVATAR_R * 0.9, AVATAR_R * 0.95, AVATAR_R * 0.34, "rgba(0,0,0,0.32)");
    drawAnimal(ctx, p.avatar || "dog", x, y, AVATAR_R, p.face || 1, t, p.moving);
    // nameplate
    ctx.font = "600 13px Georgia, serif";
    ctx.textAlign = "center";
    const tw = ctx.measureText(p.username || "?").width + 14;
    ctx.fillStyle = "rgba(20,12,8,0.66)";
    roundRectPath(x - tw / 2, y - AVATAR_R - 30, tw, 18, 6); ctx.fill();
    ctx.fillStyle = "#f3e8cf";
    ctx.fillText(p.username || "?", x, y - AVATAR_R - 17);
  }

  function ellipseFill(x, y, rx, ry, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  function ellipseStroke(x, y, rx, ry, s, w) { ctx.strokeStyle = s; ctx.lineWidth = w; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
  function roundRectPath(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
}

// ---------- animal sprites ----------
const PALETTE = {
  dog: { body: "#c8854f", dark: "#a76a38", belly: "#e6c39a", eye: "#2a1c12", acc: "#7a4a24" },
  cat: { body: "#8d97a8", dark: "#6b7484", belly: "#cdd4df", eye: "#3ddc84", acc: "#4a5260" },
  capybara: { body: "#9c7248", dark: "#7c5934", belly: "#b8945f", eye: "#22160d", acc: "#6a4a2a" },
};

function drawAnimal(ctx, type, x, y, r, face, t, moving) {
  const c = PALETTE[type] || PALETTE.dog;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(face, 1);

  // body
  ctx.fillStyle = c.body;
  ctx.beginPath(); ctx.ellipse(0, r * 0.7, r * 0.78, r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.belly;
  ctx.beginPath(); ctx.ellipse(0, r * 0.85, r * 0.42, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();

  // legs (little shuffle when moving)
  const sw = moving ? Math.sin(t * 12) * 3 : 0;
  ctx.fillStyle = c.dark;
  ctx.fillRect(-r * 0.5 + sw, r * 1.3, r * 0.3, r * 0.4);
  ctx.fillRect(r * 0.2 - sw, r * 1.3, r * 0.3, r * 0.4);

  // tail
  ctx.strokeStyle = c.dark; ctx.lineWidth = r * 0.28; ctx.lineCap = "round";
  ctx.beginPath();
  if (type === "cat") { ctx.moveTo(-r * 0.6, r * 0.7); ctx.quadraticCurveTo(-r * 1.4, r * 0.2, -r * 1.1, -r * 0.5); }
  else if (type === "dog") { ctx.moveTo(-r * 0.6, r * 0.5); ctx.quadraticCurveTo(-r * 1.2, r * 0.1, -r * 0.9, -r * 0.4); }
  else { ctx.moveTo(-r * 0.6, r * 0.9); ctx.lineTo(-r * 0.85, r * 0.95); }
  ctx.stroke();

  // ears (behind head)
  ctx.fillStyle = c.dark;
  if (type === "cat") {
    tri(ctx, -r * 0.55, -r * 0.45, -r * 0.15, -r * 1.25, -r * 0.05, -r * 0.55);
    tri(ctx, r * 0.55, -r * 0.45, r * 0.15, -r * 1.25, r * 0.05, -r * 0.55);
  } else if (type === "dog") {
    ctx.beginPath(); ctx.ellipse(-r * 0.78, -r * 0.15, r * 0.3, r * 0.55, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.78, -r * 0.15, r * 0.3, r * 0.55, -0.3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(-r * 0.5, -r * 0.7, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.5, -r * 0.7, r * 0.2, 0, Math.PI * 2); ctx.fill();
  }

  // head
  ctx.fillStyle = c.body;
  ctx.beginPath(); ctx.arc(0, -r * 0.15, r * 0.82, 0, Math.PI * 2); ctx.fill();

  // muzzle
  ctx.fillStyle = c.belly;
  if (type === "capybara") { ctx.beginPath(); ctx.roundRect(-r * 0.5, r * 0.05, r, r * 0.6, 6); ctx.fill(); }
  else { ctx.beginPath(); ctx.ellipse(0, r * 0.18, r * 0.42, r * 0.32, 0, 0, Math.PI * 2); ctx.fill(); }

  // eyes
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.25, r * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.25, r * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.eye;
  ctx.beginPath(); ctx.arc(-r * 0.27, -r * 0.25, r * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.33, -r * 0.25, r * 0.09, 0, Math.PI * 2); ctx.fill();

  // nose
  ctx.fillStyle = "#241812";
  ctx.beginPath(); ctx.arc(0, r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();

  // species extras
  if (type === "cat") {
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.2;
    for (const dy of [0.12, 0.26]) { seg(ctx, r * 0.15, r * 0.05 + r * dy, r * 0.95, r * 0.0 + r * dy); seg(ctx, -r * 0.15, r * 0.05 + r * dy, -r * 0.95, r * 0.0 + r * dy); }
  } else if (type === "dog") {
    ctx.fillStyle = "#e0697a"; // tongue
    if (moving) { ctx.beginPath(); ctx.roundRect(-r * 0.08, r * 0.16, r * 0.16, r * 0.3, 4); ctx.fill(); }
  } else {
    ctx.fillStyle = c.acc; // capybara: nostrils block
    ctx.fillRect(-r * 0.16, r * 0.32, r * 0.32, r * 0.12);
  }
  ctx.restore();
}

function tri(ctx, ax, ay, bx, by, cx, cy) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill(); }
function seg(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
