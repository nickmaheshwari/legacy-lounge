-- profiles: one row per player, linked to auth.users.
-- Username uniqueness is enforced HERE (DB), not in client code.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null,
  created_at  timestamptz not null default now(),
  constraint username_unique unique (username),
  constraint username_format check (char_length(username) between 3 and 20
                                    and username ~ '^[A-Za-z0-9_]+$')
);

alter table public.profiles enable row level security;

-- Anyone signed in can read profiles (needed to show usernames in chat/world).
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

-- A user may insert only their own profile row.
create policy "users insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- A user may update only their own profile.
create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Profiles are visible in realtime (e.g. presence join messages).
alter publication supabase_realtime add table public.profiles;
