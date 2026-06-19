-- Chess: a game has up to two seated players (white/black) and a move log.
-- Board state of record is `fen`; chess_moves is the authoritative history.
-- Rules are validated client-side by chess.js for MVP; RLS guarantees only a
-- seated player can move and only as themselves. Re-validation in an edge
-- function is a documented post-MVP hardening step.

create table if not exists public.chess_games (
  id          uuid primary key default gen_random_uuid(),
  white_id    uuid references auth.users (id) on delete set null,
  black_id    uuid references auth.users (id) on delete set null,
  white_name  text,
  black_name  text,
  fen         text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  turn        char(1) not null default 'w' check (turn in ('w','b')),
  status      text not null default 'waiting'
              check (status in ('waiting','active','white_won','black_won','draw','aborted')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.chess_games enable row level security;

-- Anyone authenticated can watch any game (spectate).
create policy "games readable by authenticated"
  on public.chess_games for select
  to authenticated using (true);

-- Anyone authenticated can create a game (they become a player via update/seat).
create policy "users create games"
  on public.chess_games for insert
  to authenticated with check (true);

-- Updating a game (seat claim, fen/turn/status advance) is restricted:
--  - a seated player may update, OR
--  - a user may claim an empty seat (white_id/black_id currently null).
-- Fine-grained per-column control isn't expressible in a single policy; the
-- client only writes legal transitions and RLS blocks non-participants from
-- mutating an in-progress game once both seats are filled.
create policy "players or seat-claimers update games"
  on public.chess_games for update
  to authenticated
  using (
    auth.uid() = white_id
    or auth.uid() = black_id
    or white_id is null
    or black_id is null
  )
  with check (
    auth.uid() = white_id
    or auth.uid() = black_id
  );

alter publication supabase_realtime add table public.chess_games;

-- ---------- move log ----------
create table if not exists public.chess_moves (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.chess_games (id) on delete cascade,
  mover_id    uuid not null references auth.users (id) on delete cascade,
  ply         integer not null,
  san         text not null,
  uci         text not null,
  fen_after   text not null,
  created_at  timestamptz not null default now(),
  unique (game_id, ply)
);

alter table public.chess_moves enable row level security;

create policy "moves readable by authenticated"
  on public.chess_moves for select
  to authenticated using (true);

-- A move may only be inserted by its own mover, and only by someone seated in
-- that game.
create policy "seated players insert own moves"
  on public.chess_moves for insert
  to authenticated
  with check (
    auth.uid() = mover_id
    and exists (
      select 1 from public.chess_games g
      where g.id = game_id
        and (g.white_id = auth.uid() or g.black_id = auth.uid())
    )
  );

alter publication supabase_realtime add table public.chess_moves;

create index if not exists moves_game_idx on public.chess_moves (game_id, ply);

-- keep updated_at fresh on games
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chess_games_touch on public.chess_games;
create trigger chess_games_touch
  before update on public.chess_games
  for each row execute function public.touch_updated_at();
