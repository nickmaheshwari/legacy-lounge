// Realtime room presence. One shared channel ("room:lobby") tracks every player's
// identity + target position. Click-to-move is infrequent, so we update presence
// on each click instead of streaming positions — keeps message volume well under
// the free-tier cap. Clients interpolate toward targets locally (see world.js).
import { supabase } from "./supabase.js";

const ROOM = "room:lobby";

export function joinRoom({ userId, username, color, spawn, onState }) {
  const channel = supabase.channel(ROOM, {
    config: { presence: { key: userId } },
  });

  // self state we publish via presence
  let self = { id: userId, username, color, x: spawn.x, y: spawn.y };

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState();
    // presenceState(): { key: [ {..meta..}, ... ] } — take first meta per key.
    const players = Object.values(state)
      .map((metas) => metas[0])
      .filter(Boolean);
    onState(players);
  });

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track(self);
    }
  });

  return {
    // Update our target position and republish.
    move(x, y) {
      self = { ...self, x, y };
      channel.track(self);
    },
    leave() {
      channel.unsubscribe();
    },
  };
}
