# Legacy League — Requirements

Living doc.

## Vision
Club-Penguin-style 2D social hangout. Sign up → walk a shared room → chat + PMs → play chess.

## Decided
- Hosting: GitHub Pages (client) + Supabase (backend). $0 to start.
- Auth phase 1: username + password via Supabase Auth (synthetic email), unique username DB-enforced. No email verify yet.
- Rendering: **Canvas 2D**, no engine, no build step.
- World: **single shared room** (one presence channel).
- Movement: **click-to-move** (send target, others interpolate). WASD deferred.
- Realtime split:
  - Movement + presence → Realtime broadcast/presence (ephemeral).
  - Chat, PMs, chess → Postgres tables + Realtime postgres_changes (persisted, RLS).
- Mini-game #1: **Chess**, 2 players, others can spectate.

## MVP scope
1. **World**: canvas room, click-to-move avatar (colored circle + username label for MVP art), see other players move via presence/broadcast.
2. **Chat**: server-wide chat panel (persisted, last N messages). PMs between two users.
3. **Chess**: a board object in the room; walk to it to sit. 2 seats. `chess.js` validates legal moves client-side; moves persisted to DB and synced so both players + spectators see live board. Win/draw/resign handled.

## Chess design
- `chess.js` (CDN ESM) = rules engine (legal moves, check/mate/draw). Board rendered as clickable squares (DOM/SVG overlay over canvas).
- Tables: `chess_games` (players, FEN, status, turn), `chess_moves` (game_id, ply, move SAN/UCI). RLS: players write own moves on their turn; anyone authenticated reads (spectate).
- Anti-cheat: low stakes; client validates via chess.js, DB stores authoritative move log. Optional later: edge function re-validates each move against FEN.

## Deferred (post-MVP)
- Multiple zones, scrolling map.
- Avatar customization (colors/items).
- More mini-games (sled race, fishing) via `new-minigame` skill.
- Real auth (email verify / OAuth), moderation/profanity filter, rate limits beyond basic.
- Mobile WASD / touch joystick.

## Open / need from user
- **Supabase project**: need `SUPABASE_URL` + anon key in `public/src/config.js` to run/test live. (Create free project at supabase.com.)
- Art: MVP uses simple shapes; real sprite art TBD.
- Chat moderation/rate limit specifics TBD.
