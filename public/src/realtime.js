// Realtime room. Presence = who's here (identity + spawn). Live movement =
// broadcast events. One channel, listeners attached ONCE before subscribe().
//
// Reconnect: the Supabase RealtimeClient owns socket reconnection — on a drop
// it re-joins this channel and the status callback fires SUBSCRIBED again (we
// re-track then). We must NOT call channel.subscribe() twice on one instance
// (Phoenix throws "tried to join multiple times") nor re-add listeners, so the
// status callback only updates flags.
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

  channel.subscribe((status) => {
    console.log(`[realtime ${channelName}] ${status}`);
    if (status === "SUBSCRIBED") {
      subscribed = true;
      channel.track(self); // (re)announce identity on first join and after auto-rejoin
    } else {
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
