// Roulette overlay (European single-zero). Server picks the number and pays out
// (play_roulette RPC); the client only picks a bet/number and amount (<= $10).
// The wheel animation is cosmetic: it spins and decelerates so the server's
// result lands under the pointer, then we reveal win/loss + updated cash.
import { supabase } from "../../supabase.js";

export const meta = { id: "roulette", title: "Roulette", maxPlayers: 1 };

// European wheel pocket order (clockwise).
const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");
const FILL = { green: "#0c7a3a", red: "#c0392b", black: "#1c1c1c" };

const OUTSIDE = [
  ["red", "Red"], ["black", "Black"], ["even", "Even"],
  ["odd", "Odd"], ["low", "1-18"], ["high", "19-36"],
];

let teardown = null;

export function mount(container, ctx) {
  let amount = 10;
  let betKey = "red";
  let rot = 0;        // current wheel rotation (radians)
  let raf = 0;
  let spinning = false;

  const wrap = div("casino-wrap");
  const title = div("casino-title", "🎡 Roulette");
  const cash = div("casino-cash");
  const canvas = document.createElement("canvas");
  canvas.className = "roulette-canvas";
  canvas.width = 260; canvas.height = 260;
  const msg = div("casino-msg", "Pick a bet, then spin. Max $10.");
  const betGrid = div("bet-grid");
  const numWrap = div("bet-wrap");
  const amtWrap = div("bet-wrap");
  const controls = div("casino-controls");

  OUTSIDE.forEach(([k, lbl]) => {
    const b = button(lbl, () => setBet(k));
    b.dataset.key = k; b.className = "bet-chip " + k;
    betGrid.append(b);
  });

  const numIn = document.createElement("input");
  numIn.type = "number"; numIn.min = "0"; numIn.max = "36"; numIn.placeholder = "0-36";
  numIn.addEventListener("input", () => { if (numIn.value !== "") setBet(String(Math.max(0, Math.min(36, +numIn.value)))); });
  numWrap.append(span("Straight # (35:1): "), numIn);

  const amtSel = document.createElement("input");
  amtSel.type = "range"; amtSel.min = "1"; amtSel.max = "10"; amtSel.value = "10";
  const amtVal = span("$10");
  amtSel.addEventListener("input", () => { amount = +amtSel.value; amtVal.textContent = "$" + amount; });
  amtWrap.append(span("Bet: "), amtSel, amtVal);

  const spinBtn = button("Spin", onSpin);
  const leaveBtn = button("Leave", () => ctx.close?.());
  controls.append(spinBtn, leaveBtn);

  wrap.append(title, cash, canvas, msg, betGrid, numWrap, amtWrap, controls);
  container.append(wrap);
  setCash(ctx.startCash);
  setBet("red");
  drawWheel();

  function setCash(c) { if (c != null) { cash.textContent = `Cash: $${c}`; ctx.onCash?.(c); } }
  function setBet(k) {
    if (spinning) return;
    betKey = k;
    if (!/^[0-9]+$/.test(k)) numIn.value = "";
    [...betGrid.children].forEach((b) => b.classList.toggle("sel", b.dataset.key === k));
    msg.textContent = `Betting on: ${prettyBet(k)}`;
    msg.className = "casino-msg";
  }

  // ---- wheel rendering ----
  const ctx2d = canvas.getContext("2d");
  function drawWheel(winN) {
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, R = w / 2 - 6;
    const step = (Math.PI * 2) / ORDER.length;
    ctx2d.clearRect(0, 0, w, h);
    // rim
    ctx2d.fillStyle = "#caa45a";
    ctx2d.beginPath(); ctx2d.arc(cx, cy, R + 5, 0, Math.PI * 2); ctx2d.fill();
    // pockets
    for (let i = 0; i < ORDER.length; i++) {
      const a0 = i * step + rot - Math.PI / 2 - step / 2;
      const a1 = a0 + step;
      ctx2d.beginPath(); ctx2d.moveTo(cx, cy); ctx2d.arc(cx, cy, R, a0, a1); ctx2d.closePath();
      ctx2d.fillStyle = FILL[colorOf(ORDER[i])];
      ctx2d.fill();
      // number
      const am = (a0 + a1) / 2;
      ctx2d.save();
      ctx2d.translate(cx + Math.cos(am) * (R - 14), cy + Math.sin(am) * (R - 14));
      ctx2d.rotate(am + Math.PI / 2);
      ctx2d.fillStyle = "#fff"; ctx2d.font = "bold 11px system-ui, sans-serif";
      ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
      ctx2d.fillText(String(ORDER[i]), 0, 0);
      ctx2d.restore();
    }
    // hub
    ctx2d.fillStyle = "#caa45a"; ctx2d.beginPath(); ctx2d.arc(cx, cy, 22, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.fillStyle = "#1b1208"; ctx2d.beginPath(); ctx2d.arc(cx, cy, 16, 0, Math.PI * 2); ctx2d.fill();
    if (winN != null) {
      ctx2d.fillStyle = "#f3d27a"; ctx2d.font = "bold 18px Georgia, serif";
      ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
      ctx2d.fillText(String(winN), cx, cy);
    }
    // pointer (fixed at top)
    ctx2d.fillStyle = "#f3e8cf";
    ctx2d.beginPath();
    ctx2d.moveTo(cx, 6); ctx2d.lineTo(cx - 10, -10); ctx2d.lineTo(cx + 10, -10); ctx2d.closePath();
    ctx2d.fill();
  }

  async function onSpin() {
    if (spinning) return;
    spinning = true; spinBtn.disabled = true;
    msg.textContent = "Spinning…"; msg.className = "casino-msg";
    let data;
    try {
      const res = await supabase.rpc("play_roulette", { p_bet: betKey, p_amount: amount });
      if (res.error) throw res.error;
      data = res.data;
    } catch (e) {
      msg.textContent = e.message || String(e); msg.className = "casino-msg lose";
      spinning = false; spinBtn.disabled = false; return;
    }

    const idx = ORDER.indexOf(data.number);
    const step = (Math.PI * 2) / ORDER.length;
    // land pocket idx under the top pointer: rot ≡ -idx*step (mod 2π), plus spins
    const start = rot;
    const base = ((-idx * step - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const target = start + base + Math.PI * 2 * 6; // 6 full turns + alignment
    const dur = 4200;
    const t0 = performance.now();

    function frame(now) {
      const p = Math.min((now - t0) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
      rot = start + (target - start) * ease;
      drawWheel();
      if (p < 1) { raf = requestAnimationFrame(frame); }
      else { rot %= Math.PI * 2; drawWheel(data.number); reveal(data); }
    }
    raf = requestAnimationFrame(frame);
  }

  function reveal(data) {
    spinning = false; spinBtn.disabled = false;
    setCash(data.cash);
    msg.textContent = data.win
      ? `${data.color} ${data.number} — you win $${data.payout}! 🎉`
      : `${data.color} ${data.number} — no luck.`;
    msg.className = "casino-msg " + (data.win ? "win" : "lose");
  }

  teardown = () => { cancelAnimationFrame(raf); container.innerHTML = ""; };
}

export function unmount() { if (teardown) teardown(); teardown = null; }

function prettyBet(k) {
  if (/^[0-9]+$/.test(k)) return `straight #${k}`;
  return { red: "Red", black: "Black", even: "Even", odd: "Odd", low: "1-18", high: "19-36" }[k] || k;
}
function div(cls, text) { const e = document.createElement("div"); e.className = cls; if (text != null) e.textContent = text; return e; }
function span(text) { const e = document.createElement("span"); e.textContent = text; return e; }
function button(label, fn) { const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", fn); return b; }
