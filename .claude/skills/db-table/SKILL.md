---
name: db-table
description: Create a new Postgres table for Legacy League with RLS enabled and policies. Use whenever adding persistent data (chat, pms, profiles, minigame scores, inventory). Ensures no table ships without RLS.
---

# Add a DB table (with RLS)

Goal: every table is RLS-protected and created via migration. Never hand-edit prod.

## Steps
1. Create a migration file: `supabase/migrations/<UTC-timestamp>_<name>.sql`.
   Timestamp format `YYYYMMDDHHMMSS`. Ask the user for current time if unsure, or use a monotonic increment after the latest existing migration.
2. In the migration:
   - `create table` with `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`.
   - Add `user_id uuid references auth.users(id)` for user-owned rows.
   - Add DB constraints for invariants (e.g. `unique` on username). Do NOT rely on client validation.
   - `alter table <t> enable row level security;`
   - Write explicit policies. Default deny; grant the minimum:
     - SELECT: who can read (often `true` for public chat, or owner-only for PMs).
     - INSERT: `auth.uid() = user_id` so users only write as themselves.
     - UPDATE/DELETE: owner-only unless there's reason otherwise.
3. Enable Realtime if the client subscribes: `alter publication supabase_realtime add table <t>;`
4. Apply locally/remote with `npx supabase db push` (or note for the user to run it).

## Checklist before done
- [ ] RLS enabled
- [ ] INSERT policy ties row to `auth.uid()`
- [ ] No way for user A to read/modify user B's private rows
- [ ] Invariants enforced by constraints, not client
- [ ] Added to realtime publication only if needed
