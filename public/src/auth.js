// Auth (phase 1): username + password via Supabase Auth.
//
// Why a password now: our whole security model leans on RLS keyed by
// `auth.uid()`. A real authenticated session is what makes `auth.uid()`
// trustworthy, so even "basic" auth needs a credential. We keep friction low
// (just username + password, no email verification) but get a real session.
//
// Username is mapped to a synthetic internal email so we can use Supabase's
// email/password provider without collecting real emails yet. Uniqueness is
// enforced two ways: the synthetic email is unique in auth.users, and the
// `profiles.username` column has a UNIQUE constraint (DB-enforced, not client).
import { supabase } from "./supabase.js";

const EMAIL_DOMAIN = "players.legacyleague.local";

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

export const AVATARS = ["dog", "cat", "capybara", "penguin", "tiger", "panda"];

export function validateUsername(username) {
  const u = (username || "").trim();
  if (u.length < 3 || u.length > 20) return "Username must be 3–20 characters.";
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return "Letters, numbers, and underscores only.";
  return null;
}

export async function signUp(username, password, avatar = "dog") {
  const err = validateUsername(username);
  if (err) throw new Error(err);
  if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");
  if (!AVATARS.includes(avatar)) avatar = "dog";

  const { data, error } = await supabase.auth.signUp({
    email: usernameToEmail(username),
    password,
  });
  if (error) {
    // Supabase returns a generic message; surface a friendlier dup hint.
    if (/already registered/i.test(error.message)) throw new Error("That username is taken.");
    throw error;
  }

  // Create the profile row. UNIQUE(username) is the real guard against dups.
  const { error: pErr } = await supabase
    .from("profiles")
    .insert({ id: data.user.id, username: username.trim(), avatar });
  if (pErr) {
    if (/duplicate key/i.test(pErr.message)) throw new Error("That username is taken.");
    throw pErr;
  }
  return data.user;
}

export async function logIn(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (error) throw new Error("Invalid username or password.");
  return data.user;
}

export async function logOut() {
  await supabase.auth.signOut();
}

export async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}
