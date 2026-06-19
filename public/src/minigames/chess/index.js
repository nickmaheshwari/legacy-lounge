// Chess mini-game. Rules come from chess.js (CDN ESM, no build step). The board
// of record is chess_games.fen; both players write moves, everyone (including
// spectators) renders from the synced fen. chess_moves stores history.
//
// Conforms to the mini-game contract: meta, mount(container, ctx), unmount().
import { Chess } from "https://esm.sh/chess.js@1.0.0";
import { supabase } from "../../supabase.js";

export const meta = { id: "chess", title: "Chess", maxPlayers: 2 };

const GLYPH = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

let teardown = null;

export function mount(container, ctx) {
  const { user, username } = ctx;
  const userId = user.id;
  const tableId = ctx.table || "lounge-1";

  const CPU_NAME = "CPU 🤖";
  const chess = new Chess();
  let game = null;        // chess_games row
  let selected = null;    // selected square e.g. "e2"
  let legalTargets = [];  // squares the selected piece can move to
  let gameSub = null;
  let vsCpu = false;      // single-player vs a client-side bot (you hold both seats)

  // ----- DOM -----
  const wrap = document.createElement("div");
  wrap.className = "chess-wrap";
  const status = document.createElement("div");
  status.className = "chess-status";
  const boardEl = document.createElement("div");
  boardEl.className = "chess-board";
  const controls = document.createElement("div");
  controls.className = "chess-controls";
  const resignBtn = button("Resign", onResign);
  const cpuBtn = button("Play the CPU 🤖", playCpu);
  const newBtn = button("New game", onNewGame);
  const leaveBtn = button("Leave", onLeave);
  controls.append(resignBtn, cpuBtn, newBtn, leaveBtn);
  wrap.append(status, boardEl, controls);
  container.append(wrap);

  function button(label, fn) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  // ----- role helpers -----
  const amWhite = () => game && game.white_id === userId;
  const amBlack = () => game && game.black_id === userId;
  const amPlayer = () => amWhite() || amBlack();
  const myTurn = () =>
    game && game.status === "active" && (
      vsCpu
        ? game.turn === "w" && amWhite()                    // vs CPU you only move White
        : ((game.turn === "w" && amWhite()) || (game.turn === "b" && amBlack()))
    );

  // ----- load or create the shared game, then seat self -----
  async function loadGame() {
    const { data } = await supabase
      .from("chess_games")
      .select("*")
      .eq("table_id", tableId)
      .in("status", ["waiting", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) game = data;
    else {
      const { data: created, error } = await supabase
        .from("chess_games")
        .insert({ table_id: tableId })
        .select()
        .single();
      if (error || !created) {
        status.textContent = "Couldn't load this table. " + (error?.message || "");
        status.className = "chess-status";
        return;
      }
      game = created;
    }
    if (!game) return;
    await seatSelf();
    applyGame();
    subscribe();
  }

  async function seatSelf() {
    if (!game || amPlayer()) return;
    const patch = {};
    if (!game.white_id) { patch.white_id = userId; patch.white_name = username; }
    else if (!game.black_id && game.white_id !== userId) { patch.black_id = userId; patch.black_name = username; }
    else return; // spectator
    if (game.white_id || patch.white_id) {
      // becomes active once both seats filled
      const bothFilled = (patch.white_id || game.white_id) && (patch.black_id || game.black_id);
      if (bothFilled) patch.status = "active";
    }
    const { data } = await supabase
      .from("chess_games")
      .update(patch)
      .eq("id", game.id)
      .select()
      .single();
    if (data) game = data;
  }

  function subscribe() {
    gameSub = supabase
      .channel("chess:" + game.id)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chess_games", filter: `id=eq.${game.id}` },
        ({ new: row }) => { game = row; applyGame(); }
      )
      .subscribe();
  }

  // ----- render from authoritative fen -----
  function applyGame() {
    if (!game) return;
    vsCpu = game.black_name === CPU_NAME && game.white_id === userId;
    chess.load(game.fen);
    selected = null;
    legalTargets = [];
    render();
    renderStatus();
    // if it's the CPU's turn (e.g. after a reload), nudge it.
    if (vsCpu && game.status === "active" && chess.turn() === "b") setTimeout(cpuMove, 450);
  }

  function renderStatus() {
    if (!game) return;
    let role = "Spectating";
    if (amWhite()) role = vsCpu ? "You are White (vs CPU)" : "You are White";
    else if (amBlack()) role = "You are Black";

    let line;
    switch (game.status) {
      case "waiting": line = "Waiting for a second player…"; break;
      case "active": line = (game.turn === "w" ? "White" : "Black") + " to move" + (myTurn() ? " — your turn" : ""); break;
      case "white_won": line = "White wins"; break;
      case "black_won": line = "Black wins"; break;
      case "draw": line = "Draw"; break;
      case "aborted": line = "Game aborted"; break;
      default: line = "";
    }
    const names = `${game.white_name || "—"} (W) vs ${game.black_name || "—"} (B)`;
    status.innerHTML = "";
    status.append(div("chess-role", role), div("chess-turn", line), div("chess-names", names));
    resignBtn.disabled = !(amPlayer() && game.status === "active");
    // Offer the CPU only when you're sitting alone (White seat, still waiting).
    cpuBtn.style.display = (amWhite() && game.status === "waiting") ? "inline-block" : "none";
    newBtn.disabled = !(game.status !== "active" && game.status !== "waiting");
  }

  function div(cls, text) { const d = document.createElement("div"); d.className = cls; d.textContent = text; return d; }

  function render() {
    boardEl.innerHTML = "";
    const flip = amBlack();
    const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = flip ? [...FILES].reverse() : FILES;
    for (const r of ranks) {
      for (const f of files) {
        const sq = f + r;
        const cell = document.createElement("div");
        const dark = (FILES.indexOf(f) + r) % 2 === 0;
        cell.className = "sq " + (dark ? "dark" : "light");
        if (sq === selected) cell.classList.add("sel");
        if (legalTargets.includes(sq)) cell.classList.add("target");
        const piece = chess.get(sq);
        if (piece) cell.textContent = GLYPH[piece.color + piece.type];
        cell.addEventListener("click", () => onSquare(sq));
        boardEl.append(cell);
      }
    }
  }

  // ----- interaction -----
  function onSquare(sq) {
    if (!myTurn()) return;
    const piece = chess.get(sq);
    const myColor = amWhite() ? "w" : "b";

    if (selected && legalTargets.includes(sq)) {
      doMove(selected, sq);
      return;
    }
    if (piece && piece.color === myColor) {
      selected = sq;
      legalTargets = chess.moves({ square: sq, verbose: true }).map((m) => m.to);
      render();
    } else {
      selected = null; legalTargets = [];
      render();
    }
  }

  async function doMove(from, to) {
    // auto-queen on promotion for MVP
    let move;
    try {
      move = chess.move({ from, to, promotion: "q" });
    } catch { move = null; }
    if (!move) { selected = null; legalTargets = []; render(); return; }
    selected = null; legalTargets = [];
    render(); // optimistic
    await commitMove(move);
  }

  // Persist a move (used by both the human and the CPU). mover is always the
  // signed-in user (vs CPU you hold both seats, so the bot's moves are yours).
  async function commitMove(move) {
    const fen = chess.fen();
    const turn = chess.turn();
    let newStatus = "active";
    if (chess.isCheckmate()) newStatus = turn === "w" ? "black_won" : "white_won";
    else if (chess.isGameOver()) newStatus = "draw";

    const ply = chess.history().length;
    const { error: mErr } = await supabase.from("chess_moves").insert({
      game_id: game.id, mover_id: userId, ply,
      san: move.san, uci: move.from + move.to + (move.promotion || ""), fen_after: fen,
    });
    const { error: gErr } = await supabase
      .from("chess_games")
      .update({ fen, turn, status: newStatus })
      .eq("id", game.id);
    if (mErr || gErr) { await refresh(); return; }
    if (vsCpu && newStatus === "active" && turn === "b") setTimeout(cpuMove, 450);
  }

  const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  function cpuMove() {
    if (!vsCpu || !game || game.status !== "active" || chess.turn() !== "b") return;
    const moves = chess.moves({ verbose: true });
    if (!moves.length) return;
    let pick = moves.find((m) => m.san.includes("#"));                 // take mate
    if (!pick) {
      const caps = moves.filter((m) => m.captured).sort((a, b) => PIECE_VAL[b.captured] - PIECE_VAL[a.captured]);
      pick = caps[0];                                                  // else best capture
    }
    if (!pick) pick = moves[Math.floor(Math.random() * moves.length)]; // else random
    const move = chess.move(pick);
    render();
    commitMove(move);
  }

  async function playCpu() {
    if (!game || game.status !== "waiting" || !amWhite()) return;
    const { data } = await supabase
      .from("chess_games")
      .update({ black_id: userId, black_name: CPU_NAME, status: "active" })
      .eq("id", game.id)
      .select()
      .single();
    if (data) { game = data; applyGame(); }
  }

  async function refresh() {
    const { data } = await supabase.from("chess_games").select("*").eq("id", game.id).single();
    if (data) { game = data; applyGame(); }
  }

  async function onResign() {
    if (!amPlayer() || game.status !== "active") return;
    const result = amWhite() ? "black_won" : "white_won";
    await supabase.from("chess_games").update({ status: result }).eq("id", game.id);
  }

  async function onNewGame() {
    if (gameSub) supabase.removeChannel(gameSub);
    const { data } = await supabase.from("chess_games").insert({ table_id: tableId }).select().single();
    game = data;
    await seatSelf();
    applyGame();
    subscribe();
  }

  // ----- leaving the table -----
  function onLeave() {
    // Only warn if leaving abandons a live match you're seated in.
    if (amPlayer() && (game.status === "active" || game.status === "waiting")) {
      showConfirm("Are you sure? Leaving the table forfeits the match.", async () => {
        await forfeit();
        ctx.close?.();
      });
    } else {
      ctx.close?.();
    }
  }

  async function forfeit() {
    if (!game) return;
    if (game.status === "active") {
      const result = amWhite() ? "black_won" : "white_won";
      await supabase.from("chess_games").update({ status: result }).eq("id", game.id);
    } else if (game.status === "waiting") {
      // no opponent yet — free the table
      await supabase.from("chess_games").update({ status: "aborted" }).eq("id", game.id);
    }
  }

  function showConfirm(message, onYes) {
    const back = document.createElement("div");
    back.className = "chess-confirm";
    const card = document.createElement("div");
    card.className = "chess-confirm-card";
    card.append(div("chess-confirm-msg", message));
    const row = document.createElement("div");
    row.className = "chess-controls";
    const yes = button("Leave & forfeit", async () => { back.remove(); await onYes(); });
    const no = button("Stay", () => back.remove());
    row.append(yes, no);
    card.append(row);
    back.append(card);
    wrap.append(back);
  }

  loadGame();

  teardown = () => {
    if (gameSub) supabase.removeChannel(gameSub);
    container.innerHTML = "";
  };
}

export function unmount() {
  if (teardown) teardown();
  teardown = null;
}
