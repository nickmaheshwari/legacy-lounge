// Multiplayer blackjack overlay. One shared round (bj_rounds) everyone joins:
// dealt against a single dealer, each plays their own hand, all hands visible.
// Server-authoritative (bj_round_* RPCs); the client bets / hits / stands.
import { supabase } from "../../supabase.js";
import { drawAnimal } from "../../world.js";

export const meta = { id: "blackjack", title: "Blackjack", maxPlayers: 6 };

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
const cardRank = (c) => RANKS[c % 13];
const cardSuit = (c) => SUITS[Math.floor(c / 13) % 4];
const isRed = (c) => { const s = Math.floor(c / 13) % 4; return s === 1 || s === 2; };
const total = (cards) => {
  let t = 0, aces = 0;
  for (const c of cards) { const r = (c % 13) + 1; if (r === 1) { aces++; t += 11; } else t += Math.min(r, 10); }
  while (t > 21 && aces) { t -= 10; aces--; }
  return t;
};

let teardown = null;

export function mount(container, ctx) {
  const uid = ctx.user.id;
  const myAvatar = ctx.avatar || "dog";
  let bet = 10, round = null, hands = [];
  let sub = null, ticker = null, dealSent = null, settleSent = null, nextScheduled = null;
  const shown = {}; // animation: key -> cards already shown

  const wrap = div("casino-wrap bj-felt");
  const cash = div("casino-cash");
  const phase = div("roulette-phase");
  const dealer = div("bj-dealer");
  const ratCanvas = document.createElement("canvas"); ratCanvas.width = 76; ratCanvas.height = 66; ratCanvas.className = "bj-rat";
  const speech = div("bj-speech", "Place your bet to join.");
  const dealerCards = div("cards");
  dealer.append(ratCanvas, div("bj-dealer-name", "Rémy"), speech, dealerCards);
  const playersEl = div("bj-players");
  const msg = div("casino-msg");
  const controls = div("casino-controls");
  const betWrap = div("bet-wrap");

  const betSel = document.createElement("input");
  betSel.type = "range"; betSel.min = "1"; betSel.max = "10"; betSel.value = "10";
  const betVal = span("$10");
  betSel.addEventListener("input", () => { bet = +betSel.value; betVal.textContent = "$" + bet; });
  const joinBtn = button("Join ($10)", onJoin);
  betSel.addEventListener("input", () => { joinBtn.textContent = `Join ($${bet})`; });
  betWrap.append(span("Bet: "), betSel, betVal, joinBtn);

  const hitBtn = button("Hit", onHit);
  const standBtn = button("Stand", onStand);
  const leaveBtn = button("Leave", () => ctx.close?.());
  controls.append(hitBtn, standBtn, leaveBtn);

  wrap.append(cash, phase, dealer, playersEl, msg, betWrap, controls);
  container.append(wrap);
  drawRat(ratCanvas);
  setCash(ctx.startCash);

  sub = supabase.channel("bj")
    .on("postgres_changes", { event: "*", schema: "public", table: "bj_rounds" }, ({ new: r }) => { if (r) onRound(r); })
    .on("postgres_changes", { event: "*", schema: "public", table: "bj_hands" }, ({ new: h, old }) => {
      if (round && ((h && h.round_id === round.id) || old)) loadHands();
    })
    .subscribe();

  (async () => {
    const { data, error } = await supabase.rpc("bj_round_current");
    if (error) { msg.textContent = error.message; msg.className = "casino-msg lose"; return; }
    onRound(data); await loadHands();
  })();
  ticker = setInterval(tick, 250);

  function setCash(c) { if (c != null) { cash.textContent = `Cash: $${c}`; ctx.onCash?.(c); } }
  function say(s) { speech.textContent = s; }
  const myHand = () => hands.find((h) => h.user_id === uid);

  async function loadHands() {
    if (!round) return;
    const { data } = await supabase.from("bj_hands").select("*").eq("round_id", round.id).order("created_at");
    hands = data || []; render();
  }
  async function refreshCash() {
    const { data } = await supabase.from("profiles").select("cash").eq("id", uid).maybeSingle();
    if (data) setCash(data.cash);
  }

  function onRound(r) {
    const isNew = !round || r.id !== round.id;
    round = r;
    if (isNew) { hands = []; dealSent = null; settleSent = null; nextScheduled = null; for (const k in shown) delete shown[k]; }
    render();
    if (r.status === "done") { refreshCash(); }
  }

  function tick() {
    if (!round) return;
    renderPhase();
    if (round.status === "betting" && Date.now() >= new Date(round.betting_ends_at).getTime() && dealSent !== round.id) {
      dealSent = round.id;
      supabase.rpc("bj_round_deal", { p_round: round.id }).then(({ data }) => { if (data) onRound(data); });
    } else if (round.status === "playing" && hands.length && hands.every((h) => h.stand) && settleSent !== round.id) {
      settleSent = round.id;
      supabase.rpc("bj_round_settle", { p_round: round.id }).then(({ data }) => { if (data) onRound(data); });
    } else if (round.status === "done" && !nextScheduled) {
      nextScheduled = setTimeout(async () => { const { data } = await supabase.rpc("bj_round_current"); if (data) onRound(data); }, 6000);
    }
  }

  function renderPhase() {
    if (!round) { phase.textContent = ""; return; }
    if (round.status === "betting") {
      const s = Math.max(0, Math.ceil((new Date(round.betting_ends_at).getTime() - Date.now()) / 1000));
      phase.textContent = `Betting — ${s}s`;
    } else if (round.status === "playing") phase.textContent = "Cards in play";
    else phase.textContent = "Round over";
  }

  function render() {
    renderPhase();
    const r = round || {};
    const playing = r.status === "playing", done = r.status === "done", betting = r.status === "betting";

    // dealer
    dealerCards.innerHTML = "";
    const dc = r.dealer_cards || [];
    if (playing) { appendCards(dealerCards, [dc[0]], "dealer"); dealerCards.append(cardBack()); }
    else if (done) appendCards(dealerCards, dc, "dealer");
    const dtot = done && dc.length ? total(dc) : null;

    // players
    playersEl.innerHTML = "";
    for (const h of hands) {
      const tile = div("bj-player" + (h.user_id === uid ? " me" : "") + (h.result ? " r-" + h.result : ""));
      const av = document.createElement("canvas"); av.width = 46; av.height = 46; av.className = "bj-pav";
      drawAnimal(av.getContext("2d"), h.avatar || "dog", 23, 22, 12, 1, 0, false);
      tile.append(av, div("bj-pname", h.user_id === uid ? "You" : h.username));
      const cardsBox = div("cards bj-pcards"); appendCards(cardsBox, h.cards || [], "h" + h.id); tile.append(cardsBox);
      const tt = (h.cards && h.cards.length) ? total(h.cards) : 0;
      let line = `$${h.bet}` + (tt ? ` · ${tt}` : "");
      if (h.result) line += " · " + ({ blackjack: "BJ +$" + h.payout, win: "+$" + h.payout, push: "push", lose: "lost" })[h.result];
      tile.append(div("bj-pmeta", line));
      playersEl.append(tile);
    }
    if (!hands.length) playersEl.append(div("bj-empty", betting ? "No players yet — join!" : ""));

    // controls
    const mine = myHand();
    betWrap.style.display = betting && !mine ? "flex" : "none";
    const canAct = playing && mine && !mine.stand;
    hitBtn.style.display = standBtn.style.display = canAct ? "inline-block" : "none";

    // messages / dealer chatter
    if (betting) { msg.textContent = mine ? `You're in for $${mine.bet}.` : "Place your bet to join."; msg.className = "casino-msg"; say(mine ? "You're in. Good luck." : "Step right up — place your bet."); }
    else if (playing) { msg.textContent = mine ? (mine.stand ? "Standing — waiting for the table…" : `Your total: ${total(mine.cards)}`) : "Spectating this round."; msg.className = "casino-msg"; say("Hit or stand?"); }
    else if (done) {
      if (mine && mine.result) { const r2 = mine.result; msg.textContent = `${({ blackjack: "Blackjack!", win: "You win!", push: "Push.", lose: "You lose." })[r2]} Dealer: ${dtot}`; msg.className = "casino-msg " + (r2 === "lose" ? "lose" : r2 === "push" ? "" : "win"); }
      else { msg.textContent = `Dealer: ${dtot ?? "-"}`; msg.className = "casino-msg"; }
      say("Next round shortly…");
    }
  }

  // append cards, animating only newly added ones per source key
  function appendCards(box, cards, key) {
    const prev = shown[key] || 0;
    cards.forEach((c, i) => { if (c == null) return; const el = cardEl(c); if (i >= prev) { el.classList.add("dealing"); el.style.animationDelay = Math.max(0, i - prev) * 120 + "ms"; } box.append(el); });
    shown[key] = cards.filter((c) => c != null).length;
  }

  async function onJoin() {
    const { data, error } = await supabase.rpc("bj_round_bet", { p_round: round.id, p_amount: bet, p_avatar: myAvatar });
    if (error) { msg.textContent = error.message; msg.className = "casino-msg lose"; return; }
    setCash(data.cash); await loadHands();
  }
  function onHit() { if (round) supabase.rpc("bj_round_hit", { p_round: round.id }).then(loadHands); }
  function onStand() { if (round) supabase.rpc("bj_round_stand", { p_round: round.id }).then(loadHands); }

  teardown = () => {
    clearInterval(ticker);
    if (nextScheduled) clearTimeout(nextScheduled);
    if (sub) supabase.removeChannel(sub);
    container.innerHTML = "";
  };
}

export function unmount() { if (teardown) teardown(); teardown = null; }

function drawRat(canvas) {
  const x = canvas.getContext("2d"), cx = 38, cy = 40;
  x.fillStyle = "#9aa0a8"; circ(cx - 16, cy - 20, 11); circ(cx + 16, cy - 20, 11);
  x.fillStyle = "#d9b7c0"; circ(cx - 16, cy - 20, 6); circ(cx + 16, cy - 20, 6);
  x.fillStyle = "#a7adb5"; circ(cx, cy, 20);
  x.fillStyle = "#b8bdc4"; x.beginPath(); x.ellipse(cx, cy + 10, 12, 9, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#e58aa0"; circ(cx, cy + 16, 3);
  x.fillStyle = "#16110d"; circ(cx - 7, cy + 1, 3); circ(cx + 7, cy + 1, 3);
  x.fillStyle = "#fff"; circ(cx - 8, cy, 1); circ(cx + 6, cy, 1);
  x.strokeStyle = "rgba(255,255,255,0.6)"; x.lineWidth = 1;
  for (const dy of [12, 16]) { ln(cx - 6, cy + dy, cx - 24, cy + dy - 3); ln(cx + 6, cy + dy, cx + 24, cy + dy - 3); }
  x.fillStyle = "#0c7a3a"; x.beginPath(); x.ellipse(cx, cy - 12, 22, 9, 0, Math.PI, 0); x.fill();
  x.fillStyle = "#0a5e2d"; x.fillRect(cx - 16, cy - 16, 32, 6);
  x.fillStyle = "#7a2330";
  x.beginPath(); x.moveTo(cx, cy + 22); x.lineTo(cx - 9, cy + 18); x.lineTo(cx - 9, cy + 27); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(cx, cy + 22); x.lineTo(cx + 9, cy + 18); x.lineTo(cx + 9, cy + 27); x.closePath(); x.fill();
  function circ(a, b, r) { x.beginPath(); x.arc(a, b, r, 0, Math.PI * 2); x.fill(); }
  function ln(a, b, d, e) { x.beginPath(); x.moveTo(a, b); x.lineTo(d, e); x.stroke(); }
}

function div(cls, text) { const e = document.createElement("div"); e.className = cls; if (text != null) e.textContent = text; return e; }
function span(text) { const e = document.createElement("span"); e.textContent = text; return e; }
function button(label, fn) { const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", fn); return b; }
function cardEl(c) { const e = document.createElement("div"); e.className = "card" + (isRed(c) ? " red" : ""); e.innerHTML = `<span>${cardRank(c)}</span><span>${cardSuit(c)}</span>`; return e; }
function cardBack() { const e = document.createElement("div"); e.className = "card back"; return e; }
