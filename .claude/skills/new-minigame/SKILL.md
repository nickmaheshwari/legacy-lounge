---
name: new-minigame
description: Scaffold a new mini-game / game overlay for Legacy League with the standard mount/unmount lifecycle. Use when adding any game launched from a room (e.g. chess, blackjack, roulette, sled race).
---

# Add a mini-game

Games are self-contained ES modules under `public/src/minigames/<name>/`. A room hotspot launches them: `main.openGame(id)` mounts the module into the `#overlay` and tears it down on close.

## Contract
```js
export const meta = { id, title, maxPlayers };
export function mount(container, ctx) { /* render into container */ }
export function unmount() { /* remove ALL listeners, timers, RAF, channels */ }
```
`ctx = { supabase, user, username, startCash, onCash(newCash), close() }`
- `startCash` — the player's cash at open; `onCash(n)` — call after any payout so the header updates.
- `close()` — call to dismiss the overlay (wire a Leave button to it).
- Not every game uses cash (chess ignores `startCash`/`onCash`).

## Steps
1. Create `public/src/minigames/<name>/index.js` implementing the contract. Keep logic framework-free; render plain DOM into `container`.
2. Register it in `public/src/minigames/registry.js` (`<id>: () => import("./<name>/index.js")`).
3. Wire a launch point: add a hotspot in the relevant room in `rooms.js` whose `onEnter` is a callback passed through `buildRooms(...)` in `main.js`, and have `main.js` call `openGame("<id>")`.
4. **Stakes are server-authoritative.** If the game involves cash or any ranked score, the RNG/outcome/payout MUST run in a SECURITY DEFINER RPC (see the gambling migration + `db-table` skill). The client only sends a bet/action and reflects the server's returned `cash`. NEVER compute a balance or trust a raw client score.
5. `unmount` must remove every event listener, `requestAnimationFrame`, timer, and any Supabase channel/subscription the game created — overlays open/close repeatedly.

## Checklist
- [ ] Implements meta/mount/unmount
- [ ] Registered in registry.js
- [ ] Launched via a room hotspot → main.openGame
- [ ] unmount removes ALL listeners/timers/RAF/subscriptions
- [ ] Any stakes handled by a server-side RPC; cash reflected via onCash (never written client-side)
