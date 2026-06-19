// Entry point. Wires the auth screen to the (placeholder) game screen.
// The world/map/chat modules are added after requirements gathering.
import { signUp, logIn, logOut, currentUser } from "./auth.js";

const authScreen = document.getElementById("auth-screen");
const gameScreen = document.getElementById("game-screen");
const form = document.getElementById("auth-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const msg = document.getElementById("auth-msg");
const whoami = document.getElementById("whoami");

function show(screen) {
  authScreen.hidden = screen !== "auth";
  gameScreen.hidden = screen !== "game";
}

async function enterGame(user) {
  whoami.textContent = user.email?.split("@")[0] ?? "player";
  show("game");
  // TODO(after requirements): init world, presence, chat here.
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";
  const action = e.submitter?.value; // "login" | "signup"
  const username = usernameInput.value;
  const password = passwordInput.value;
  try {
    const user = action === "signup"
      ? await signUp(username, password)
      : await logIn(username, password);
    await enterGame(user);
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById("logout").addEventListener("click", async () => {
  await logOut();
  show("auth");
});

// Resume existing session on load.
(async () => {
  const user = await currentUser();
  if (user) await enterGame(user);
  else show("auth");
})();
