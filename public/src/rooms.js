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
      { x: 500, y: 480, r: 60, range: 140, onEnter: () => openChess("lounge-1") },
      { x: 820, y: 480, r: 60, range: 140, onEnter: () => openChess("lounge-2") },
    ],
    obstacles: [
      { x: 500, y: 482, rx: 72, ry: 40 },
      { x: 820, y: 482, rx: 72, ry: 40 },
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
      { x: 430, y: 470, r: 110, range: 175, onEnter: openBlackjack },
      { x: 880, y: 462, r: 95, range: 165, onEnter: openRoulette },
    ],
    obstacles: [
      { x: 430, y: 478, rx: 128, ry: 52 },
      { x: 880, y: 470, rx: 100, ry: 50 },
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
  rug(ctx, WORLD_W / 2, 545, 320, 130, "#5a2230");

  // hearth
  hearth(ctx, WORLD_W / 2, t);

  // windows (only one has the moon) + portraits + sconces
  windowPane(ctx, 215, 60, 120, 150, true);
  windowPane(ctx, WORLD_W - 215, 60, 120, 150, false);
  portrait(ctx, 410, 70, 110, 120);
  portrait(ctx, WORLD_W - 410, 70, 110, 120);
  sconce(ctx, 120, 150, t); sconce(ctx, WORLD_W - 120, 150, t);

  // two chess tables, each with chairs
  for (const [x, name] of [[500, "Chess I"], [820, "Chess II"]]) {
    chair(ctx, x, 432, 0.85);                          // far chair (behind table)
    furnitureTable(ctx, x, 482, 66, 40, "#5b3a1e");
    inlaidBoard(ctx, x, 470, 58);
    chair(ctx, x, 548, 1.0);                           // near chair (in front)
    label(ctx, `♟ ${name} — walk up & click`, x, 524);
  }
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

  // polished casino marble floor
  drawCasinoFloor(ctx);

  // chandeliers over the tables + neon sign
  chandelier(ctx, 430, 120, t);
  chandelier(ctx, 880, 120, t);
  neonSign(ctx, "HIGH ROLLER'S ROOM", WORLD_W / 2, 70, t);

  // hanging lamps glow over tables
  spotlight(ctx, 430, 470, 260);
  spotlight(ctx, 880, 462, 240);

  // ---- blackjack table (left) with chairs ----
  for (const dx of [-78, 0, 78]) chair(ctx, 430 + dx, 552, 0.9); // players' chairs in front
  furnitureTable(ctx, 430, 478, 130, 52, "#0c5a34");
  ctx.fillStyle = "rgba(255,245,220,0.85)"; ctx.font = "600 15px Georgia, serif"; ctx.textAlign = "center";
  ctx.fillText("BLACKJACK PAYS 3 TO 2", 430, 470);
  chip(ctx, 380, 486, "#c0392b"); chip(ctx, 470, 488, "#caa45a");
  label(ctx, "🂡 Blackjack — walk up & click", 430, 556);

  // ---- roulette table (right) with chairs ----
  for (const dx of [-66, 66]) chair(ctx, 880 + dx, 548, 0.9);
  furnitureTable(ctx, 880, 470, 104, 52, "#0c5a34");
  rouletteWheel(ctx, 880, 458, t);
  label(ctx, "Roulette — walk up & click", 880, 552);
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

// A proper table: shadow, legs, apron, oval top with rim + sheen. (rx,ry) = top.
function furnitureTable(ctx, x, y, rx, ry, top) {
  ellipseFill(ctx, x, y + ry * 0.8, rx * 1.02, ry * 0.5, "rgba(0,0,0,0.32)"); // floor shadow
  ctx.fillStyle = "#2a1810";                                                   // front legs
  ctx.fillRect(x - rx * 0.72, y, 10, ry * 1.5);
  ctx.fillRect(x + rx * 0.72 - 10, y, 10, ry * 1.5);
  ctx.fillStyle = shade(top, -42);                                             // apron under the top
  rr(ctx, x - rx, y - ry * 0.15, rx * 2, ry * 0.7, 6); ctx.fill();
  ellipseFill(ctx, x, y - ry * 0.15, rx, ry, top);                            // top
  ellipseStroke(ctx, x, y - ry * 0.15, rx, ry, "#caa45a", 3);
  ellipseFill(ctx, x - rx * 0.32, y - ry * 0.5, rx * 0.42, ry * 0.28, "rgba(255,255,255,0.07)"); // sheen
}

function chair(ctx, x, y, s) {
  ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(x, y + 14 * s, 16 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#6b4426"; rr(ctx, x - 13 * s, y - 30 * s, 26 * s, 28 * s, 6); ctx.fill();  // backrest
  ctx.fillStyle = "#7a4f2a"; rr(ctx, x - 9 * s, y - 26 * s, 18 * s, 20 * s, 4); ctx.fill();
  ctx.fillStyle = "#3a2414"; ctx.fillRect(x - 12 * s, y, 4 * s, 16 * s); ctx.fillRect(x + 8 * s, y, 4 * s, 16 * s); // legs
  ellipseFill(ctx, x, y, 15 * s, 8 * s, "#5b3a1e");                                          // seat
  ellipseStroke(ctx, x, y, 15 * s, 8 * s, "#caa45a", 2);
}

function drawCasinoFloor(ctx) {
  const g = ctx.createLinearGradient(0, FLOOR_Y, 0, WORLD_H);
  g.addColorStop(0, "#2a121a"); g.addColorStop(1, "#120709");
  ctx.fillStyle = g; ctx.fillRect(0, FLOOR_Y, WORLD_W, WORLD_H - FLOOR_Y);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, FLOOR_Y, WORLD_W, WORLD_H - FLOOR_Y); ctx.clip();
  const s = 76;
  ctx.strokeStyle = "rgba(202,164,90,0.13)"; ctx.lineWidth = 1;
  for (let row = 0, y = FLOOR_Y; y < WORLD_H + s; y += s / 2, row++) {
    for (let x = (row % 2 ? s / 2 : 0); x < WORLD_W + s; x += s) {
      ctx.beginPath();
      ctx.moveTo(x, y - s / 2); ctx.lineTo(x + s / 2, y); ctx.lineTo(x, y + s / 2); ctx.lineTo(x - s / 2, y); ctx.closePath();
      ctx.fillStyle = ((x / s + row) % 2 === 0) ? "rgba(0,0,0,0.28)" : "rgba(140,24,36,0.12)";
      ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
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

function windowPane(ctx, cx, top, w, h, moon = true) {
  const x = cx - w / 2;
  // arched night-sky glass
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, top + h); ctx.lineTo(x, top + w / 2);
  ctx.arc(cx, top + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w, top + h); ctx.closePath();
  ctx.clip();
  const sky = ctx.createLinearGradient(0, top, 0, top + h);
  sky.addColorStop(0, "#0b1233"); sky.addColorStop(1, "#1b2a55");
  ctx.fillStyle = sky; ctx.fillRect(x, top, w, h);
  if (moon) {
    ctx.fillStyle = "rgba(245,240,210,0.25)"; ctx.beginPath(); ctx.arc(cx + w * 0.22, top + h * 0.32, w * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f5f0d2"; ctx.beginPath(); ctx.arc(cx + w * 0.22, top + h * 0.32, w * 0.16, 0, Math.PI * 2); ctx.fill();
  }
  // stars (a few extra when there's no moon)
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  const stars = moon ? [[0.2, 0.25], [0.4, 0.5], [0.7, 0.6], [0.3, 0.7], [0.6, 0.3]]
    : [[0.2, 0.25], [0.4, 0.5], [0.7, 0.4], [0.3, 0.7], [0.6, 0.3], [0.8, 0.7], [0.5, 0.18], [0.15, 0.55]];
  for (const [sx, sy] of stars) ctx.fillRect(x + w * sx, top + h * sy, 2, 2);
  ctx.restore();
  // gold frame + mullions
  ctx.strokeStyle = "#caa45a"; ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x, top + h); ctx.lineTo(x, top + w / 2);
  ctx.arc(cx, top + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w, top + h); ctx.closePath(); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, top + h); ctx.moveTo(x, top + h * 0.55); ctx.lineTo(x + w, top + h * 0.55); ctx.stroke();
}

function chandelier(ctx, x, y, t) {
  ctx.strokeStyle = "#7a5a20"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, y); ctx.stroke();
  ctx.strokeStyle = "#caa45a"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(x, y, 46, 16, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#caa45a"; ctx.beginPath(); ctx.ellipse(x, y, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const cxp = x + (i - 2) * 22;
    ctx.fillStyle = "#caa45a"; ctx.fillRect(cxp - 2, y - 4, 4, 10);
    const fl = 0.8 + Math.sin(t * 10 + i) * 0.2;
    const g = ctx.createRadialGradient(cxp, y - 8, 1, cxp, y - 8, 26 * fl);
    g.addColorStop(0, "rgba(255,210,120,0.85)"); g.addColorStop(1, "rgba(255,210,120,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cxp, y - 8, 26 * fl, 0, Math.PI * 2); ctx.fill();
    flame(ctx, cxp, y - 6, 5, 12 * fl);
  }
}

function ellipseFill(ctx, x, y, rx, ry, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
function ellipseStroke(ctx, x, y, rx, ry, s, w) { ctx.strokeStyle = s; ctx.lineWidth = w; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
