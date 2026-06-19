// Entry point. Auth screen → game screen (world + chat). Walking to the chess
// table and clicking opens the chess overlay.
import { signUp, logIn, logOut, currentUser } from "./auth.js";
import { supabase } from "./supabase.js";
import { startWorld } from "./world.js";
import { initChat } from "./chat.js";
import { loadMinigame } from "./minigames/registry.js";

const authScreen = document.getElementById("auth-screen");
const gameScreen = document.getElementById("game-screen");
const form = document.getElementById("auth-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const msg = document.getElementById("auth-msg");
const whoami = document.getElementById("whoami");
const canvas = document.getElementById("world-canvas");
const chatPanel = document.getElementById("chat-panel");
const overlay = document.getElementById("overlay");
const overlayContent = document.getElementById("overlay-content");

let session = null; // { world, chat, game }

function show(screen) {
  authScreen.hidden = screen !== "auth";
  gameScreen.hidden = screen !== "game";
}

async function getUsername(user) {
  const { data } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  // fall back to the synthetic-email local part if profile not yet readable
  return data?.username || user.email?.split("@")[0] || "player";
}

let activeGame = null; // { unmount }

async function openChess(ctx) {
  const mod = await loadMinigame("chess");
  overlay.hidden = false;
  overlayContent.innerHTML = "";
  mod.mount(overlayContent, {
    supabase,
    user: ctx.user,
    username: ctx.username,
    close: closeChess,
  });
  activeGame = mod;
}

function closeChess() {
  if (activeGame) { activeGame.unmount(); activeGame = null; }
  overlay.hidden = true;
  overlayContent.innerHTML = "";
}

async function enterGame(user) {
  const username = await getUsername(user);
  whoami.textContent = username;
  show("game");

  const world = startWorld({
    canvas,
    userId: user.id,
    username,
    onEnterChess: () => openChess({ user, username }),
  });
  const chat = initChat({ root: chatPanel, userId: user.id, username });
  session = { world, chat };
}

function leaveGame() {
  closeChess();
  if (session) {
    session.world?.stop();
    session.chat?.stop();
    session = null;
  }
  chatPanel.innerHTML = "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";
  const action = e.submitter?.value; // "login" | "signup"
  try {
    const user = action === "signup"
      ? await signUp(usernameInput.value, passwordInput.value)
      : await logIn(usernameInput.value, passwordInput.value);
    await enterGame(user);
  } catch (err) {
    msg.textContent = err.message;
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
