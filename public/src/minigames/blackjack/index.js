// Blackjack overlay. Logic + RNG + payouts are server-side (bj_* RPCs). The
// client picks a bet (<= $10) and hit/stand, and animates the deal: Rémy the rat
// dealer slides cards from the shoe; the hole card flips on reveal.
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
  let hand = null;
  let lastHandId = null, lastStatus = null, shownP = 0, shownD = 0;

  const wrap = div("casino-wrap bj-felt");
  const dealer = div("bj-dealer");
  const ratCanvas = document.createElement("canvas");
  ratCanvas.width = 76; ratCanvas.height = 66; ratCanvas.className = "bj-rat";
  const speech = div("bj-speech", "Welcome — place your bet.");
  dealer.append(ratCanvas, div("bj-dealer-name", "Rémy"), speech);

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

  wrap.append(dealer, cash, dealerRow, playerRow, msg, betWrap, controls);
  container.append(wrap);
  drawRat(ratCanvas);
  setCash(ctx.startCash);
  render();

  function setCash(c) { if (c != null) { cash.textContent = `Cash: $${c}`; ctx.onCash?.(c); } }
  function say(s) { speech.textContent = s; }

  function render() {
    const playing = hand && hand.status === "player_turn";
    const done = hand && hand.status === "done";

    // figure out which cards are newly dealt (to animate just those)
    if (hand) {
      if (hand.hand_id !== lastHandId) { shownP = 0; shownD = 0; }
      else if (done && lastStatus !== "done") { shownD = 1; } // reveal hole card + draws
    }

    dealerCards.innerHTML = ""; playerCards.innerHTML = "";
    if (hand) {
      const dealerShown = done ? hand.dealer.map((c) => cardEl(c)) : [cardEl(hand.dealer[0]), cardBack()];
      dealerShown.forEach((el, i) => { if (i >= shownD) deal(el, i - shownD); dealerCards.append(el); });
      hand.player.forEach((c, i) => { const el = cardEl(c); if (i >= shownP) deal(el, (dealerShown.length - shownD) + (i - shownP)); playerCards.append(el); });
      shownP = hand.player.length; shownD = dealerShown.length;
      lastHandId = hand.hand_id; lastStatus = hand.status;
    }

    betWrap.style.display = hand && playing ? "none" : "flex";
    dealBtn.style.display = playing ? "none" : "inline-block";
    dealBtn.textContent = hand ? "New hand" : "Deal";
    hitBtn.disabled = !playing; standBtn.disabled = !playing;
    hitBtn.style.display = standBtn.style.display = playing ? "inline-block" : "none";

    if (done) {
      const r = hand.result;
      const txt = r === "blackjack" ? "Blackjack! 🎉" : r === "win" ? "You win!" : r === "push" ? "Push (tie)." : "Dealer wins.";
      msg.textContent = `${txt}  You: ${hand.player_total}  Dealer: ${hand.dealer_total}`;
      msg.className = "casino-msg " + (r === "lose" ? "lose" : r === "push" ? "" : "win");
      say(r === "lose" ? "House wins. Again?" : r === "push" ? "A push. Care to go again?" : "Nicely played!");
    } else if (playing) {
      msg.textContent = `Your total: ${hand.player_total}`; msg.className = "casino-msg";
      say("Hit or stand?");
    } else {
      msg.textContent = "Place your bet and deal. Max $10."; msg.className = "casino-msg";
    }
  }

  function deal(el, order) {
    el.classList.add("dealing");
    el.style.animationDelay = Math.max(0, order) * 130 + "ms";
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
  function onDeal() { say("Dealing…"); call("bj_start", { p_amount: bet }); }
  function onHit() { if (hand) call("bj_hit", { p_hand: hand.hand_id }); }
  function onStand() { if (hand) { say("Dealer plays…"); call("bj_stand", { p_hand: hand.hand_id }); } }

  teardown = () => { container.innerHTML = ""; };
}

export function unmount() { if (teardown) teardown(); teardown = null; }

// ---- Rémy the rat dealer ----
function drawRat(canvas) {
  const x = canvas.getContext("2d"), cx = 38, cy = 40;
  // ears
  x.fillStyle = "#9aa0a8"; circle(x, cx - 16, cy - 20, 11); circle(x, cx + 16, cy - 20, 11);
  x.fillStyle = "#d9b7c0"; circle(x, cx - 16, cy - 20, 6); circle(x, cx + 16, cy - 20, 6);
  // head
  x.fillStyle = "#a7adb5"; circle(x, cx, cy, 20);
  // snout
  x.fillStyle = "#b8bdc4"; x.beginPath(); x.ellipse(cx, cy + 10, 12, 9, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#e58aa0"; circle(x, cx, cy + 16, 3); // nose
  // eyes
  x.fillStyle = "#16110d"; circle(x, cx - 7, cy + 1, 3); circle(x, cx + 7, cy + 1, 3);
  x.fillStyle = "#fff"; circle(x, cx - 8, cy, 1); circle(x, cx + 6, cy, 1);
  // whiskers
  x.strokeStyle = "rgba(255,255,255,0.6)"; x.lineWidth = 1;
  for (const dy of [12, 16]) { line(x, cx - 6, cy + dy, cx - 24, cy + dy - 3); line(x, cx + 6, cy + dy, cx + 24, cy + dy - 3); }
  // green dealer visor
  x.fillStyle = "#0c7a3a"; x.beginPath(); x.ellipse(cx, cy - 12, 22, 9, 0, Math.PI, 0); x.fill();
  x.fillStyle = "#0a5e2d"; x.fillRect(cx - 16, cy - 16, 32, 6);
  // bowtie
  x.fillStyle = "#7a2330"; x.beginPath(); x.moveTo(cx, cy + 22); x.lineTo(cx - 9, cy + 18); x.lineTo(cx - 9, cy + 27); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(cx, cy + 22); x.lineTo(cx + 9, cy + 18); x.lineTo(cx + 9, cy + 27); x.closePath(); x.fill();
  function circle(c, a, b, r) { c.beginPath(); c.arc(a, b, r, 0, Math.PI * 2); c.fill(); }
  function line(c, a, b, d, e) { c.beginPath(); c.moveTo(a, b); c.lineTo(d, e); c.stroke(); }
}

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
