// Entry point. Auth → game (rooms + chat). Players walk between rooms via exit
// arrows; tables open game overlays. Cash lives on the profile and is shown in
// the header, refreshed whenever a server-authoritative game pays out.
import { signUp, logIn, logOut, currentUser, validateUsername } from "./auth.js";
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

// Avatar catalog (id → emoji/label) used by both the signup + profile pickers.
const AVATAR_META = [
  { id: "dog", emoji: "🐶", label: "Dog" },
  { id: "cat", emoji: "🐱", label: "Cat" },
  { id: "capybara", emoji: "🦫", label: "Capybara" },
  { id: "penguin", emoji: "🐧", label: "Penguin" },
  { id: "tiger", emoji: "🐯", label: "Tiger" },
  { id: "panda", emoji: "🐼", label: "Panda" },
];
function buildAvatarPicker(container, name, selected) {
  container.innerHTML = "";
  for (const a of AVATAR_META) {
    const label = document.createElement("label");
    label.className = "avatar-opt";
    label.innerHTML =
      `<input type="radio" name="${name}" value="${a.id}" ${a.id === selected ? "checked" : ""} />` +
      `<span class="ava-emoji">${a.emoji}</span><span>${a.label}</span>`;
    container.append(label);
  }
}
function pickedAvatar(name, fallback = "dog") {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

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
async function openGame(id, opts = {}) {
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
    ...opts,
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
    openChess: (tableId) => openGame("chess", { table: tableId }),
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

// ---------- auth screen: login / signup tabs ----------
const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
const avatarPick = document.getElementById("avatar-pick");
const authSubmit = document.getElementById("auth-submit");
let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  tabLogin.classList.toggle("active", mode === "login");
  tabSignup.classList.toggle("active", mode === "signup");
  avatarPick.hidden = mode !== "signup";
  authSubmit.textContent = mode === "signup" ? "Sign up" : "Log in";
  passwordInput.autocomplete = mode === "signup" ? "new-password" : "current-password";
  msg.textContent = "";
}
tabLogin.addEventListener("click", () => setAuthMode("login"));
tabSignup.addEventListener("click", () => setAuthMode("signup"));
buildAvatarPicker(document.getElementById("signup-avatars"), "avatar", "dog");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";
  try {
    const user = authMode === "signup"
      ? await signUp(usernameInput.value, passwordInput.value, pickedAvatar("avatar"))
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

// ---------- profile modal (change username + avatar) ----------
const profileModal = document.getElementById("profile-modal");
const profileUsername = document.getElementById("profile-username");
const profileMsg = document.getElementById("profile-msg");

function openProfile() {
  profileMsg.textContent = "";
  profileUsername.value = player.username;
  buildAvatarPicker(document.getElementById("profile-avatars"), "profile-avatar", player.avatar);
  profileModal.hidden = false;
}
function closeProfile() { profileModal.hidden = true; }

document.getElementById("profile-btn").addEventListener("click", openProfile);
document.getElementById("profile-cancel").addEventListener("click", closeProfile);
document.getElementById("profile-save").addEventListener("click", async () => {
  const newName = profileUsername.value.trim();
  const newAvatar = pickedAvatar("profile-avatar", player.avatar);
  const nameErr = validateUsername(newName);
  if (nameErr) { profileMsg.textContent = nameErr; return; }

  const patch = {};
  if (newName !== player.username) patch.username = newName;
  if (newAvatar !== player.avatar) patch.avatar = newAvatar;
  if (!Object.keys(patch).length) { closeProfile(); return; }

  const { error } = await supabase.from("profiles").update(patch).eq("id", player.user.id);
  if (error) {
    profileMsg.textContent = /duplicate key/i.test(error.message) ? "That username is taken." : error.message;
    return;
  }
  closeProfile();
  // refresh everything so the new name/avatar propagate to world + chat
  const user = player.user;
  leaveGame();
  await enterGame(user);
});

(async () => {
  const user = await currentUser();
  if (user) await enterGame(user);
  else show("auth");
})();
