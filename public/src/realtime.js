// Realtime room. Presence carries identity (id/username/avatar) + spawn so we
// know WHO is in the room; live movement goes over BROADCAST events, which
// propagate reliably to already-connected clients (presence re-track updates do
// not always re-fire 'sync' on peers). We also re-track on move so late joiners
// get everyone's current position from the presence snapshot.
import { supabase } from "./supabase.js";

export function joinRoom({ channel: channelName = "room:lounge", userId, username, avatar, spawn, onPresence, onMove }) {
  const channel = supabase.channel(channelName, {
    config: { presence: { key: userId }, broadcast: { self: false } },
  });

  let self = { id: userId, username, avatar, x: spawn.x, y: spawn.y };

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState();
    const players = Object.values(state).map((metas) => metas[0]).filter(Boolean);
    onPresence(players);
  });

  channel.on("broadcast", { event: "move" }, ({ payload }) => {
    if (payload && payload.id !== userId) onMove(payload);
  });

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") await channel.track(self);
  });

  return {
    move(x, y) {
      self = { ...self, x, y };
      channel.send({ type: "broadcast", event: "move", payload: { id: userId, x, y } });
      channel.track(self); // keep presence position fresh for late joiners
    },
    leave() { channel.unsubscribe(); },
  };
}
