---
name: new-minigame
description: Scaffold a new mini-game module for Legacy League with a consistent lifecycle (mount/unmount, score submit). Use when adding any mini-game (e.g. sled race, memory match, fishing).
---

# Add a mini-game

Mini-games are self-contained ES modules under `public/src/minigames/<name>/`. The world launches them in an overlay and tears them down cleanly.

## Contract
Each mini-game exports:
```js
export const meta = { id, title, maxPlayers };
export function mount(container, ctx) { /* returns nothing; render into container */ }
export function unmount() { /* remove listeners, timers, DOM */ }
```
`ctx` provides: `{ supabase, user, onScore(score) }`.

## Steps
1. `public/src/minigames/<name>/index.js` implementing the contract.
2. Game logic in same folder; keep it framework-free.
3. On game end, call `ctx.onScore(score)`. Score persistence goes through the `minigame_scores` table — use the `db-table` skill if it doesn't exist yet. NEVER trust a raw client score for anything ranked; validate server-side (DB trigger/edge function) if stakes exist.
4. Register the game in `public/src/minigames/registry.js`.
5. Always implement `unmount` fully — remove every event listener, `requestAnimationFrame`, and timer to avoid leaks across game switches.

## Checklist
- [ ] Implements mount/unmount/meta
- [ ] unmount removes ALL listeners/timers/RAF
- [ ] Score path uses RLS-guarded table
- [ ] Registered in registry.js
