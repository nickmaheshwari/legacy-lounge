// Entry point. Auth → game (rooms + chat). Players walk between rooms via exit
// arrows; tables open game overlays. Cash lives on the profile and is shown in
// the header, refreshed whenever a server-authoritative game pays out.
import { signUp, logIn, logOut, currentUser } from "./auth.js";
import { supabase } from "./supabase.js";
import { startWorld } from "./world.js";
import { buildRooms } from "./rooms.js";
import { initChat } from "./chat.js";
import { loadMinigame } from "./minigames/registry.js";

const authScreen = document.getElementById("auth-screen");
const gameScreen = document.getElementById("game-screen");
const form = document.getElementById("auth-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const msg = document.getElementById("auth-msg");
const whoami = document.getElementById("whoami");
const cashEl = document.getElementById("cash");
const canvas = document.getElementById("world-canvas");
const chatPanel = document.getElementById("chat-panel");
const overlay = document.getElementById("overlay");
const overlayContent = document.getElementById("overlay-content");
const errBanner = document.getElementById("err-banner");

function showError(label, e) {
  const detail = e?.message || e?.error?.message || String(e);
  errBanner.textContent = `${label}: ${detail}`;
  errBanner.hidden = false;
  console.error(label, e);
}
window.addEventListener("error", (e) => showError("Error", e));
window.addEventListener("unhandledrejection", (e) => showError("Unhandled", e.reason));

function show(screen) {
  authScreen.hidden = screen !== "auth";
  gameScreen.hidden = screen !== "game";
}

let player = null; // { user, username, avatar }
let cash = 0;
let rooms = null;
let currentRoom = null;
let world = null;
let chat = null;
let activeGame = null;

function setCash(c) { cash = c; cashEl.textContent = `$${c}`; }

async function getProfile(user) {
  const { data } = await supabase
    .from("profiles")
    .select("username, avatar, cash")
    .eq("id", user.id)
    .maybeSingle();
  return {
    username: data?.username || user.email?.split("@")[0] || "player",
    avatar: data?.avatar || "dog",
    cash: data?.cash ?? 500,
  };
}

// ---------- game overlays ----------
async function openGame(id) {
  const mod = await loadMinigame(id);
  overlay.hidden = false;
  overlayContent.innerHTML = "";
  mod.mount(overlayContent, {
    supabase,
    user: player.user,
    username: player.username,
    startCash: cash,
    onCash: setCash,
    close: closeGame,
  });
  activeGame = mod;
}
function closeGame() {
  if (activeGame) { activeGame.unmount(); activeGame = null; }
  overlay.hidden = true;
  overlayContent.innerHTML = "";
}

// ---------- rooms ----------
function enterRoom(roomId) {
  closeGame();
  if (world) { world.stop(); world = null; }
  currentRoom = rooms[roomId];
  world = startWorld({
    canvas,
    userId: player.user.id,
    username: player.username,
    avatar: player.avatar,
    room: currentRoom,
    onExit: enterRoom,
  });
}

async function enterGame(user) {
  const profile = await getProfile(user);
  player = { user, username: profile.username, avatar: profile.avatar };
  setCash(profile.cash);
  whoami.textContent = profile.username;
  show("game");

  rooms = buildRooms({
    openChess: () => openGame("chess"),
    openBlackjack: () => openGame("blackjack"),
    openRoulette: () => openGame("roulette"),
  });

  try { enterRoom("lounge"); } catch (e) { showError("World", e); }
  try { chat = initChat({ root: chatPanel, userId: user.id, username: profile.username }); }
  catch (e) { showError("Chat", e); }
}

function leaveGame() {
  closeGame();
  if (world) { world.stop(); world = null; }
  if (chat) { chat.stop(); chat = null; }
  chatPanel.innerHTML = "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";
  const action = e.submitter?.value;
  try {
    const avatar = form.querySelector('input[name="avatar"]:checked')?.value || "dog";
    const user = action === "signup"
      ? await signUp(usernameInput.value, passwordInput.value, avatar)
      : await logIn(usernameInput.value, passwordInput.value);
    await enterGame(user);
  } catch (err) {
    msg.textContent = err.message;
    showError("Sign-in/up", err);
  }
});

document.getElementById("logout").addEventListener("click", async () => {
  leaveGame();
  await logOut();
  show("auth");
});

(async () => {
  const user = await currentUser();
  if (user) await enterGame(user);
  else show("auth");
})();
