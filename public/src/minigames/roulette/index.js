// Communal roulette overlay. One shared round (roulette_rounds) everyone bets
// into and watches resolve together, synced via Realtime. Server-authoritative:
// bets/RNG/payouts run in RPCs. You place a bet by dragging a chip onto the felt
// betting board; everyone's chips show on the same board.
import { supabase } from "../../supabase.js";
import { drawAnimal } from "../../world.js";
import * as sound from "../../sound.js";

export const meta = { id: "roulette", title: "Roulette", maxPlayers: 8 };

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");
const FILL = { green: "#0c7a3a", red: "#c0392b", black: "#1c1c1c" };
const CHIPS = [{ v: 1, c: "#e9eef2" }, { v: 2, c: "#3a6ea5" }, { v: 5, c: "#c0392b" }, { v: 10, c: "#caa45a" }];

let teardown = null;

export function mount(container, ctx) {
  const uid = ctx.user.id;
  let round = null, bets = [];
  let rot = 0, raf = 0, animatedRoundId = null, spinSent = null, nextScheduled = null;
  let sub = null, ticker = null, selChip = 10, dragEl = null;
  const cellEls = {}; // betType -> element
  const avatarCache = {};

  const wrap = div("casino-wrap roulette-wrap");
  const title = div("casino-title", "🎡 Roulette — Communal Table");
  const cash = div("casino-cash");
  const phase = div("roulette-phase");
  const canvas = document.createElement("canvas");
  canvas.className = "roulette-canvas"; canvas.width = 240; canvas.height = 240;
  const c2 = canvas.getContext("2d");
  const seats = div("rl-seats");
  const board = div("roulette-board");
  const tray = div("chip-tray");
  const msg = div("casino-msg", "Drag a chip onto the board. Max $10.");
  const controls = div("casino-controls");
  const leaveBtn = button("Leave", () => ctx.close?.());
  controls.append(leaveBtn);

  buildBoard();
  buildTray();
  wrap.append(title, cash, phase, seats, canvas, board, tray, msg, controls);
  container.append(wrap);
  setCash(ctx.startCash);
  drawWheel();

  sub = supabase.channel("roulette")
    .on("postgres_changes", { event: "*", schema: "public", table: "roulette_rounds" }, ({ new: r }) => { if (r) onRound(r); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "roulette_bets" }, ({ new: b }) => {
      if (round && b.round_id === round.id && !bets.some((x) => x.id === b.id)) { bets.push(b); renderBets(); renderSeats(); }
    })
    .subscribe();

  (async () => {
    const { data, error } = await supabase.rpc("roulette_current");
    if (error) { msg.textContent = error.message; msg.className = "casino-msg lose"; return; }
    onRound(data); await loadBets();
  })();
  ticker = setInterval(tick, 250);

  // ---------- board + chips ----------
  function buildBoard() {
    board.innerHTML = "";
    const zero = cell("0", "green", "0"); zero.classList.add("rc-zero"); board.append(zero);
    const grid = div("rnums");
    // 3 rows x 12 cols, European order (top row 3,6,...; bottom 1,4,...)
    for (let row = 2; row >= 0; row--) {
      for (let col = 0; col < 12; col++) {
        const n = col * 3 + row + 1;
        grid.append(cell(String(n), colorOf(n), String(n)));
      }
    }
    board.append(grid);
    const outs = div("router-outs");
    for (const [k, lbl, cls] of [["low", "1-18", ""], ["even", "EVEN", ""], ["red", "RED", "red"], ["black", "BLK", "black"], ["odd", "ODD", ""], ["high", "19-36", ""]]) {
      outs.append(cell(k, cls, lbl, true));
    }
    board.append(outs);
  }
  function cell(bet, colorClass, text, wide) {
    const e = document.createElement("div");
    e.className = "rcell" + (colorClass ? " " + colorClass : "") + (wide ? " wide" : "");
    e.dataset.bet = bet; e.textContent = text;
    e.addEventListener("click", () => place(bet, selChip));
    cellEls[bet] = e;
    return e;
  }
  function buildTray() {
    tray.innerHTML = "";
    tray.append(span("Chips: "));
    for (const { v, c } of CHIPS) {
      const ch = document.createElement("button");
      ch.className = "tchip" + (v === selChip ? " sel" : "");
      ch.style.background = c; ch.textContent = "$" + v; ch.dataset.v = v;
      ch.addEventListener("click", () => { selChip = v; buildTray(); });
      ch.addEventListener("pointerdown", (e) => startDrag(e, v, c));
      tray.append(ch);
    }
  }

  function startDrag(e, v, color) {
    e.preventDefault();
    selChip = v; buildTray();
    dragEl = document.createElement("div");
    dragEl.className = "chip-float"; dragEl.style.background = color; dragEl.textContent = "$" + v;
    document.body.append(dragEl);
    moveDrag(e);
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", endDrag, { once: true });
  }
  function moveDrag(e) { if (dragEl) { dragEl.style.left = e.clientX + "px"; dragEl.style.top = e.clientY + "px"; } }
  function endDrag(e) {
    window.removeEventListener("pointermove", moveDrag);
    const v = selChip;
    if (dragEl) { dragEl.remove(); dragEl = null; }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const c = el && el.closest && el.closest(".rcell");
    if (c) place(c.dataset.bet, v);
  }

  async function place(bet, amount) {
    if (!round) return;
    if (round.status !== "betting" || new Date(round.betting_ends_at).getTime() <= Date.now()) {
      msg.textContent = "Betting is closed."; msg.className = "casino-msg lose"; return;
    }
    const { data, error } = await supabase.rpc("roulette_bet", { p_round: round.id, p_bet: bet, p_amount: amount });
    if (error) { msg.textContent = error.message; msg.className = "casino-msg lose"; return; }
    setCash(data.cash); sound.chip();
    msg.textContent = `$${amount} on ${prettyBet(bet)}. Pile 'em on!`; msg.className = "casino-msg";
  }

  // ---------- round flow ----------
  function setCash(c) { if (c != null) { cash.textContent = `Cash: $${c}`; ctx.onCash?.(c); } }
  async function loadBets() {
    if (!round) return;
    const { data } = await supabase.from("roulette_bets").select("*").eq("round_id", round.id);
    bets = data || []; renderBets(); renderSeats();
  }
  async function refreshCash() {
    const { data } = await supabase.from("profiles").select("cash").eq("id", uid).maybeSingle();
    if (data) setCash(data.cash);
  }
  function onRound(r) {
    const isNew = !round || r.id !== round.id;
    round = r;
    if (isNew) { bets = []; hasBet = false; spinSent = null; nextScheduled = null; rot %= Math.PI * 2; drawWheel(); loadBets(); }
    if (r.status === "done" && r.result != null && animatedRoundId !== r.id) { animatedRoundId = r.id; animateTo(r.result); }
    renderPhase();
  }
  function tick() {
    if (!round) return;
    renderPhase();
    if (round.status === "betting") {
      const left = new Date(round.betting_ends_at).getTime() - Date.now();
      if (left <= 0 && spinSent !== round.id) {
        spinSent = round.id;
        supabase.rpc("roulette_spin", { p_round: round.id }).then(({ data }) => { if (data) onRound(data); });
      }
    }
  }
  function renderPhase() {
    if (!round) { phase.textContent = ""; return; }
    if (round.status === "betting") {
      const s = Math.max(0, Math.ceil((new Date(round.betting_ends_at).getTime() - Date.now()) / 1000));
      phase.textContent = `Place your bets — ${s}s`;
    } else if (round.status === "spinning") phase.textContent = "No more bets!";
    else phase.textContent = round.result != null ? `Result: ${colorOf(round.result)} ${round.result}` : "Round over";
  }
  function renderBets() {
    // clear chip markers
    for (const el of Object.values(cellEls)) { const old = el.querySelector(".rchip"); if (old) old.remove(); }
    const byCell = {};
    for (const b of bets) (byCell[b.bet_type] ||= []).push(b);
    for (const [betType, list] of Object.entries(byCell)) {
      const el = cellEls[betType]; if (!el) continue;
      const total = list.reduce((s, b) => s + b.amount, 0);
      const mine = list.some((b) => b.user_id === uid);
      const settled = list[0].won != null;
      const win = list[0].won === true;
      const chip = div("rchip" + (mine ? " mine" : "") + (settled ? (win ? " won" : " lost") : ""), "$" + total);
      el.append(chip);
    }
  }

  // players seated at the table (anyone with a bet this round) + their stake
  async function renderSeats() {
    const map = {};
    for (const b of bets) (map[b.user_id] ||= { name: b.username, total: 0 }).total += b.amount;
    const ids = Object.keys(map);
    const missing = ids.filter((id) => !(id in avatarCache));
    if (missing.length) {
      const { data } = await supabase.from("profiles").select("id, avatar").in("id", missing);
      (data || []).forEach((p) => { avatarCache[p.id] = p.avatar; });
      missing.forEach((id) => { if (!(id in avatarCache)) avatarCache[id] = "dog"; });
    }
    seats.innerHTML = "";
    for (const id of ids) {
      const s = div("rl-seat");
      const cv = document.createElement("canvas"); cv.width = 50; cv.height = 50; cv.className = "rl-seat-av";
      drawAnimal(cv.getContext("2d"), avatarCache[id] || "dog", 25, 24, 13, 1, 0, false);
      s.append(cv, div("rl-seat-name", id === uid ? "You" : map[id].name), div("rl-seat-amt", "$" + map[id].total));
      seats.append(s);
    }
  }

  // ---------- wheel ----------
  function drawWheel(winN, ballAngle = -Math.PI / 2) {
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, R = w / 2 - 6;
    const step = (Math.PI * 2) / ORDER.length;
    c2.clearRect(0, 0, w, h);
    c2.fillStyle = "#caa45a"; c2.beginPath(); c2.arc(cx, cy, R + 5, 0, Math.PI * 2); c2.fill();
    for (let i = 0; i < ORDER.length; i++) {
      const a0 = i * step + rot - Math.PI / 2 - step / 2, a1 = a0 + step;
      c2.beginPath(); c2.moveTo(cx, cy); c2.arc(cx, cy, R, a0, a1); c2.closePath();
      c2.fillStyle = FILL[colorOf(ORDER[i])]; c2.fill();
      const am = (a0 + a1) / 2;
      c2.save(); c2.translate(cx + Math.cos(am) * (R - 13), cy + Math.sin(am) * (R - 13)); c2.rotate(am + Math.PI / 2);
      c2.fillStyle = "#fff"; c2.font = "bold 10px system-ui, sans-serif"; c2.textAlign = "center"; c2.textBaseline = "middle";
      c2.fillText(String(ORDER[i]), 0, 0); c2.restore();
    }
    c2.fillStyle = "#caa45a"; c2.beginPath(); c2.arc(cx, cy, 20, 0, Math.PI * 2); c2.fill();
    c2.fillStyle = "#1b1208"; c2.beginPath(); c2.arc(cx, cy, 15, 0, Math.PI * 2); c2.fill();
    if (winN != null) { c2.fillStyle = "#f3d27a"; c2.font = "bold 17px Georgia, serif"; c2.textAlign = "center"; c2.textBaseline = "middle"; c2.fillText(String(winN), cx, cy); }
    const bx = cx + Math.cos(ballAngle) * (R - 11), by = cy + Math.sin(ballAngle) * (R - 11);
    c2.fillStyle = "rgba(0,0,0,0.3)"; c2.beginPath(); c2.arc(bx + 1, by + 2, 6, 0, Math.PI * 2); c2.fill();
    c2.fillStyle = "#fdfdf5"; c2.beginPath(); c2.arc(bx, by, 6, 0, Math.PI * 2); c2.fill();
    c2.fillStyle = "rgba(255,255,255,0.9)"; c2.beginPath(); c2.arc(bx - 2, by - 2, 2, 0, Math.PI * 2); c2.fill();
    c2.fillStyle = "#f3e8cf"; c2.beginPath(); c2.moveTo(cx, 6); c2.lineTo(cx - 10, -10); c2.lineTo(cx + 10, -10); c2.closePath(); c2.fill();
  }

  function animateTo(result) {
    const idx = ORDER.indexOf(result), step = (Math.PI * 2) / ORDER.length;
    const start = rot;
    const base = ((-idx * step - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const target = start + base + Math.PI * 2 * 9;
    const dur = 7000, t0 = performance.now();
    const ballTurns = Math.PI * 2 * 18;
    cancelAnimationFrame(raf);
    sound.startWheel(dur);
    msg.textContent = "No more bets — spinning…"; msg.className = "casino-msg";
    (function frame(now) {
      const p = Math.min((now - t0) / dur, 1);
      const easeWheel = 1 - Math.pow(1 - p, 4), easeBall = 1 - Math.pow(1 - p, 5);
      rot = start + (target - start) * easeWheel;
      drawWheel(null, -Math.PI / 2 - ballTurns * (1 - easeBall));
      if (p < 1) raf = requestAnimationFrame(frame);
      else { rot %= Math.PI * 2; drawWheel(result, -Math.PI / 2); afterSpin(result); }
    })(t0);
  }

  async function afterSpin(result) {
    sound.stopWheel();
    await loadBets(); await refreshCash();
    const mine = bets.filter((b) => b.user_id === uid);
    if (mine.length) { const w = mine.some((b) => b.won); w ? sound.win() : sound.lose(); }
    const myWin = mine.filter((b) => b.won);
    if (mine.length) { msg.textContent = myWin.length ? `${colorOf(result)} ${result} — you win $${myWin.reduce((s, b) => s + b.payout, 0)}! 🎉` : `${colorOf(result)} ${result} — no luck.`; msg.className = "casino-msg " + (myWin.length ? "win" : "lose"); }
    else { msg.textContent = `${colorOf(result)} ${result}.`; msg.className = "casino-msg"; }
    if (!nextScheduled) nextScheduled = setTimeout(async () => { const { data } = await supabase.rpc("roulette_current"); if (data) onRound(data); }, 5000);
  }

  teardown = () => {
    cancelAnimationFrame(raf); clearInterval(ticker);
    if (nextScheduled) clearTimeout(nextScheduled);
    window.removeEventListener("pointermove", moveDrag);
    if (dragEl) dragEl.remove();
    if (sub) supabase.removeChannel(sub);
    container.innerHTML = "";
  };
}

export function unmount() { if (teardown) teardown(); teardown = null; }

function prettyBet(k) {
  if (/^[0-9]+$/.test(k)) return `#${k}`;
  return { red: "Red", black: "Black", even: "Even", odd: "Odd", low: "1-18", high: "19-36" }[k] || k;
}
function div(cls, text) { const e = document.createElement("div"); e.className = cls; if (text != null) e.textContent = text; return e; }
function span(text) { const e = document.createElement("span"); e.textContent = text; return e; }
function button(label, fn) { const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", fn); return b; }
