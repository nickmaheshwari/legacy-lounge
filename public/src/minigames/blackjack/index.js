// Blackjack overlay. All game logic + RNG + payouts are server-side (RPCs in
// the gambling migration). The client only picks a bet (<= $10) and hit/stand.
import { supabase } from "../../supabase.js";

export const meta = { id: "blackjack", title: "Blackjack", maxPlayers: 1 };

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
const cardRank = (c) => RANKS[c % 13];
const cardSuit = (c) => SUITS[Math.floor(c / 13) % 4];
const isRed = (c) => { const s = Math.floor(c / 13) % 4; return s === 1 || s === 2; };

let teardown = null;

export function mount(container, ctx) {
  let bet = 10;
  let hand = null; // last state from server

  const wrap = div("casino-wrap");
  const title = div("casino-title", "🂡 Blackjack");
  const cash = div("casino-cash");
  const dealerRow = div("bj-row");
  const dealerCards = div("cards");
  const playerRow = div("bj-row");
  const playerCards = div("cards");
  const msg = div("casino-msg");
  const controls = div("casino-controls");
  const betWrap = div("bet-wrap");

  dealerRow.append(spanLabel("Dealer"), dealerCards);
  playerRow.append(spanLabel("You"), playerCards);

  const betSel = document.createElement("input");
  betSel.type = "range"; betSel.min = "1"; betSel.max = "10"; betSel.value = "10";
  const betVal = span("$10");
  betSel.addEventListener("input", () => { bet = +betSel.value; betVal.textContent = "$" + bet; });
  betWrap.append(span("Bet: "), betSel, betVal);

  const dealBtn = button("Deal", onDeal);
  const hitBtn = button("Hit", onHit);
  const standBtn = button("Stand", onStand);
  const leaveBtn = button("Leave", () => ctx.close?.());
  controls.append(dealBtn, hitBtn, standBtn, leaveBtn);

  wrap.append(title, cash, dealerRow, playerRow, msg, betWrap, controls);
  container.append(wrap);
  setCash(ctx.startCash);
  render();

  function setCash(c) { if (c != null) { cash.textContent = `Cash: $${c}`; ctx.onCash?.(c); } }

  function render() {
    const playing = hand && hand.status === "player_turn";
    const done = hand && hand.status === "done";
    dealerCards.innerHTML = ""; playerCards.innerHTML = "";
    if (hand) {
      hand.dealer.forEach((c) => dealerCards.append(cardEl(c)));
      if (!done) dealerCards.append(cardBack());
      hand.player.forEach((c) => playerCards.append(cardEl(c)));
    }
    betWrap.style.display = hand && playing ? "none" : "flex";
    dealBtn.style.display = playing ? "none" : "inline-block";
    dealBtn.textContent = hand ? "New hand" : "Deal";
    hitBtn.disabled = !playing; standBtn.disabled = !playing;
    hitBtn.style.display = standBtn.style.display = playing ? "inline-block" : "none";

    if (done) {
      const r = hand.result;
      const txt = r === "blackjack" ? "Blackjack! 🎉" : r === "win" ? "You win!" :
        r === "push" ? "Push (tie)." : "Dealer wins.";
      msg.textContent = `${txt}  You: ${hand.player_total}  Dealer: ${hand.dealer_total}`;
      msg.className = "casino-msg " + (r === "lose" ? "lose" : r === "push" ? "" : "win");
    } else if (playing) {
      msg.textContent = `Your total: ${hand.player_total}`; msg.className = "casino-msg";
    } else {
      msg.textContent = "Place your bet and deal. Max $10."; msg.className = "casino-msg";
    }
  }

  async function call(fn, args) {
    try {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      hand = data; setCash(data.cash); render();
    } catch (e) {
      msg.textContent = e.message || String(e); msg.className = "casino-msg lose";
    }
  }
  function onDeal() { call("bj_start", { p_amount: bet }); }
  function onHit() { if (hand) call("bj_hit", { p_hand: hand.hand_id }); }
  function onStand() { if (hand) call("bj_stand", { p_hand: hand.hand_id }); }

  teardown = () => { container.innerHTML = ""; };
}

export function unmount() { if (teardown) teardown(); teardown = null; }

// ---- dom helpers ----
function div(cls, text) { const e = document.createElement("div"); e.className = cls; if (text != null) e.textContent = text; return e; }
function span(text) { const e = document.createElement("span"); e.textContent = text; return e; }
function spanLabel(text) { const e = document.createElement("span"); e.className = "bj-side"; e.textContent = text; return e; }
function button(label, fn) { const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", fn); return b; }
function cardEl(c) {
  const e = document.createElement("div");
  e.className = "card" + (isRed(c) ? " red" : "");
  e.innerHTML = `<span>${cardRank(c)}</span><span>${cardSuit(c)}</span>`;
  return e;
}
function cardBack() { const e = document.createElement("div"); e.className = "card back"; return e; }
