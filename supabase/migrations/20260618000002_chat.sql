-- Server-wide chat + private messages.
-- Username is denormalized onto chat rows so realtime payloads render without a
-- join/lookup. user_id is the real identity used by RLS.

-- ---------- server-wide chat ----------
create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  username    text not null,
  content     text not null check (char_length(content) between 1 and 280),
  created_at  timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

create policy "chat readable by authenticated"
  on public.chat_messages for select
  to authenticated using (true);

create policy "users post own chat"
  on public.chat_messages for insert
  to authenticated with check (auth.uid() = user_id);
-- no update/delete: chat is immutable for MVP.

alter publication supabase_realtime add table public.chat_messages;

-- ---------- private messages ----------
create table if not exists public.private_messages (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null references auth.users (id) on delete cascade,
  recipient_id  uuid not null references auth.users (id) on delete cascade,
  sender_name   text not null,
  content       text not null check (char_length(content) between 1 and 280),
  read          boolean not null default false,
  created_at    timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

alter table public.private_messages enable row level security;

-- Only the two parties can read a PM.
create policy "pm readable by participants"
  on public.private_messages for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- Only the sender can create, and only as themselves.
create policy "users send own pm"
  on public.private_messages for insert
  to authenticated
  with check (auth.uid() = sender_id);

-- Recipient may flag a PM read (only the read column matters; restrict to recipient).
create policy "recipient marks pm read"
  on public.private_messages for update
  to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

alter publication supabase_realtime add table public.private_messages;

create index if not exists pm_recipient_idx on public.private_messages (recipient_id, created_at desc);
create index if not exists pm_sender_idx on public.private_messages (sender_id, created_at desc);
create index if not exists chat_created_idx on public.chat_messages (created_at desc);
