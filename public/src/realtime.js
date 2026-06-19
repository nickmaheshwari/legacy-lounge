// Realtime room. Presence = who's here (identity + spawn). Live movement =
// broadcast events. One channel, listeners attached ONCE before subscribe().
//
// Reconnect: if the channel closes unexpectedly (socket drop), we re-call
// channel.subscribe() on the SAME channel after a backoff — we never re-add
// listeners (Supabase forbids that post-subscribe) and never removeChannel from
// the status callback (that recurses). An intentional leave() sets `closed` so
// we don't fight teardown.
import { supabase } from "./supabase.js";

export function joinRoom({ channel: channelName = "room:lounge", userId, username, avatar, spawn, onPresence, onMove }) {
  let subscribed = false;
  let closed = false;
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

  function onStatus(status) {
    console.log(`[realtime ${channelName}] ${status}`);
    if (status === "SUBSCRIBED") {
      subscribed = true;
      channel.track(self);
    } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      subscribed = false;
      if (!closed) setTimeout(() => { if (!closed) channel.subscribe(onStatus); }, 2000);
    }
  }
  channel.subscribe(onStatus);

  return {
    move(x, y) {
      self = { ...self, x, y };
      if (!subscribed) return; // avoid REST fallback before the socket is ready
      channel.send({ type: "broadcast", event: "move", payload: { id: userId, x, y } });
      const now = performance.now();
      if (now - lastTrack > 1000) { lastTrack = now; channel.track(self); }
    },
    leave() {
      closed = true;
      subscribed = false;
      supabase.removeChannel(channel);
    },
  };
}
