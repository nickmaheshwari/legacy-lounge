# Legacy League — Requirements

Living doc. Filled during requirements gathering.

## Vision
Club-Penguin-style 2D social hangout. Sign up → walk a shared map → chat + PMs → play mini-games.

## Decided
- Hosting: GitHub Pages (client) + Supabase (backend). $0 to start.
- Auth phase 1: anyone can sign up, unique username only (no email verify / real auth yet). Real auth later.
- Realtime: broadcast/presence for movement; Postgres+Realtime for chat/PMs.

## Open questions (gather)
- Art style + perspective (top-down? 2.5D? sprite vs simple shapes for MVP?)
- Map: single room or multiple zones?
- Avatar: customization? colors/items?
- Movement: click-to-move or WASD?
- Mini-games for MVP: which 1–2 first?
- Chat: moderation/filter? message length, rate limit?
- Target device: desktop, mobile, both?

## MVP scope (TBD after gathering)
