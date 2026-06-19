---
name: db-table
description: Create or change Legacy League's Postgres schema via a migration with RLS. Use whenever adding persistent data (chat, pms, profiles, scores, inventory) or sensitive/server-authoritative state. Ensures nothing ships without RLS.
---

# Add/change a DB table (with RLS)

Goal: every table is RLS-protected and every schema change is a migration. Never hand-edit prod.

## Steps
1. Create `supabase/migrations/<timestamp>_<name>.sql`. Timestamp `YYYYMMDDHHMMSS`; increment past the latest existing file (they currently use the `2026061800000N` series).
2. In the migration:
   - `create table` with `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`.
   - `user_id uuid references auth.users(id) on delete cascade` for user-owned rows.
   - Enforce invariants with DB constraints/`check`/`unique` (e.g. unique username) — NOT client validation.
   - `alter table <t> enable row level security;`
   - Explicit policies, default-deny, minimum grant:
     - SELECT: who can read (`true` for public chat; participants-only for PMs).
     - INSERT: `with check (auth.uid() = user_id)` so users write only as themselves.
     - UPDATE/DELETE: owner-only unless there's a reason.
   - If the client subscribes via Realtime: `alter publication supabase_realtime add table <t>;`
3. **Sensitive / valued columns or state (server-authoritative pattern):** if a value has stakes (cash, ranked score), do NOT let the client write it:
   - Revoke the column: `revoke update (<col>) on <t> from anon, authenticated;`
   - Or give the table no client write policies at all (like `blackjack_hands`).
   - Mutate it only inside `security definer set search_path = public` functions (they run as table owner and bypass the revoke). `grant execute` those functions to `authenticated`. The client calls the RPC; the server does the logic. See `20260618000005_gambling.sql` for the reference implementation.
4. **Regenerate the bundle:** rebuild `supabase/setup.sql` by concatenating all migrations in order (it's the one-paste setup for a fresh project).
5. **Apply it:** paste the new migration (existing project) or `setup.sql` (fresh project) into the Supabase SQL Editor and Run, then `NOTIFY pgrst, 'reload schema';` so new tables/RPCs appear in the API immediately.

## Checklist
- [ ] RLS enabled with explicit policies
- [ ] INSERT ties row to `auth.uid()`; no cross-user read/write of private rows
- [ ] Invariants enforced by constraints, not client
- [ ] Sensitive values RPC-only (column revoked / no client write policy)
- [ ] Realtime publication added only if the client subscribes
- [ ] `setup.sql` regenerated; schema reloaded (`NOTIFY pgrst, 'reload schema'`)
