// Room descriptors: scene art + exits + interactable hotspots. The engine
// (world.js) is generic; everything room-specific lives here.
import { WORLD_W, WORLD_H } from "./world.js";

const FLOOR_Y = 250;

// buildRooms wires hotspot callbacks (open a game / not used for exits).
export function buildRooms({ openChess, openBlackjack, openRoulette }) {
  const lounge = {
    id: "lounge",
    title: "The Lounge",
    channel: "room:lounge",
    floorY: FLOOR_Y,
    spawn: { x: WORLD_W / 2, y: 560 },
    drawScene: drawLounge,
    exits: [
      { x: 230, y: 470, dir: "left", label: "High Roller's Room", target: "highroller", r: 150 },
    ],
    hotspots: [
      { x: WORLD_W / 2, y: 470, r: 60, range: 130, onEnter: openChess },
    ],
  };

  const highroller = {
    id: "highroller",
    title: "High Roller's Room",
    channel: "room:highroller",
    floorY: FLOOR_Y,
    spawn: { x: WORLD_W / 2, y: 600 },
    drawScene: drawHighRoller,
    exits: [
      { x: WORLD_W - 170, y: 470, dir: "right", label: "Lounge", target: "lounge", r: 120 },
    ],
    hotspots: [
      { x: 430, y: 480, r: 80, range: 150, onEnter: openBlackjack },
      { x: 880, y: 470, r: 75, range: 150, onEnter: openRoulette },
    ],
  };

  return { lounge, highroller };
}

// ============================ THE LOUNGE ============================
function drawLounge(ctx, t) {
  // wall
  let g = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  g.addColorStop(0, "#3a1f2b"); g.addColorStop(1, "#52303d");
  ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD_W, FLOOR_Y);
  ctx.fillStyle = "rgba(255,210,150,0.04)";
  for (let x = 0; x < WORLD_W; x += 64) ctx.fillRect(x, 0, 32, FLOOR_Y);
  ctx.fillStyle = "#caa45a"; ctx.fillRect(0, FLOOR_Y - 12, WORLD_W, 12);
  ctx.fillStyle = "#8a6a2f"; ctx.fillRect(0, FLOOR_Y - 4, WORLD_W, 4);

  drawWoodFloor(ctx, "#6b4426", "#3f2715");

  // rug
  rug(ctx, WORLD_W / 2, 540, 360, 150, "#5a2230");

  // hearth
  hearth(ctx, WORLD_W / 2, t);

  // portraits + sconces
  portrait(ctx, 330, 70, 120, 130);
  portrait(ctx, WORLD_W - 330, 70, 120, 130);
  sconce(ctx, 170, 150, t); sconce(ctx, WORLD_W - 170, 150, t);

  // chess table
  roundTable(ctx, WORLD_W / 2, 470, 60, "#5b3a1e");
  inlaidBoard(ctx, WORLD_W / 2, 470, 64);
  label(ctx, "♟ Chess — walk up & click", WORLD_W / 2, 470 + 60 * 0.62 + 22);
}

// ====================== HIGH ROLLER'S ROOM ======================
function drawHighRoller(ctx, t) {
  // deep crimson wall with gold paneling
  let g = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  g.addColorStop(0, "#1a0608"); g.addColorStop(1, "#3a0d12");
  ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD_W, FLOOR_Y);
  ctx.strokeStyle = "rgba(202,164,90,0.5)"; ctx.lineWidth = 3;
  for (let x = 80; x < WORLD_W; x += 150) { ctx.strokeRect(x, 24, 110, FLOOR_Y - 70); }
  ctx.fillStyle = "#caa45a"; ctx.fillRect(0, FLOOR_Y - 12, WORLD_W, 12);
  ctx.fillStyle = "#7a5a20"; ctx.fillRect(0, FLOOR_Y - 4, WORLD_W, 4);

  // dark patterned floor
  drawWoodFloor(ctx, "#2a1418", "#160a0c");

  // neon sign
  neonSign(ctx, "HIGH ROLLER'S ROOM", WORLD_W / 2, 70, t);

  // hanging lamps glow over tables
  spotlight(ctx, 430, 480, 260);
  spotlight(ctx, 880, 470, 240);

  // central rug
  rug(ctx, WORLD_W / 2, 560, 420, 150, "#3a0d12");

  // blackjack table (left)
  blackjackTable(ctx, 430, 480);
  label(ctx, "🂡 Blackjack — walk up & click", 430, 560);

  // roulette wheel (right)
  rouletteWheel(ctx, 880, 470, t);
  label(ctx, "Roulette — walk up & click", 880, 560);
}

// ============================ PRIMITIVES ============================
function drawWoodFloor(ctx, c0, c1) {
  const g = ctx.createLinearGradient(0, FLOOR_Y, 0, WORLD_H);
  g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g; ctx.fillRect(0, FLOOR_Y, WORLD_W, WORLD_H - FLOOR_Y);
  ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 2;
  const cxp = WORLD_W / 2;
  for (let i = 0; i <= 14; i++) {
    const x = (WORLD_W / 14) * i;
    ctx.beginPath(); ctx.moveTo(x, WORLD_H); ctx.lineTo(cxp + (x - cxp) * 0.5, FLOOR_Y); ctx.stroke();
  }
  for (let i = 1; i <= 5; i++) {
    const y = FLOOR_Y + (WORLD_H - FLOOR_Y) * (i / 5.2);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
  }
}

function rug(ctx, cx, cy, rx, ry, fill) {
  ellipseFill(ctx, cx, cy, rx, ry, fill);
  ellipseStroke(ctx, cx, cy, rx, ry, "#caa45a", 6);
  ellipseStroke(ctx, cx, cy, rx * 0.78, ry * 0.78, "#caa45a", 3);
  ellipseFill(ctx, cx, cy, rx * 0.2, ry * 0.2, "#caa45a");
}

function hearth(ctx, x, t) {
  const w = 240, h = 200, top = FLOOR_Y - h;
  ctx.fillStyle = "#6e6a63"; rr(ctx, x - w / 2, top, w, h, 8); ctx.fill();
  ctx.fillStyle = "#56524c"; ctx.fillRect(x - w / 2 - 16, top - 18, w + 32, 22);
  const fbW = w - 80, fbH = h - 60, fx = x - fbW / 2, fy = top + 36;
  ctx.fillStyle = "#140d0a"; rr(ctx, fx, fy, fbW, fbH, 6); ctx.fill();
  const flick = 0.75 + Math.sin(t * 9) * 0.12 + Math.sin(t * 17) * 0.06;
  const glow = ctx.createRadialGradient(x, fy + fbH, 6, x, fy + fbH, 130 * flick);
  glow.addColorStop(0, "rgba(255,180,60,0.9)"); glow.addColorStop(0.5, "rgba(255,110,30,0.45)"); glow.addColorStop(1, "rgba(255,90,20,0)");
  ctx.fillStyle = glow; ctx.fillRect(fx - 40, fy - 40, fbW + 80, fbH + 80);
  ctx.fillStyle = "#3a2414"; ctx.fillRect(fx + 14, fy + fbH - 16, fbW - 28, 12);
  for (let i = 0; i < 5; i++) flame(ctx, fx + 18 + i * ((fbW - 36) / 4), fy + fbH - 10, 14, (28 + Math.sin(t * 8 + i) * 10) * flick);
  const cast = ctx.createRadialGradient(x, FLOOR_Y + 10, 10, x, FLOOR_Y + 10, 300);
  cast.addColorStop(0, "rgba(255,150,50,0.18)"); cast.addColorStop(1, "rgba(255,150,50,0)");
  ctx.fillStyle = cast; ctx.fillRect(0, FLOOR_Y, WORLD_W, 260);
}

function flame(ctx, x, baseY, w, h) {
  const g = ctx.createLinearGradient(0, baseY - h, 0, baseY);
  g.addColorStop(0, "#fff2b0"); g.addColorStop(0.4, "#ffd166"); g.addColorStop(1, "#ff6b2c");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x - w, baseY - h * 0.5, x, baseY - h);
  ctx.quadraticCurveTo(x + w, baseY - h * 0.5, x, baseY); ctx.fill();
}

function portrait(ctx, cx, y, w, h) {
  ctx.fillStyle = "#caa45a"; rr(ctx, cx - w / 2 - 8, y - 8, w + 16, h + 16, 6); ctx.fill();
  ctx.fillStyle = "#26323f"; ctx.fillRect(cx - w / 2, y, w, h);
  ctx.fillStyle = "#3b4b5e"; ctx.beginPath(); ctx.arc(cx, y + h * 0.42, w * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - w * 0.26, y + h * 0.6, w * 0.52, h * 0.4);
}

function sconce(ctx, x, y, t) {
  ctx.fillStyle = "#caa45a"; ctx.fillRect(x - 4, y, 8, 40);
  const fl = 0.8 + Math.sin(t * 11 + x) * 0.2;
  const g = ctx.createRadialGradient(x, y, 2, x, y, 60 * fl);
  g.addColorStop(0, "rgba(255,200,90,0.8)"); g.addColorStop(1, "rgba(255,200,90,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 60 * fl, 0, Math.PI * 2); ctx.fill();
  flame(ctx, x, y, 8, 18 * fl);
}

function spotlight(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y - 60, 10, x, y, r);
  g.addColorStop(0, "rgba(255,225,150,0.22)"); g.addColorStop(1, "rgba(255,225,150,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
}

function neonSign(ctx, text, x, y, t) {
  const flick = 0.85 + Math.sin(t * 30) * 0.06 + (Math.sin(t * 7) > 0.96 ? -0.3 : 0);
  ctx.save();
  ctx.font = "800 40px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = `rgba(255,60,90,${flick})`; ctx.shadowBlur = 24;
  ctx.fillStyle = "#ff486e"; ctx.fillText(text, x, y);
  ctx.shadowBlur = 10; ctx.fillStyle = "#ffd1dc"; ctx.fillText(text, x, y);
  ctx.restore(); ctx.textBaseline = "alphabetic";
}

function blackjackTable(ctx, x, y) {
  ellipseFill(ctx, x, y + 34, 110, 24, "rgba(0,0,0,0.4)");
  // half-round felt
  ctx.fillStyle = "#0c5a34";
  ctx.beginPath(); ctx.ellipse(x, y, 120, 78, 0, Math.PI, 0); ctx.fill();
  ctx.fillRect(x - 120, y, 240, 30);
  ctx.strokeStyle = "#caa45a"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(x, y, 120, 78, 0, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = "rgba(255,245,220,0.85)"; ctx.font = "600 16px Georgia, serif"; ctx.textAlign = "center";
  ctx.fillText("BLACKJACK PAYS 3 TO 2", x, y - 28);
  // chips
  chip(ctx, x - 70, y + 8, "#c0392b"); chip(ctx, x - 40, y + 12, "#2c3e50"); chip(ctx, x + 50, y + 10, "#caa45a");
}

function rouletteWheel(ctx, x, y, t) {
  ellipseFill(ctx, x, y + 30, 86, 22, "rgba(0,0,0,0.4)");
  const segs = 18, rot = t * 0.6;
  for (let i = 0; i < segs; i++) {
    const a0 = rot + (i / segs) * Math.PI * 2, a1 = rot + ((i + 1) / segs) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 70, a0, a1); ctx.closePath();
    ctx.fillStyle = i === 0 ? "#0c7a3a" : (i % 2 ? "#c0392b" : "#1c1c1c"); ctx.fill();
  }
  ctx.strokeStyle = "#caa45a"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, 70, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#caa45a"; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
  // ball
  const ba = -rot * 2.3;
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + Math.cos(ba) * 58, y + Math.sin(ba) * 58, 5, 0, Math.PI * 2); ctx.fill();
}

function roundTable(ctx, x, y, r, fill) {
  ellipseFill(ctx, x, y + 30, r + 14, 22, "rgba(0,0,0,0.35)");
  ctx.fillStyle = "#3a2414"; ctx.fillRect(x - 10, y, 20, 34);
  ellipseFill(ctx, x, y, r, r * 0.62, fill);
  ellipseStroke(ctx, x, y, r, r * 0.62, "#caa45a", 3);
}

function inlaidBoard(ctx, x, y, s) {
  const ox = x - s / 2, oy = y - s / 2 + 2;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    ctx.fillStyle = (r + c) % 2 ? "#2c3a52" : "#e6e0cf";
    ctx.fillRect(ox + (c * s) / 8, oy + (r * s) / 8, s / 8, s / 8);
  }
}

function chip(ctx, x, y, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, 13, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, 13, 6, 0, 0, Math.PI * 2); ctx.stroke();
}

function label(ctx, text, x, y) {
  ctx.fillStyle = "rgba(255,245,220,0.92)"; ctx.font = "600 15px Georgia, serif"; ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

function ellipseFill(ctx, x, y, rx, ry, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
function ellipseStroke(ctx, x, y, rx, ry, s, w) { ctx.strokeStyle = s; ctx.lineWidth = w; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
