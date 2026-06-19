# Legacy League — Architecture

Deep reference for developers and AI agents. `CLAUDE.md` is the short version; this is the detail. Keep both in sync with the code when you change architecture.

## 1. Big picture

```
Browser (static client, GitHub Pages)                 Supabase (managed)
┌─────────────────────────────────────────┐           ┌──────────────────────────┐
│ index.html                               │           │ Auth (email/password)    │
│  └ main.js  (screens, room, cash, overlays)          │ Postgres + RLS           │
│      ├ auth.js      → Auth               │  HTTPS    │  profiles, chat_messages,│
│      ├ world.js     → canvas engine      │ ───────►  │  private_messages,       │
│      │   └ rooms.js  (scene/exits/spots) │           │  chess_games/_moves,     │
│      ├ realtime.js  → presence+broadcast │  WSS      │  blackjack_hands         │
│      ├ chat.js      → postgres_changes   │ ◄──────►  │ Realtime (presence,      │
│      └ minigames/*  → overlays + RPCs    │           │  broadcast, CDC)         │
│        supabase.js (singleton client)    │           │ RPCs (SECURITY DEFINER)  │
└─────────────────────────────────────────┘           └──────────────────────────┘
```

No application server. The browser talks straight to Supabase with the **anon key**; Row Level Security is the security boundary.

## 2. Why these choices
- **Static + GitHub Pages + Supabase** = $0 to run, low latency (Realtime is WebSocket), low maintenance (no server to operate), and security via managed Auth + RLS. See the decision trail in `requirements.md`.
- **No build step** keeps the client trivially deployable and debuggable. Libraries come from esm.sh as native ES modules. Don't add a bundler without a real need.

## 3. Client startup flow (`main.js`)
1. On load, `currentUser()` checks for an existing Supabase session.
2. Signed in → `enterGame(user)`: load profile (`username`, `avatar`, `cash`), show the game screen, build rooms, enter the Lounge, start chat.
3. Not signed in → show the auth screen. Submitting calls `signUp`/`logIn` then `enterGame`.
4. A global error banner (`#err-banner`) surfaces uncaught errors/rejections on-screen (so failures after the screen switch aren't invisible).

## 4. World engine (`world.js`) — room-generic
`startWorld({ canvas, userId, username, avatar, room, onExit })` returns `{ stop() }`.

Responsibilities (room-independent):
- **Camera**: logical world is `WORLD_W×WORLD_H` (1280×720). Each frame it computes a DPR-aware "contain" transform (scale + letterbox) so the scene fills the canvas crisply at any size without stretching. Pointer coords are inverse-mapped through the same transform.
- **Input**: WASD/arrows (continuous) and click-to-move (walk toward a target). Either cancels the other.
- **Self vs others**: your avatar (`me`) is simulated locally for snappy input. Other players are interpolated toward their last known position. Depth-sorted by `y`.
- **Publishing**: position is pushed to peers via `realtime.js` on a throttle (~8/sec while moving) plus a final update on stop — keeps Realtime traffic well under free-tier caps.
- **Exits & hotspots**: hit-tested on click. Exits call `onExit(targetRoomId)`; hotspots call their `onEnter()` only when the player is within range.
- **Avatars**: drawn programmatically (no sprite assets) per `avatar` type (dog/cat/capybara), with shadow, walk-bob, facing, and a nameplate.

The engine never contains room-specific art or game launching — that comes from the `room` descriptor.

## 5. Rooms (`rooms.js`)
`buildRooms({ openChess, openBlackjack, openRoulette })` returns `{ lounge, highroller }`. A **room descriptor**:
```js
{
  id, title,
  channel,            // realtime presence/broadcast topic, e.g. "room:lounge"
  floorY,             // y where the wall meets the floor (movement clamp)
  spawn: { x, y },
  drawScene(ctx, t),  // all background art for this room (t = seconds elapsed)
  exits:    [{ x, y, dir, label, target, r }],         // click → onExit(target)
  hotspots: [{ x, y, r, range, onEnter }],             // click within range → onEnter()
}
```
To add a room: write a descriptor (scene draw + exits + hotspots), wire it into `buildRooms`, and point an exit at it. The engine handles everything else.

## 6. Realtime model (`realtime.js`)
`joinRoom({ channel, userId, username, avatar, spawn, onPresence, onMove })` returns `{ move(x,y), leave() }`.

- **Presence** answers "who is here" — keyed by `userId`, payload carries identity + spawn. `onPresence(list)` fires on sync/join/leave; the engine creates new players at their presence position.
- **Broadcast** carries live movement (`{id, x, y}`); `onMove` updates a known player's target. Broadcast is used (not presence re-track) because presence updates don't reliably re-fire on peers and broadcast is lower-latency.
- **One channel per instance**: listeners attached once, `subscribe()` once. The Supabase RealtimeClient owns reconnection — on a socket drop it re-joins and re-fires `SUBSCRIBED`, where we re-`track()`. **Never** call `channel.subscribe()` twice on one instance (Phoenix: "tried to join multiple times") and never `removeChannel()` from inside the status callback (recurses). `leave()` (room switch / logout) is the only intentional teardown.

Chat/PMs/chess use their **own** channels via `postgres_changes`, independent of the room channel.

## 7. Minigame overlays (`minigames/`)
Lazy-loaded via `registry.js`. Launched by a room hotspot → `main.openGame(id)`, which mounts the module into the `#overlay` and passes `ctx`. Contract:
```js
export const meta = { id, title, maxPlayers };
export function mount(container, ctx) {}   // render into container
export function unmount() {}               // remove ALL listeners/timers/RAF/subscriptions
// ctx = { supabase, user, username, startCash, onCash(newCash), close() }
```
- **chess** — rules via `chess.js` (CDN). Board of record is `chess_games.fen`; both players write moves, everyone (incl. spectators) renders from the synced fen. `chess_moves` is the history. Seats: first to sit is White, second Black; status goes `waiting → active → *_won/draw`.
- **blackjack / roulette** — UI only. They call RPCs and reflect the returned `cash` via `onCash`. They never compute outcomes or balances locally.

## 8. Data + security model
Tables (all RLS-enabled; see migrations for exact policies):

| Table | Purpose | Read | Write |
|---|---|---|---|
| `profiles` | username (unique), avatar, **cash** | any authed | own row; `cash` column **revoked** (RPC-only) |
| `chat_messages` | server-wide chat | any authed | insert own (`auth.uid()=user_id`); immutable |
| `private_messages` | DMs | sender or recipient only | sender inserts; recipient may mark read |
| `chess_games` / `chess_moves` | chess state + history | any authed (spectate) | seated players only |
| `blackjack_hands` | server-owned hand state | own rows | **no** client policies — RPC-only |

**Server-authoritative pattern (important):** gambling RNG and payouts run inside SECURITY DEFINER functions (`bj_start`, `bj_hit`, `bj_stand`, `play_roulette`) that execute as the table owner and bypass the `cash` column revoke. The client only chooses a bet (≤ $10) and an action. Reuse this whenever a feature has stakes — never let the client write a score/balance directly.

## 9. Config & deploy
- `config.js` is generated from `.env` (local) or repo Secrets (CI) by `scripts/gen-config.sh`. It contains only the public-safe URL + anon key. `gen-config.sh` trims CR/LF (a stray newline in a secret once produced an invalid JS string).
- CI (`.github/workflows/pages.yml`) generates `config.js` from `secrets.SUPABASE_URL`/`SUPABASE_ANON_KEY` and publishes `public/`. **Pages Source must be "GitHub Actions"** — the legacy "deploy from a branch" mode serves the repo root (no generated `config.js`) and breaks the app.
- DB: apply migrations via the Supabase SQL Editor (paste `setup.sql` for a fresh project, or the single new migration for an existing one), then `NOTIFY pgrst, 'reload schema';` so new RPCs are visible immediately.

## 10. Known limitations / future hardening
- **Chess seat-claim race**: two users clicking simultaneously can both grab a seat (RLS allows seat claims). Not yet hardened.
- **Chess anti-cheat**: moves validated client-side (chess.js) and stored; no server re-validation. Low stakes. An edge function could re-validate against FEN.
- No chat moderation / profanity filter / strong rate limits yet.
- Avatars are vector-drawn; no sprite art or customization beyond species.
