// Canvas 2D room. Renders the shared room, every player as a colored circle with
// a username label, and a chess table you can walk up to. Click-to-move: click a
// spot to set your target; the render loop interpolates everyone toward their
// targets. Player targets arrive via presence (realtime.js).
import { joinRoom } from "./realtime.js";

const WORLD_W = 960;
const WORLD_H = 540;
const SPEED = 180; // px/sec interpolation toward target
const AVATAR_R = 16;

// Chess table footprint in world coords. Walking near it lets you sit.
const TABLE = { x: WORLD_W / 2, y: 150, r: 46 };
const SIT_RANGE = 90;

const COLORS = ["#ff6b6b", "#4f7cff", "#3ddc84", "#ffd166", "#c77dff", "#ff9f1c", "#2ec4b6", "#e07a5f"];
function colorFor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function startWorld({ canvas, userId, username, onEnterChess }) {
  const ctx = canvas.getContext("2d");
  canvas.width = WORLD_W;
  canvas.height = WORLD_H;

  // id -> { username, color, x, y (rendered), tx, ty (target) }
  const players = new Map();
  const color = colorFor(userId);
  const spawn = { x: WORLD_W / 2 + (Math.abs(hash(userId)) % 200) - 100, y: WORLD_H - 80 };

  const room = joinRoom({
    userId,
    username,
    color,
    spawn,
    onState(list) {
      const seen = new Set();
      for (const p of list) {
        seen.add(p.id);
        const existing = players.get(p.id);
        if (existing) {
          existing.tx = p.x;
          existing.ty = p.y;
          existing.username = p.username;
          existing.color = p.color;
        } else {
          players.set(p.id, { username: p.username, color: p.color, x: p.x, y: p.y, tx: p.x, ty: p.y });
        }
      }
      for (const id of players.keys()) if (!seen.has(id)) players.delete(id);
    },
  });

  function toWorld(evt) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (evt.clientX - rect.left) * sx, y: (evt.clientY - rect.top) * sy };
  }

  function onClick(evt) {
    const { x, y } = toWorld(evt);
    const me = players.get(userId);
    // Clicking the table while standing near it = sit down to play.
    if (dist(x, y, TABLE.x, TABLE.y) < TABLE.r + 10) {
      if (me && dist(me.x, me.y, TABLE.x, TABLE.y) < SIT_RANGE) {
        onEnterChess();
        return;
      }
    }
    const ty = clamp(y, AVATAR_R, WORLD_H - AVATAR_R);
    const tx = clamp(x, AVATAR_R, WORLD_W - AVATAR_R);
    room.move(tx, ty);
  }
  canvas.addEventListener("click", onClick);

  let last = performance.now();
  let raf = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function step(dt) {
    for (const p of players.values()) {
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) { p.x = p.tx; p.y = p.ty; continue; }
      const move = Math.min(d, SPEED * dt);
      p.x += (dx / d) * move;
      p.y += (dy / d) * move;
    }
  }

  function draw() {
    // floor
    ctx.fillStyle = "#0d1830";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    drawGrid();
    drawTable();
    // players sorted by y for simple depth
    const sorted = [...players.values()].sort((a, b) => a.y - b.y);
    for (const p of sorted) drawPlayer(p);
  }

  function drawGrid() {
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_W; x += 48) line(x, 0, x, WORLD_H);
    for (let y = 0; y <= WORLD_H; y += 48) line(0, y, WORLD_W, y);
  }

  function drawTable() {
    ctx.save();
    ctx.translate(TABLE.x, TABLE.y);
    // board
    const s = 64;
    ctx.translate(-s / 2, -s / 2);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = (r + c) % 2 ? "#3a4a6b" : "#cdd6e8";
        ctx.fillRect((c * s) / 4, (r * s) / 4, s / 4, s / 4);
      }
    ctx.restore();
    ctx.fillStyle = "rgba(245,247,251,0.8)";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("♟ Chess — walk up & click", TABLE.x, TABLE.y + 50);
  }

  function drawPlayer(p) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, AVATAR_R, 0, Math.PI * 2);
    ctx.fillStyle = p.color || "#888";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.stroke();
    ctx.fillStyle = "#f5f7fb";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.username || "?", p.x, p.y - AVATAR_R - 4);
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("click", onClick);
      room.leave();
    },
  };
}

function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
