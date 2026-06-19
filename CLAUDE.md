# Legacy League

Club-Penguin-style 2D social hangout game. Players sign up as an animal avatar, walk between rooms, chat (server-wide + PMs), and play games (chess in the Lounge; blackjack + roulette in the High Roller's Room, played with in-game cash).

For the full picture read `docs/architecture.md`. This file is the lean orientation.

## Stack
- **Client**: static HTML/CSS/vanilla JS (ES modules, no framework, no bundler, **no build step**), served by **GitHub Pages**. Third-party libs (`@supabase/supabase-js`, `chess.js`) load from the esm.sh CDN as ES modules.
- **Backend**: **Supabase** — Auth, Postgres, Realtime. No custom server.
- **Realtime model** (two distinct mechanisms — don't confuse them):
  - **Presence + broadcast** (`realtime.js`) → who is in a room + live avatar movement. Ephemeral, per-room channel `room:<id>`. Movement rides *broadcast* events; presence carries identity + spawn. No DB write per move.
  - **postgres_changes** → chat, PMs, and chess sync. Persisted Postgres rows + Realtime table subscriptions, all RLS-guarded.

## Module map (`public/src/`)
- `main.js` — entry. Auth screen ↔ game screen; owns the current room, the cash value in the header, and opening/closing game overlays.
- `supabase.js` — the singleton Supabase client (reads `config.js`).
- `config.js` — **generated** from `.env`/CI by `scripts/gen-config.sh`. Never edit by hand; it's gitignored. `config.example.js` is the committed template.
- `auth.js` — username+password signup/login. Username → synthetic email so we can use Supabase email auth without collecting emails. Avatar chosen at signup.
- `realtime.js` — `joinRoom({channel, onPresence, onMove, ...})`. One channel, listeners attached once, `subscribe()` once; the Supabase client owns reconnection (never re-subscribe an instance — Phoenix throws).
- `world.js` — the room-**generic** canvas engine. `startWorld({canvas, userId, username, avatar, room, onExit})`. Owns camera (DPR-aware "contain" scaling), input (WASD + click-to-move), the render loop, avatar drawing, and exit/hotspot hit-testing. Exports `WORLD_W`/`WORLD_H` (logical 1280×720).
- `rooms.js` — `buildRooms({openChess, openBlackjack, openRoulette})` returns room descriptors (Lounge, High Roller's Room): scene art + exits + hotspots. All room-specific drawing lives here, not in the engine.
- `chat.js` — server-wide chat + `/pm <user> <msg>` direct messages.
- `minigames/registry.js` — lazy `import()` map of game id → module.
- `minigames/<game>/index.js` — a game overlay. Contract: `meta`, `mount(container, ctx)`, `unmount()`. See the `new-minigame` skill.

## Database (`supabase/migrations/`, source of truth)
Tables: `profiles` (username unique, avatar, **cash**), `chat_messages`, `private_messages`, `chess_games`, `chess_moves`, `blackjack_hands`. Gambling RNG + payouts are **server-side** SECURITY DEFINER RPCs: `bj_start`/`bj_hit`/`bj_stand`, `play_roulette`. `supabase/setup.sql` is a generated bundle of all migrations for one-paste setup.

## Conventions
- Vanilla JS ES modules, relative imports. Keep modules small + single-purpose.
- Logical world coords are 1280×720; the camera scales to fit. New rooms reuse the engine via a descriptor in `rooms.js` — don't fork `world.js`.
- DB change → **new migration** in `supabase/migrations/`, then regenerate `supabase/setup.sql` (concatenate all migrations in order). Never hand-edit prod.

## Security rules (non-negotiable)
- Client uses the Supabase **anon key only** (public-safe; RLS protects data). Service-role key never touches client or git.
- Every table has RLS enabled with explicit policies. No table ships without them.
- Trust no client input. Invariants live in DB constraints; writes are tied to `auth.uid()`.
- **Anything with stakes is server-authoritative.** Cash is the model: the `cash` column has UPDATE *revoked* from anon/authenticated, so only SECURITY DEFINER functions (which run as table owner) can change it. The client picks a bet ≤ $10 and an action; the server does the RNG and the payout. Apply this pattern to any future scored/valued feature.

## Workflow
- Run locally: `./scripts/dev.sh` (generates `config.js` from `.env`, serves `public/` on :8000). See `README.md`.
- Deploy: push to `main`; GitHub Actions builds `config.js` from repo Secrets and publishes `public/` to Pages. Pages Source must be **GitHub Actions** (not "deploy from a branch"). See the `deploy-pages` skill.
- Skills in `.claude/skills/`: `db-table` (new RLS table), `new-minigame` (new game overlay), `deploy-pages`. Use them.

## Status
Playable. Shipped: multi-room world (Lounge + High Roller's Room), WASD + click movement, animal avatars, presence/broadcast multiplayer, chat + PMs, chess, server-authoritative blackjack + roulette with cash. See `docs/requirements.md` for what's shipped vs deferred.
