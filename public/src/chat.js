// Chat: server-wide channel + direct PMs. Both persist to Postgres and stream
// live via Realtime postgres_changes. RLS guarantees PMs are only visible to the
// two participants; we still scope the subscription for efficiency.
import { supabase } from "./supabase.js";

const MAX_LEN = 280;
const HISTORY = 50;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function initChat({ root, userId, username }) {
  // ----- DOM -----
  const log = el("div", "chat-log");
  const form = el("form", "chat-form");
  const input = el("input", "chat-input");
  input.placeholder = "Message everyone…  (/pm <user> <msg> for private)";
  input.maxLength = MAX_LEN;
  input.autocomplete = "off";
  const send = el("button", null, "Send");
  send.type = "submit";
  form.append(input, send);
  root.append(log, form);

  function addLine({ kind, who, text }) {
    const line = el("div", `chat-line ${kind || ""}`);
    line.append(el("span", "chat-who", who + ": "), el("span", "chat-text", text));
    log.append(line);
    log.scrollTop = log.scrollHeight;
  }

  // ----- server-wide chat -----
  (async () => {
    const { data } = await supabase
      .from("chat_messages")
      .select("username, content, created_at")
      .order("created_at", { ascending: false })
      .limit(HISTORY);
    (data || []).reverse().forEach((m) => addLine({ who: m.username, text: m.content }));
  })();

  const chatSub = supabase
    .channel("public:chat_messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages" },
      ({ new: m }) => addLine({ who: m.username, text: m.content })
    )
    .subscribe();

  // ----- private messages (incoming) -----
  const pmSub = supabase
    .channel("pm:" + userId)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "private_messages",
        filter: `recipient_id=eq.${userId}`,
      },
      ({ new: m }) => addLine({ kind: "pm", who: `(PM) ${m.sender_name}`, text: m.content })
    )
    .subscribe();

  // ----- sending -----
  async function sendChat(content) {
    const { error } = await supabase
      .from("chat_messages")
      .insert({ user_id: userId, username, content });
    if (error) addLine({ kind: "err", who: "system", text: "send failed: " + error.message });
  }

  async function sendPm(toName, content) {
    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", toName)
      .maybeSingle();
    if (pErr || !profile) {
      addLine({ kind: "err", who: "system", text: `no user "${toName}"` });
      return;
    }
    const { error } = await supabase.from("private_messages").insert({
      sender_id: userId,
      recipient_id: profile.id,
      sender_name: username,
      content,
    });
    if (error) addLine({ kind: "err", who: "system", text: "pm failed: " + error.message });
    else addLine({ kind: "pm-out", who: `(PM → ${toName})`, text: content });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    input.value = "";
    const pm = raw.match(/^\/pm\s+(\S+)\s+([\s\S]+)$/i);
    if (pm) sendPm(pm[1], pm[2].slice(0, MAX_LEN));
    else sendChat(raw.slice(0, MAX_LEN));
  });

  return {
    stop() {
      supabase.removeChannel(chatSub);
      supabase.removeChannel(pmSub);
    },
  };
}
