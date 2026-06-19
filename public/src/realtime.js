// Realtime room. Presence = who's here (identity + spawn). Live movement =
// broadcast events (propagate reliably to connected peers). Postgres-changes
// (chat/chess) run on their own channels, which is why they kept working even
// when this channel failed to subscribe.
//
// Robustness: the subscribe can land in CHANNEL_ERROR / TIMED_OUT / CLOSED (the
// "shows up half the time" symptom). We surface every state to the console and
// auto-rejoin on failure with backoff, re-tracking on each (re)subscribe.
import { supabase } from "./supabase.js";

export function joinRoom({ channel: channelName = "room:lounge", userId, username, avatar, spawn, onPresence, onMove }) {
  let channel = null;
  let closed = false;
  let retry = 0;
  let lastTrack = 0;
  let self = { id: userId, username, avatar, x: spawn.x, y: spawn.y };

  function rebuild() {
    const players = () => {
      const state = channel.presenceState();
      onPresence(Object.values(state).map((m) => m[0]).filter(Boolean));
    };

    channel = supabase.channel(channelName, {
      config: { presence: { key: userId }, broadcast: { self: false } },
    });

    channel.on("presence", { event: "sync" }, players);
    channel.on("presence", { event: "join" }, players);
    channel.on("presence", { event: "leave" }, players);
    channel.on("broadcast", { event: "move" }, ({ payload }) => {
      if (payload && payload.id !== userId) onMove(payload);
    });

    channel.subscribe(async (status, err) => {
      console.log(`[realtime ${channelName}] ${status}`, err || "");
      if (status === "SUBSCRIBED") {
        retry = 0;
        await channel.track(self);
        // announce current position so peers place us immediately
        channel.send({ type: "broadcast", event: "move", payload: { id: userId, x: self.x, y: self.y } });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (closed) return;
        const delay = Math.min(1000 * 2 ** retry, 8000);
        retry++;
        console.warn(`[realtime ${channelName}] retrying in ${delay}ms`);
        try { supabase.removeChannel(channel); } catch {}
        setTimeout(() => { if (!closed) rebuild(); }, delay);
      }
    });
  }

  rebuild();

  return {
    move(x, y) {
      self = { ...self, x, y };
      if (!channel) return;
      channel.send({ type: "broadcast", event: "move", payload: { id: userId, x, y } });
      const now = performance.now();
      if (now - lastTrack > 1000) { lastTrack = now; channel.track(self); }
    },
    leave() {
      closed = true;
      if (channel) { try { supabase.removeChannel(channel); } catch {} }
    },
  };
}
