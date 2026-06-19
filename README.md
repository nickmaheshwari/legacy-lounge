# Legacy League

A Club-Penguin-style 2D social hangout game. Sign up, walk a shared map, chat (server-wide + PMs), play mini-games.

## Stack
- **Client**: static vanilla-JS (ES modules), no build step → GitHub Pages.
- **Backend**: Supabase (Auth, Postgres, Realtime). $0 free tier.

See `CLAUDE.md` for architecture + conventions, `docs/` for design.

## Local dev
1. Create a Supabase project (free). Grab the project URL + anon key.
2. `cp public/src/config.example.js public/src/config.js` and fill in the URL + anon key.
3. Apply DB schema: `npx supabase link` then `npx supabase db push` (or run the SQL in `supabase/migrations/` via the Supabase SQL editor).
4. Serve the client locally:
   ```sh
   cd public && python3 -m http.server 8000
   ```
   Open http://localhost:8000

## Deploy
GitHub Actions publishes `public/` to Pages on push to `main`. See `.claude/skills/deploy-pages`.

## Security
- Client uses the Supabase **anon key only** (public-safe; Row Level Security protects data).
- Service-role key never touches the client. Every table has RLS.
