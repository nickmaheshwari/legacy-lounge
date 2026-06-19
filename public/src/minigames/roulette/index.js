// Roulette overlay (European single-zero). Server picks the number and pays out
// (play_roulette RPC). Client only picks a bet type/number and amount (<= $10).
import { supabase } from "../../supabase.js";

export const meta = { id: "roulette", title: "Roulette", maxPlayers: 1 };

const OUTSIDE = [
  ["red", "Red"], ["black", "Black"], ["even", "Even"],
  ["odd", "Odd"], ["low", "1-18"], ["high", "19-36"],
];

let teardown = null;

export function mount(container, ctx) {
  let amount = 10;
  let betKey = "red"; // 'red'|'black'|... or a numeric string

  const wrap = div("casino-wrap");
  const title = div("casino-title", "🎡 Roulette");
  const cash = div("casino-cash");
  const result = div("roulette-result");
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

  wrap.append(title, cash, result, msg, betGrid, numWrap, amtWrap, controls);
  container.append(wrap);
  setCash(ctx.startCash);
  setBet("red");

  function setCash(c) { if (c != null) { cash.textContent = `Cash: $${c}`; ctx.onCash?.(c); } }
  function setBet(k) {
    betKey = k;
    if (!/^[0-9]+$/.test(k)) numIn.value = "";
    [...betGrid.children].forEach((b) => b.classList.toggle("sel", b.dataset.key === k));
    msg.textContent = `Betting on: ${prettyBet(k)}`;
  }

  async function onSpin() {
    spinBtn.disabled = true;
    try {
      const { data, error } = await supabase.rpc("play_roulette", { p_bet: betKey, p_amount: amount });
      if (error) throw error;
      result.textContent = data.number;
      result.className = "roulette-result " + data.color;
      msg.textContent = data.win ? `${data.color} ${data.number} — you win $${data.payout}!` : `${data.color} ${data.number} — no luck.`;
      msg.className = "casino-msg " + (data.win ? "win" : "lose");
      setCash(data.cash);
    } catch (e) {
      msg.textContent = e.message || String(e); msg.className = "casino-msg lose";
    } finally { spinBtn.disabled = false; }
  }

  teardown = () => { container.innerHTML = ""; };
}

export function unmount() { if (teardown) teardown(); teardown = null; }

function prettyBet(k) {
  if (/^[0-9]+$/.test(k)) return `straight #${k}`;
  return { red: "Red", black: "Black", even: "Even", odd: "Odd", low: "1-18", high: "19-36" }[k] || k;
}
function div(cls, text) { const e = document.createElement("div"); e.className = cls; if (text != null) e.textContent = text; return e; }
function span(text) { const e = document.createElement("span"); e.textContent = text; return e; }
function button(label, fn) { const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", fn); return b; }
