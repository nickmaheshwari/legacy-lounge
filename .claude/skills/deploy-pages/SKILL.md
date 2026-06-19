---
name: deploy-pages
description: Deploy the Legacy League static client to GitHub Pages. Use when publishing the client or setting up Pages hosting for the first time.
---

# Deploy to GitHub Pages

Client is static (`public/`). No build step. Pages serves it directly.

## First-time setup
1. Create GitHub repo, push `main`.
2. Pages source options (pick one):
   - **`/docs` or `/public` folder on main**: Pages can't serve arbitrary subfolders except `/docs` or root. Simplest: use the GitHub Actions Pages workflow (below) to publish `public/`.
   - **Actions workflow** (preferred): `.github/workflows/pages.yml` uploads `public/` as the Pages artifact. Lets us keep source in `public/` without restructuring.
3. In repo Settings → Pages → Source = GitHub Actions.

## Actions workflow
Create `.github/workflows/pages.yml` that:
- triggers on push to `main`
- uses `actions/upload-pages-artifact` with `path: public`
- deploys with `actions/deploy-pages`

## Config injection
`SUPABASE_URL` + `SUPABASE_ANON_KEY` are public-safe but shouldn't be hardcoded in source history churn. Options:
- Commit a `public/src/config.js` with the anon values (acceptable — they're public, RLS protects data), OR
- Generate `config.js` in the Actions workflow from repo secrets/vars before upload.

## Checklist
- [ ] Only `public/` is published (no .env, no service-role key)
- [ ] Pages source = GitHub Actions
- [ ] config.js has anon key only, never service-role
