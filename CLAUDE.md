# Legacy League

Club-Penguin-style 2D social hangout game. Players sign up, walk a shared map, chat (server-wide + PMs), play mini-games.

## Stack
- **Client**: static HTML/CSS/vanilla JS (ES modules), hosted on **GitHub Pages**. No build step (keep it that way unless a real need appears).
- **Backend**: **Supabase** — Auth, Postgres, Realtime. No custom server.
- **Realtime model**:
  - Movement + presence → Realtime *broadcast/presence* channels (ephemeral, low-latency, no DB write per move).
  - Chat + PMs → Postgres tables + Realtime *postgres_changes* subscriptions (persisted, RLS-guarded).

## Layout
- `public/` — everything served by Pages. `index.html` entry. `src/` JS modules, `assets/` art/audio.
- `supabase/migrations/` — SQL schema, RLS policies. Source of truth for DB.
- `docs/` — design notes, requirements, decisions.
- `.claude/skills/` — repeatable project tasks (see below).

## Conventions
- Vanilla JS ES modules, no framework, no bundler. Import via relative paths.
- All DB access from client uses the Supabase anon key (safe — RLS enforces access). **Never** put service-role key in client code.
- Every table has RLS enabled. No table ships without policies.
- Secrets in `.env` (gitignored). `.env.example` lists required vars. Client reads only `SUPABASE_URL` + `SUPABASE_ANON_KEY` (these are public-safe).
- Keep modules small + single-purpose: `auth.js`, `realtime.js`, `chat.js`, `world.js`, etc.

## Security rules (non-negotiable)
- Anon key only in client. Service-role key never leaves server/CI.
- Trust no client input — validate via RLS policies + DB constraints/triggers.
- Usernames unique, enforced by DB constraint, not just client check.

## Workflow
- DB change → write a migration in `supabase/migrations/`, never hand-edit prod.
- Skills in `.claude/skills/` cover: new DB table+RLS, new mini-game, deploy to Pages. Use them.
- Keep this file lean. Deep detail lives in `docs/`, linked when needed.

## Status
Pre-alpha. Scaffolding phase. See `docs/requirements.md` for current scope.
