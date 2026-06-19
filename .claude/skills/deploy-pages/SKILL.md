---
name: deploy-pages
description: Deploy the Legacy League static client to GitHub Pages. Use when publishing the client, debugging the deploy, or setting up Pages hosting.
---

# Deploy to GitHub Pages

Client is static (`public/`). No build step. A GitHub Action generates `config.js` and publishes `public/` on every push to `main`.

## How it works (`.github/workflows/pages.yml`)
1. Triggers on push to `main`.
2. Runs `scripts/gen-config.sh` with `SUPABASE_URL` / `SUPABASE_ANON_KEY` from repo **Secrets** → writes `public/src/config.js` (anon key only; public-safe).
3. `actions/upload-pages-artifact` with `path: public`, then `actions/deploy-pages`.

## First-time / required setup
- Repo **Settings → Pages → Source = "GitHub Actions"**. This is mandatory.
  - The legacy **"Deploy from a branch"** mode publishes the repo root, which has NO generated `config.js` (it's gitignored) — the site then serves the README or 404s and the app dies. If you see the wrong content live, check this first (`gh api repos/<owner>/<repo>/pages` → `build_type` should be `workflow`, not `legacy`).
- Add repo **Secrets** `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions → Secrets).

## Config injection
- `config.js` is generated, never committed (gitignored). `gen-config.sh` reads `.env` locally or env vars in CI, and **trims CR/LF** (a trailing newline in a secret once produced an invalid JS string literal that broke the whole client).
- Values are public-safe: the anon key ships to browsers by design; RLS protects data. The service-role key must never appear in the client, repo, or Pages artifact.

## Verify a deploy
- `curl -s https://<owner>.github.io/<repo>/src/config.js` → 3 clean lines, parses as JS (no stray newline before the closing quote).
- The index should reference the game canvas, not render the README.

## Checklist
- [ ] Pages Source = GitHub Actions (build_type `workflow`)
- [ ] Repo Secrets `SUPABASE_URL` + `SUPABASE_ANON_KEY` set
- [ ] Only `public/` published; no `.env`, no service-role key
- [ ] Deployed `config.js` is valid + anon-key-only
