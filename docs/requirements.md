# Legacy League — Requirements & Decisions

Living doc. Vision + the decisions behind the architecture, and what's shipped vs deferred. For *how it's built*, see `architecture.md`.

## Vision
Club-Penguin-style 2D social hangout. Sign up as an animal → walk between rooms → chat + PMs → play games (some for in-game cash).

## Decisions (and why)
- **Hosting: GitHub Pages (client) + Supabase (backend).** Chosen for low latency (WebSocket Realtime), low maintenance (managed, no server to run), strong security (managed Auth + Row Level Security), and $0 cost at this scale. Firebase was rejected on cost predictability; a custom Node/WS server on operational burden.
- **Static client, no build step.** Maximum simplicity; libs via esm.sh.
- **Auth phase 1:** username + password via Supabase Auth using a synthetic email (`<user>@players.legacyleague.local`); unique username DB-enforced. No email verification yet.
- **Rendering:** Canvas 2D, no engine, room-generic. Logical 1280×720, camera scales to fit.
- **Movement:** WASD/arrows + click-to-move. Live movement over Realtime *broadcast*; presence carries identity.
- **Realtime split:** presence/broadcast for movement; postgres_changes for chat/PMs/chess.
- **Stakes are server-authoritative.** Cash and gambling outcomes are computed in Postgres RPCs; the `cash` column is not client-writable.

## Shipped
1. **World** — Canvas room engine; WASD + click movement; animal avatars (dog/cat/capybara) chosen at signup; see others move in real time via presence/broadcast; aristocrat-lounge art (hearth, rug, portraits) drawn programmatically.
2. **Rooms** — Two zones: **The Lounge** and the **High Roller's Room**, connected by clickable exit arrows; each room has its own presence channel.
3. **Chat** — server-wide chat panel (persisted) + `/pm <user> <msg>` direct messages.
4. **Chess** (Lounge) — `chess.js` rules, clickable board overlay, 2 seats + spectators, synced via `chess_games.fen`, resign/checkmate/draw.
5. **Cash** — every player starts at **$500** (`profiles.cash`), shown in the header, mutated only by server RPCs.
6. **Gambling** (High Roller's Room), max bet **$10**:
   - **Blackjack** — server deals/hits/stands and settles (3:2 on naturals) via `bj_*` RPCs; hand state in `blackjack_hands`.
   - **Roulette** — European single-zero; server spins + pays (`play_roulette`); red/black/even/odd/low/high at 1:1, straight number at 35:1.

## Deferred / backlog
- Harden chess seat-claim race; optional server-side chess move re-validation (edge function).
- More rooms / scrolling maps; more mini-games (sled race, fishing) via the `new-minigame` skill.
- Avatar customization beyond species; real sprite art.
- Real auth (email verify / OAuth); chat moderation / profanity filter / stronger rate limits.
- Roulette wheel-spin animation; sounds; gambling history / leaderboard.
- Mobile touch controls.

## Operational notes
- Run/test live needs a Supabase project: put `SUPABASE_URL` + anon key in `.env`, run `./scripts/dev.sh`. Apply `supabase/setup.sql` (fresh) or the latest migration (existing), then `NOTIFY pgrst, 'reload schema';`. Turn **off** Auth → Email → "Confirm email" so signup works without an inbox.
