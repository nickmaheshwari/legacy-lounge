// Realtime room. Presence = who's here (identity + spawn). Live movement =
// broadcast events. One channel, listeners attached once before subscribe(),
// subscribe() once. The underlying socket auto-reconnects on its own — do NOT
// remove/rebuild the channel from inside the status callback (that recurses).
import { supabase } from "./supabase.js";

export function joinRoom({ channel: channelName = "room:lounge", userId, username, avatar, spawn, onPresence, onMove }) {
  let subscribed = false;
  let lastTrack = 0;
  let self = { id: userId, username, avatar, x: spawn.x, y: spawn.y };

  const channel = supabase.channel(channelName, {
    config: { presence: { key: userId }, broadcast: { self: false } },
  });

  const syncPresence = () => {
    const state = channel.presenceState();
    onPresence(Object.values(state).map((m) => m[0]).filter(Boolean));
  };
  channel.on("presence", { event: "sync" }, syncPresence);
  channel.on("presence", { event: "join" }, syncPresence);
  channel.on("presence", { event: "leave" }, syncPresence);
  channel.on("broadcast", { event: "move" }, ({ payload }) => {
    if (payload && payload.id !== userId) onMove(payload);
  });

  channel.subscribe(async (status) => {
    console.log(`[realtime ${channelName}] ${status}`);
    if (status === "SUBSCRIBED") {
      subscribed = true;
      await channel.track(self);
    } else if (status === "CLOSED") {
      subscribed = false;
    }
  });

  return {
    move(x, y) {
      self = { ...self, x, y };
      if (!subscribed) return; // avoid REST fallback before the socket is ready
      channel.send({ type: "broadcast", event: "move", payload: { id: userId, x, y } });
      const now = performance.now();
      if (now - lastTrack > 1000) { lastTrack = now; channel.track(self); }
    },
    leave() {
      subscribed = false;
      supabase.removeChannel(channel);
    },
  };
}
