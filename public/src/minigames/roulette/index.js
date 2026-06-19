// Communal roulette overlay. One shared round (roulette_rounds) that everyone
// in the room bets into and watches resolve together — synced via Realtime.
// Server-authoritative: bets/RNG/payouts run in RPCs (20260619000006); the
// client only places a bet (<= $10) and animates the server's result.
import { supabase } from "../../supabase.js";

export const meta = { id: "roulette", title: "Roulette", maxPlayers: 8 };

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");
const FILL = { green: "#0c7a3a", red: "#c0392b", black: "#1c1c1c" };
const OUTSIDE = [["red", "Red"], ["black", "Black"], ["even", "Even"], ["odd", "Odd"], ["low", "1-18"], ["high", "19-36"]];

let teardown = null;

export function mount(container, ctx) {
  const uid = ctx.user.id;
  let amount = 10, betKey = "red";
  let round = null, bets = [], hasBet = false;
  let rot = 0, raf = 0, animatedRoundId = null, spinSent = null, nextScheduled = null;
  let sub = null, ticker = null;

  // ---- DOM ----
  const wrap = div("casino-wrap");
  const title = div("casino-title", "🎡 Roulette — Communal Table");
  const cash = div("casino-cash");
  const phase = div("roulette-phase");
  const canvas = document.createElement("canvas");
  canvas.className = "roulette-canvas"; canvas.width = 260; canvas.height = 260;
  const c2 = canvas.getContext("2d");
  const msg = div("casino-msg", "");
  const betsList = div("bets-list");
  const betGrid = div("bet-grid");
  const numWrap = div("bet-wrap");
  const amtWrap = div("bet-wrap");
  const controls = div("casino-controls");

  OUTSIDE.forEach(([k, lbl]) => { const b = button(lbl, () => setBet(k)); b.dataset.key = k; b.className = "bet-chip " + k; betGrid.append(b); });
  const numIn = document.createElement("input");
  numIn.type = "number"; numIn.min = "0"; numIn.max = "36"; numIn.placeholder = "0-36";
  numIn.addEventListener("input", () => { if (numIn.value !== "") setBet(String(Math.max(0, Math.min(36, +numIn.value)))); });
  numWrap.append(span("Straight # (35:1): "), numIn);
  const amtSel = document.createElement("input");
  amtSel.type = "range"; amtSel.min = "1"; amtSel.max = "10"; amtSel.value = "10";
  const amtVal = span("$10");
  amtSel.addEventListener("input", () => { amount = +amtSel.value; amtVal.textContent = "$" + amount; });
  amtWrap.append(span("Bet: "), amtSel, amtVal);
  const betBtn = button("Place bet", placeBet);
  const leaveBtn = button("Leave", () => ctx.close?.());
  controls.append(betBtn, leaveBtn);

  wrap.append(title, cash, phase, canvas, msg, betsList, betGrid, numWrap, amtWrap, controls);
  container.append(wrap);
  setCash(ctx.startCash);
  setBet("red");
  drawWheel();

  // ---- realtime ----
  sub = supabase.channel("roulette")
    .on("postgres_changes", { event: "*", schema: "public", table: "roulette_rounds" }, ({ new: r }) => { if (r) onRound(r); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "roulette_bets" }, ({ new: b }) => {
      if (round && b.round_id === round.id && !bets.some((x) => x.id === b.id)) { bets.push(b); renderBets(); }
    })
    .subscribe();

  (async () => {
    const { data, error } = await supabase.rpc("roulette_current");
    if (error) { msg.textContent = error.message; msg.className = "casino-msg lose"; return; }
    onRound(data);
    await loadBets();
  })();

  ticker = setInterval(tick, 250);

  // ---- helpers ----
  function setCash(c) { if (c != null) { cash.textContent = `Cash: $${c}`; ctx.onCash?.(c); } }
  function setBet(k) {
    betKey = k;
    if (!/^[0-9]+$/.test(k)) numIn.value = "";
    [...betGrid.children].forEach((b) => b.classList.toggle("sel", b.dataset.key === k));
  }
  async function loadBets() {
    if (!round) return;
    const { data } = await supabase.from("roulette_bets").select("*").eq("round_id", round.id);
    bets = data || []; hasBet = bets.some((b) => b.user_id === uid); renderBets(); updateControls();
  }
  async function refreshCash() {
    const { data } = await supabase.from("profiles").select("cash").eq("id", uid).maybeSingle();
    if (data) setCash(data.cash);
  }

  function onRound(r) {
    const isNew = !round || r.id !== round.id;
    round = r;
    if (isNew) { bets = []; hasBet = false; spinSent = null; nextScheduled = null; rot %= Math.PI * 2; drawWheel(); loadBets(); }
    if (r.status === "done" && r.result != null && animatedRoundId !== r.id) {
      animatedRoundId = r.id;
      animateTo(r.result);
    }
    renderPhase(); updateControls();
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
      phase.textContent = `Betting — ${s}s`;
    } else if (round.status === "spinning") phase.textContent = "Spinning…";
    else phase.textContent = round.result != null ? `Result: ${colorOf(round.result)} ${round.result}` : "Round over";
  }

  function renderBets() {
    betsList.innerHTML = "";
    if (!bets.length) { betsList.append(div("bets-empty", "No bets yet this round.")); return; }
    for (const b of bets.slice().sort((a, c) => a.created_at < c.created_at ? -1 : 1)) {
      const line = div("bets-line " + (b.won === true ? "win" : b.won === false ? "lose" : ""));
      const who = b.user_id === uid ? "You" : b.username;
      let txt = `${who} · ${prettyBet(b.bet_type)} · $${b.amount}`;
      if (b.won === true) txt += `  ✓ +$${b.payout}`;
      else if (b.won === false) txt += "  ✗";
      line.textContent = txt;
      betsList.append(line);
    }
  }

  function updateControls() {
    const canBet = round && round.status === "betting"
      && new Date(round.betting_ends_at).getTime() > Date.now() && !hasBet;
    betBtn.disabled = !canBet;
    betBtn.textContent = hasBet ? "Bet placed" : "Place bet";
  }

  async function placeBet() {
    if (!round) return;
    betBtn.disabled = true;
    const { data, error } = await supabase.rpc("roulette_bet", { p_round: round.id, p_bet: betKey, p_amount: amount });
    if (error) { msg.textContent = error.message; msg.className = "casino-msg lose"; updateControls(); return; }
    hasBet = true; setCash(data.cash);
    msg.textContent = `Bet $${amount} on ${prettyBet(betKey)}.`; msg.className = "casino-msg";
    updateControls();
  }

  // ---- wheel ----
  function drawWheel(winN) {
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, R = w / 2 - 6;
    const step = (Math.PI * 2) / ORDER.length;
    c2.clearRect(0, 0, w, h);
    c2.fillStyle = "#caa45a"; c2.beginPath(); c2.arc(cx, cy, R + 5, 0, Math.PI * 2); c2.fill();
    for (let i = 0; i < ORDER.length; i++) {
      const a0 = i * step + rot - Math.PI / 2 - step / 2, a1 = a0 + step;
      c2.beginPath(); c2.moveTo(cx, cy); c2.arc(cx, cy, R, a0, a1); c2.closePath();
      c2.fillStyle = FILL[colorOf(ORDER[i])]; c2.fill();
      const am = (a0 + a1) / 2;
      c2.save(); c2.translate(cx + Math.cos(am) * (R - 14), cy + Math.sin(am) * (R - 14)); c2.rotate(am + Math.PI / 2);
      c2.fillStyle = "#fff"; c2.font = "bold 11px system-ui, sans-serif"; c2.textAlign = "center"; c2.textBaseline = "middle";
      c2.fillText(String(ORDER[i]), 0, 0); c2.restore();
    }
    c2.fillStyle = "#caa45a"; c2.beginPath(); c2.arc(cx, cy, 22, 0, Math.PI * 2); c2.fill();
    c2.fillStyle = "#1b1208"; c2.beginPath(); c2.arc(cx, cy, 16, 0, Math.PI * 2); c2.fill();
    if (winN != null) { c2.fillStyle = "#f3d27a"; c2.font = "bold 18px Georgia, serif"; c2.textAlign = "center"; c2.textBaseline = "middle"; c2.fillText(String(winN), cx, cy); }
    c2.fillStyle = "#f3e8cf"; c2.beginPath(); c2.moveTo(cx, 6); c2.lineTo(cx - 10, -10); c2.lineTo(cx + 10, -10); c2.closePath(); c2.fill();
  }

  function animateTo(result) {
    const idx = ORDER.indexOf(result), step = (Math.PI * 2) / ORDER.length;
    const start = rot;
    const base = ((-idx * step - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const target = start + base + Math.PI * 2 * 6;
    const dur = 4200, t0 = performance.now();
    cancelAnimationFrame(raf);
    msg.textContent = "Spinning…"; msg.className = "casino-msg";
    (function frame(now) {
      const p = Math.min((now - t0) / dur, 1), ease = 1 - Math.pow(1 - p, 3);
      rot = start + (target - start) * ease; drawWheel();
      if (p < 1) raf = requestAnimationFrame(frame);
      else { rot %= Math.PI * 2; drawWheel(result); afterSpin(result); }
    })(t0);
  }

  async function afterSpin(result) {
    await loadBets();     // pull settled won/payout
    await refreshCash();
    const mine = bets.find((b) => b.user_id === uid);
    if (mine) {
      msg.textContent = mine.won ? `${colorOf(result)} ${result} — you win $${mine.payout}! 🎉` : `${colorOf(result)} ${result} — no luck.`;
      msg.className = "casino-msg " + (mine.won ? "win" : "lose");
    } else { msg.textContent = `${colorOf(result)} ${result}.`; msg.className = "casino-msg"; }
    // roll to the next round shortly
    if (!nextScheduled) nextScheduled = setTimeout(async () => {
      const { data } = await supabase.rpc("roulette_current"); if (data) onRound(data);
    }, 5000);
  }

  teardown = () => {
    cancelAnimationFrame(raf);
    clearInterval(ticker);
    if (nextScheduled) clearTimeout(nextScheduled);
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
