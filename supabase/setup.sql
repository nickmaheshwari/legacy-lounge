-- Legacy League full schema. Paste into Supabase SQL Editor and Run.
-- Generated from supabase/migrations/*.sql in order.

-- ===== supabase/migrations/20260618000001_profiles.sql =====
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

-- ===== supabase/migrations/20260618000002_chat.sql =====
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

-- ===== supabase/migrations/20260618000003_chess.sql =====
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

-- ===== supabase/migrations/20260618000004_avatar.sql =====
-- Player avatar (animal) chosen at signup. Defaults to dog for any existing rows.
alter table public.profiles
  add column if not exists avatar text not null default 'dog'
  check (avatar in ('dog', 'cat', 'capybara'));

-- ===== supabase/migrations/20260618000005_gambling.sql =====
-- Gambling: cash balance + server-authoritative blackjack & roulette.
--
-- SECURITY MODEL: cash must never be set by the client (play money is still
-- worth cheating for bragging rights). So:
--   * UPDATE on the cash column is REVOKED from anon/authenticated.
--   * All cash mutations happen inside SECURITY DEFINER functions, which run as
--     the table owner and bypass that restriction. The RNG (card draws, wheel
--     spin) and payouts live entirely server-side — the client only chooses a
--     bet (<= $10) and an action (hit/stand/spin).

-- ---------- cash ----------
alter table public.profiles
  add column if not exists cash integer not null default 500 check (cash >= 0);

-- Block direct client writes to cash (other profile columns stay updatable).
revoke update (cash) on public.profiles from anon, authenticated;

-- ---------- blackjack hand state (server-owned) ----------
create table if not exists public.blackjack_hands (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  bet           integer not null check (bet between 1 and 10),
  player_cards  integer[] not null,   -- each 0..51
  dealer_cards  integer[] not null,
  status        text not null check (status in ('player_turn', 'done')),
  result        text check (result in ('blackjack','win','lose','push')),
  created_at    timestamptz not null default now()
);

alter table public.blackjack_hands enable row level security;
-- Read your own hands (for transparency). No insert/update/delete policies, so
-- the only way to mutate is via the SECURITY DEFINER functions below.
create policy "own hands readable" on public.blackjack_hands
  for select to authenticated using (auth.uid() = user_id);

-- ---------- helpers ----------
-- Blackjack total with soft-ace handling. Cards are 0..51; rank = (c % 13)+1.
create or replace function public.bj_total(cards integer[])
returns integer language plpgsql immutable as $$
declare total int := 0; aces int := 0; c int; r int;
begin
  foreach c in array cards loop
    r := (c % 13) + 1;
    if r = 1 then aces := aces + 1; total := total + 11;
    elsif r > 10 then total := total + 10;
    else total := total + r; end if;
  end loop;
  while total > 21 and aces > 0 loop total := total - 10; aces := aces - 1; end loop;
  return total;
end; $$;

create or replace function public.bj_card() returns integer
language sql volatile as $$ select floor(random() * 52)::int $$;

-- Dealer card visible to client while it's the player's turn (hole card hidden).
create or replace function public.bj_state_json(h public.blackjack_hands)
returns json language sql stable as $$
  select json_build_object(
    'hand_id', h.id,
    'bet', h.bet,
    'player', h.player_cards,
    'player_total', public.bj_total(h.player_cards),
    'dealer', case when h.status = 'done' then h.dealer_cards
                   else array[h.dealer_cards[1]] end,
    'dealer_total', case when h.status = 'done' then public.bj_total(h.dealer_cards) else null end,
    'status', h.status,
    'result', h.result,
    'cash', (select cash from public.profiles where id = h.user_id)
  );
$$;

-- ---------- blackjack: start ----------
create or replace function public.bj_start(p_amount integer)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal int; pc int[]; dc int[]; ptot int; dtot int;
        h public.blackjack_hands;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_amount < 1 or p_amount > 10 then raise exception 'bet must be 1..10'; end if;
  select cash into bal from public.profiles where id = uid for update;
  if bal is null then raise exception 'no profile'; end if;
  if bal < p_amount then raise exception 'insufficient cash'; end if;

  update public.profiles set cash = cash - p_amount where id = uid;  -- take the bet
  pc := array[bj_card(), bj_card()];
  dc := array[bj_card(), bj_card()];
  ptot := bj_total(pc); dtot := bj_total(dc);

  insert into public.blackjack_hands(user_id, bet, player_cards, dealer_cards, status)
    values (uid, p_amount, pc, dc, 'player_turn') returning * into h;

  -- naturals settle immediately
  if ptot = 21 then
    if dtot = 21 then
      update public.profiles set cash = cash + p_amount where id = uid;  -- push, return stake
      update public.blackjack_hands set status='done', result='push' where id=h.id returning * into h;
    else
      update public.profiles set cash = cash + (p_amount * 5) / 2 where id = uid; -- 3:2 incl stake
      update public.blackjack_hands set status='done', result='blackjack' where id=h.id returning * into h;
    end if;
  elsif dtot = 21 then
    update public.blackjack_hands set status='done', result='lose' where id=h.id returning * into h;
  end if;

  return bj_state_json(h);
end; $$;

-- ---------- blackjack: hit ----------
create or replace function public.bj_hit(p_hand uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h public.blackjack_hands;
begin
  select * into h from public.blackjack_hands
    where id = p_hand and user_id = uid and status = 'player_turn' for update;
  if h.id is null then raise exception 'no active hand'; end if;

  h.player_cards := h.player_cards || bj_card();
  if bj_total(h.player_cards) > 21 then
    update public.blackjack_hands set player_cards = h.player_cards, status='done', result='lose'
      where id = h.id returning * into h;
  else
    update public.blackjack_hands set player_cards = h.player_cards
      where id = h.id returning * into h;
  end if;
  return bj_state_json(h);
end; $$;

-- ---------- blackjack: stand (dealer plays, settle) ----------
create or replace function public.bj_stand(p_hand uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h public.blackjack_hands; dtot int; ptot int; res text;
begin
  select * into h from public.blackjack_hands
    where id = p_hand and user_id = uid and status = 'player_turn' for update;
  if h.id is null then raise exception 'no active hand'; end if;

  while bj_total(h.dealer_cards) < 17 loop
    h.dealer_cards := h.dealer_cards || bj_card();
  end loop;
  ptot := bj_total(h.player_cards); dtot := bj_total(h.dealer_cards);

  if dtot > 21 or ptot > dtot then res := 'win';
  elsif ptot = dtot then res := 'push';
  else res := 'lose'; end if;

  if res = 'win' then update public.profiles set cash = cash + h.bet * 2 where id = uid;
  elsif res = 'push' then update public.profiles set cash = cash + h.bet where id = uid;
  end if;

  update public.blackjack_hands set dealer_cards = h.dealer_cards, status='done', result=res
    where id = h.id returning * into h;
  return bj_state_json(h);
end; $$;

-- ---------- roulette (European single-zero) ----------
-- p_bet: 'red','black','even','odd','low','high', or a number string '0'..'36'.
create or replace function public.play_roulette(p_bet text, p_amount integer)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal int; n int; color text; win boolean := false;
        payout int := 0; straight int; mult int := 0;
        reds int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_amount < 1 or p_amount > 10 then raise exception 'bet must be 1..10'; end if;
  select cash into bal from public.profiles where id = uid for update;
  if bal < p_amount then raise exception 'insufficient cash'; end if;
  update public.profiles set cash = cash - p_amount where id = uid;  -- take the bet

  n := floor(random() * 37);  -- 0..36
  if n = 0 then color := 'green';
  elsif n = any(reds) then color := 'red';
  else color := 'black'; end if;

  if p_bet ~ '^[0-9]+$' then
    straight := p_bet::int;
    if straight < 0 or straight > 36 then raise exception 'bad number'; end if;
    if straight = n then win := true; mult := 36; end if;  -- 35:1 + stake
  else
    case p_bet
      when 'red'  then win := (color = 'red');
      when 'black' then win := (color = 'black');
      when 'even' then win := (n <> 0 and n % 2 = 0);
      when 'odd'  then win := (n % 2 = 1);
      when 'low'  then win := (n between 1 and 18);
      when 'high' then win := (n between 19 and 36);
      else raise exception 'bad bet type';
    end case;
    if win then mult := 2; end if;  -- 1:1 + stake
  end if;

  if win then payout := p_amount * mult; update public.profiles set cash = cash + payout where id = uid; end if;

  return json_build_object('number', n, 'color', color, 'win', win,
    'payout', payout, 'cash', (select cash from public.profiles where id = uid));
end; $$;

grant execute on function public.bj_start(integer), public.bj_hit(uuid),
  public.bj_stand(uuid), public.play_roulette(text, integer) to authenticated;

-- ===== supabase/migrations/20260619000006_roulette_multiplayer.sql =====
-- Shared/communal roulette: one open round at a time that everyone in the room
-- bets into and watches resolve together. Server-authoritative: RNG + payouts in
-- SECURITY DEFINER functions; cash stays RPC-only (see 20260618000005).
--
-- Lifecycle: betting (timed window) -> spinning -> done. A new round is created
-- on demand by roulette_current() once the previous one is done.

create table if not exists public.roulette_rounds (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'betting' check (status in ('betting','spinning','done')),
  result          integer,                          -- 0..36, null until spun
  betting_ends_at timestamptz not null,
  created_at      timestamptz not null default now()
);

-- At most one non-done round may exist at a time (prevents duplicate open rounds
-- under concurrent roulette_current() calls).
create unique index if not exists one_open_round
  on public.roulette_rounds ((true)) where status <> 'done';

create table if not exists public.roulette_bets (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.roulette_rounds (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  username    text not null,
  bet_type    text not null,                        -- red/black/even/odd/low/high or '0'..'36'
  amount      integer not null check (amount between 1 and 10),
  won         boolean,                              -- null until settled
  payout      integer,                              -- null until settled
  created_at  timestamptz not null default now(),
  unique (round_id, user_id)                        -- one bet per player per round
);

alter table public.roulette_rounds enable row level security;
alter table public.roulette_bets  enable row level security;

-- Everyone authed can watch rounds + bets (it's a communal table).
create policy "rounds readable" on public.roulette_rounds for select to authenticated using (true);
create policy "bets readable"   on public.roulette_bets  for select to authenticated using (true);
-- No client write policies: rounds/bets/cash mutate only via the RPCs below.

alter publication supabase_realtime add table public.roulette_rounds;
alter publication supabase_realtime add table public.roulette_bets;

create index if not exists roulette_bets_round_idx on public.roulette_bets (round_id);

-- ---------- helpers ----------
create or replace function public.roulette_is_win(p_bet text, n integer)
returns boolean language plpgsql immutable as $$
declare reds int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  if p_bet ~ '^[0-9]+$' then return p_bet::int = n; end if;
  case p_bet
    when 'red'  then return n <> 0 and n = any(reds);
    when 'black' then return n <> 0 and not (n = any(reds));
    when 'even' then return n <> 0 and n % 2 = 0;
    when 'odd'  then return n % 2 = 1;
    when 'low'  then return n between 1 and 18;
    when 'high' then return n between 19 and 36;
    else return false;
  end case;
end; $$;

create or replace function public.roulette_mult(p_bet text)
returns integer language sql immutable as $$
  select case when p_bet ~ '^[0-9]+$' then 36 else 2 end;  -- straight 35:1, outside 1:1 (incl. stake)
$$;

-- Betting window length.
create or replace function public.roulette_window() returns interval language sql immutable as $$ select interval '15 seconds' $$;

-- ---------- get-or-create the current round ----------
create or replace function public.roulette_current()
returns public.roulette_rounds language plpgsql security definer set search_path = public as $$
declare r public.roulette_rounds;
begin
  select * into r from public.roulette_rounds where status <> 'done' order by created_at desc limit 1;
  if r.id is not null then return r; end if;
  begin
    insert into public.roulette_rounds(status, betting_ends_at)
      values ('betting', now() + roulette_window()) returning * into r;
  exception when unique_violation then
    select * into r from public.roulette_rounds where status <> 'done' order by created_at desc limit 1;
  end;
  return r;
end; $$;

-- ---------- place a bet ----------
create or replace function public.roulette_bet(p_round uuid, p_bet text, p_amount integer)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); uname text; bal int; r public.roulette_rounds;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_amount < 1 or p_amount > 10 then raise exception 'bet must be 1..10'; end if;
  if not (p_bet ~ '^[0-9]+$' and p_bet::int between 0 and 36)
     and p_bet not in ('red','black','even','odd','low','high') then
    raise exception 'bad bet'; end if;

  select * into r from public.roulette_rounds where id = p_round for update;
  if r.id is null then raise exception 'no round'; end if;
  if r.status <> 'betting' or r.betting_ends_at <= now() then raise exception 'betting closed'; end if;

  select cash, username into bal, uname from public.profiles where id = uid for update;
  if bal < p_amount then raise exception 'insufficient cash'; end if;

  update public.profiles set cash = cash - p_amount where id = uid;  -- take the stake now
  insert into public.roulette_bets(round_id, user_id, username, bet_type, amount)
    values (p_round, uid, uname, p_bet, p_amount);

  return json_build_object('ok', true, 'cash', (select cash from public.profiles where id = uid));
exception when unique_violation then
  raise exception 'already bet this round';
end; $$;

-- ---------- spin + settle (idempotent transition) ----------
create or replace function public.roulette_spin(p_round uuid)
returns public.roulette_rounds language plpgsql security definer set search_path = public as $$
declare r public.roulette_rounds; n int; b public.roulette_bets; win boolean; pay int;
begin
  -- Only the caller that flips betting->spinning (after the window) settles it.
  update public.roulette_rounds set status = 'spinning'
    where id = p_round and status = 'betting' and betting_ends_at <= now()
    returning * into r;
  if r.id is null then
    select * into r from public.roulette_rounds where id = p_round;  -- already handled by someone else
    return r;
  end if;

  n := floor(random() * 37);
  for b in select * from public.roulette_bets where round_id = p_round loop
    win := roulette_is_win(b.bet_type, n);
    pay := case when win then b.amount * roulette_mult(b.bet_type) else 0 end;
    if win then update public.profiles set cash = cash + pay where id = b.user_id; end if;
    update public.roulette_bets set won = win, payout = pay where id = b.id;
  end loop;

  update public.roulette_rounds set status = 'done', result = n where id = p_round returning * into r;
  return r;
end; $$;

grant execute on function public.roulette_current(), public.roulette_bet(uuid, text, integer),
  public.roulette_spin(uuid) to authenticated;

-- ===== supabase/migrations/20260619000007_more_avatars.sql =====
-- Add three more avatars (penguin, tiger, panda) to the allowed set.
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles
  add constraint profiles_avatar_check
  check (avatar in ('dog', 'cat', 'capybara', 'penguin', 'tiger', 'panda'));

-- ===== supabase/migrations/20260619000008_chess_tables.sql =====
-- Multiple chess tables: scope each game to a table so independent matches can
-- run in parallel. Existing rows default to the first table.
alter table public.chess_games
  add column if not exists table_id text not null default 'lounge-1';
create index if not exists chess_games_table_idx on public.chess_games (table_id);

-- ===== supabase/migrations/20260619000009_roulette_multibet.sql =====
-- Allow many bets per player per round (throw a pile of chips on the table).
-- Drop the one-bet-per-round unique constraint and recreate roulette_bet without
-- the duplicate handling. Each chip is still 1..10 and settled individually.
alter table public.roulette_bets drop constraint if exists roulette_bets_round_id_user_id_key;

create or replace function public.roulette_bet(p_round uuid, p_bet text, p_amount integer)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); uname text; bal int; r public.roulette_rounds;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_amount < 1 or p_amount > 10 then raise exception 'bet must be 1..10'; end if;
  if not (p_bet ~ '^[0-9]+$' and p_bet::int between 0 and 36)
     and p_bet not in ('red','black','even','odd','low','high') then
    raise exception 'bad bet'; end if;

  select * into r from public.roulette_rounds where id = p_round for update;
  if r.id is null then raise exception 'no round'; end if;
  if r.status <> 'betting' or r.betting_ends_at <= now() then raise exception 'betting closed'; end if;

  select cash, username into bal, uname from public.profiles where id = uid for update;
  if bal < p_amount then raise exception 'insufficient cash'; end if;

  update public.profiles set cash = cash - p_amount where id = uid;  -- take the stake now
  insert into public.roulette_bets(round_id, user_id, username, bet_type, amount)
    values (p_round, uid, uname, p_bet, p_amount);

  return json_build_object('ok', true, 'cash', (select cash from public.profiles where id = uid));
end; $$;

grant execute on function public.roulette_bet(uuid, text, integer) to authenticated;

-- ===== supabase/migrations/20260619000010_blackjack_multiplayer.sql =====
-- Shared multiplayer blackjack: a communal round everyone joins. Everyone is
-- dealt against ONE dealer and plays their own hand simultaneously (no strict
-- turn order); all hands/cards are visible. Server-authoritative (reuses
-- bj_total + bj_card from 20260618000005). Cash stays RPC-only.
--
-- Lifecycle: betting (timed) -> playing (cards dealt, players hit/stand) ->
-- done (dealer draws, settle). The older solo bj_start/bj_hit/bj_stand remain
-- but the UI now uses these round functions.

create table if not exists public.bj_rounds (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'betting' check (status in ('betting','playing','done')),
  dealer_cards    integer[] not null default '{}',
  betting_ends_at timestamptz not null,
  created_at      timestamptz not null default now()
);
create unique index if not exists bj_one_open_round on public.bj_rounds ((true)) where status <> 'done';

create table if not exists public.bj_hands (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.bj_rounds (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  username    text not null,
  avatar      text not null default 'dog',
  bet         integer not null check (bet between 1 and 10),
  cards       integer[] not null default '{}',
  stand       boolean not null default false,
  result      text check (result in ('blackjack','win','lose','push')),
  payout      integer,
  created_at  timestamptz not null default now(),
  unique (round_id, user_id)
);

alter table public.bj_rounds enable row level security;
alter table public.bj_hands  enable row level security;
create policy "bj rounds readable" on public.bj_rounds for select to authenticated using (true);
create policy "bj hands readable"  on public.bj_hands  for select to authenticated using (true);
alter publication supabase_realtime add table public.bj_rounds;
alter publication supabase_realtime add table public.bj_hands;
create index if not exists bj_hands_round_idx on public.bj_hands (round_id);

-- get-or-create the open round (12s betting window)
create or replace function public.bj_round_current()
returns public.bj_rounds language plpgsql security definer set search_path = public as $$
declare r public.bj_rounds;
begin
  select * into r from public.bj_rounds where status <> 'done' order by created_at desc limit 1;
  if r.id is not null then return r; end if;
  begin
    insert into public.bj_rounds(status, betting_ends_at) values ('betting', now() + interval '12 seconds') returning * into r;
  exception when unique_violation then
    select * into r from public.bj_rounds where status <> 'done' order by created_at desc limit 1;
  end;
  return r;
end; $$;

-- join the round with a bet
create or replace function public.bj_round_bet(p_round uuid, p_amount integer, p_avatar text)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); uname text; bal int; r public.bj_rounds;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_amount < 1 or p_amount > 10 then raise exception 'bet must be 1..10'; end if;
  select * into r from public.bj_rounds where id = p_round for update;
  if r.id is null then raise exception 'no round'; end if;
  if r.status <> 'betting' or r.betting_ends_at <= now() then raise exception 'betting closed'; end if;
  select cash, username into bal, uname from public.profiles where id = uid for update;
  if bal < p_amount then raise exception 'insufficient cash'; end if;
  update public.profiles set cash = cash - p_amount where id = uid;
  insert into public.bj_hands(round_id, user_id, username, avatar, bet)
    values (p_round, uid, uname, coalesce(p_avatar, 'dog'), p_amount);
  return json_build_object('ok', true, 'cash', (select cash from public.profiles where id = uid));
exception when unique_violation then raise exception 'already joined';
end; $$;

-- deal once the betting window closes (idempotent)
create or replace function public.bj_round_deal(p_round uuid)
returns public.bj_rounds language plpgsql security definer set search_path = public as $$
declare r public.bj_rounds;
begin
  update public.bj_rounds set status = 'playing', dealer_cards = array[bj_card(), bj_card()]
    where id = p_round and status = 'betting' and betting_ends_at <= now()
    returning * into r;
  if r.id is null then select * into r from public.bj_rounds where id = p_round; return r; end if;
  update public.bj_hands set cards = array[bj_card(), bj_card()] where round_id = p_round;
  -- naturals auto-stand so they don't block settlement
  update public.bj_hands set stand = true where round_id = p_round and bj_total(cards) = 21;
  return r;
end; $$;

create or replace function public.bj_round_hit(p_round uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h public.bj_hands; r public.bj_rounds;
begin
  select * into r from public.bj_rounds where id = p_round;
  if r.status <> 'playing' then raise exception 'not playing'; end if;
  select * into h from public.bj_hands where round_id = p_round and user_id = uid and stand = false for update;
  if h.id is null then raise exception 'no active hand'; end if;
  h.cards := h.cards || bj_card();
  update public.bj_hands set cards = h.cards, stand = (bj_total(h.cards) >= 21) where id = h.id returning * into h;
  return json_build_object('total', bj_total(h.cards), 'stand', h.stand);
end; $$;

create or replace function public.bj_round_stand(p_round uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  update public.bj_hands set stand = true where round_id = p_round and user_id = uid;
  return json_build_object('ok', true);
end; $$;

-- settle once every hand has stood: dealer draws to 17, pay out (idempotent)
create or replace function public.bj_round_settle(p_round uuid)
returns public.bj_rounds language plpgsql security definer set search_path = public as $$
declare r public.bj_rounds; dc integer[]; dtot int; h public.bj_hands; ptot int; res text; pay int;
begin
  if exists (select 1 from public.bj_hands where round_id = p_round and stand = false) then
    select * into r from public.bj_rounds where id = p_round; return r;  -- someone still acting
  end if;
  update public.bj_rounds set status = 'done' where id = p_round and status = 'playing' returning * into r;
  if r.id is null then select * into r from public.bj_rounds where id = p_round; return r; end if;

  dc := r.dealer_cards;
  while bj_total(dc) < 17 loop dc := dc || bj_card(); end loop;
  update public.bj_rounds set dealer_cards = dc where id = p_round;
  dtot := bj_total(dc);

  for h in select * from public.bj_hands where round_id = p_round loop
    ptot := bj_total(h.cards);
    if ptot > 21 then res := 'lose'; pay := 0;
    elsif array_length(h.cards, 1) = 2 and ptot = 21 then
      if dtot = 21 then res := 'push'; pay := h.bet; else res := 'blackjack'; pay := (h.bet * 5) / 2; end if;
    elsif dtot > 21 or ptot > dtot then res := 'win'; pay := h.bet * 2;
    elsif ptot = dtot then res := 'push'; pay := h.bet;
    else res := 'lose'; pay := 0; end if;
    if pay > 0 then update public.profiles set cash = cash + pay where id = h.user_id; end if;
    update public.bj_hands set result = res, payout = pay where id = h.id;
  end loop;
  return (select * from public.bj_rounds where id = p_round);
end; $$;

grant execute on function public.bj_round_current(), public.bj_round_bet(uuid, integer, text),
  public.bj_round_deal(uuid), public.bj_round_hit(uuid), public.bj_round_stand(uuid),
  public.bj_round_settle(uuid) to authenticated;

-- ===== supabase/migrations/20260619000011_blackjack_turns.sql =====
-- Make multiplayer blackjack turn-based and server-driven.
-- Players act in seat order (created_at). Only the current turn_user may hit/
-- stand. Advancing past the last player settles the round server-side, so it no
-- longer depends on a client detecting "everyone stood" (which could freeze).

alter table public.bj_rounds add column if not exists turn_user uuid;

-- dealer draws + pay everyone + mark done (called when all hands are resolved)
create or replace function public.bj_finish(p_round uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.bj_rounds; dc integer[]; dtot int; h public.bj_hands; ptot int; res text; pay int;
begin
  update public.bj_rounds set status = 'done', turn_user = null where id = p_round and status = 'playing' returning * into r;
  if r.id is null then return; end if;            -- already finished by someone else
  dc := r.dealer_cards;
  while bj_total(dc) < 17 loop dc := dc || bj_card(); end loop;
  update public.bj_rounds set dealer_cards = dc where id = p_round;
  dtot := bj_total(dc);
  for h in select * from public.bj_hands where round_id = p_round loop
    ptot := bj_total(h.cards);
    if ptot > 21 then res := 'lose'; pay := 0;
    elsif array_length(h.cards, 1) = 2 and ptot = 21 then
      if dtot = 21 then res := 'push'; pay := h.bet; else res := 'blackjack'; pay := (h.bet * 5) / 2; end if;
    elsif dtot > 21 or ptot > dtot then res := 'win'; pay := h.bet * 2;
    elsif ptot = dtot then res := 'push'; pay := h.bet;
    else res := 'lose'; pay := 0; end if;
    if pay > 0 then update public.profiles set cash = cash + pay where id = h.user_id; end if;
    update public.bj_hands set result = res, payout = pay where id = h.id;
  end loop;
end; $$;

-- hand the turn to the next unfinished player, or finish the round
create or replace function public.bj_advance(p_round uuid)
returns void language plpgsql security definer set search_path = public as $$
declare nxt uuid;
begin
  select user_id into nxt from public.bj_hands
    where round_id = p_round and stand = false order by created_at limit 1;
  if nxt is not null then update public.bj_rounds set turn_user = nxt where id = p_round;
  else perform bj_finish(p_round); end if;
end; $$;

create or replace function public.bj_round_deal(p_round uuid)
returns public.bj_rounds language plpgsql security definer set search_path = public as $$
declare r public.bj_rounds;
begin
  update public.bj_rounds set status = 'playing', dealer_cards = array[bj_card(), bj_card()]
    where id = p_round and status = 'betting' and betting_ends_at <= now()
    returning * into r;
  if r.id is null then select * into r from public.bj_rounds where id = p_round; return r; end if;
  update public.bj_hands set cards = array[bj_card(), bj_card()] where round_id = p_round;
  update public.bj_hands set stand = true where round_id = p_round and bj_total(cards) = 21; -- naturals
  perform bj_advance(p_round);
  select * into r from public.bj_rounds where id = p_round;
  return r;
end; $$;

create or replace function public.bj_round_hit(p_round uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h public.bj_hands; r public.bj_rounds;
begin
  select * into r from public.bj_rounds where id = p_round;
  if r.status <> 'playing' then raise exception 'not playing'; end if;
  if r.turn_user <> uid then raise exception 'not your turn'; end if;
  select * into h from public.bj_hands where round_id = p_round and user_id = uid and stand = false for update;
  if h.id is null then raise exception 'no active hand'; end if;
  h.cards := h.cards || bj_card();
  update public.bj_hands set cards = h.cards, stand = (bj_total(h.cards) >= 21) where id = h.id returning * into h;
  if h.stand then perform bj_advance(p_round); end if;
  return json_build_object('total', bj_total(h.cards), 'stand', h.stand);
end; $$;

create or replace function public.bj_round_stand(p_round uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.bj_rounds;
begin
  select * into r from public.bj_rounds where id = p_round;
  if r.turn_user <> uid then raise exception 'not your turn'; end if;
  update public.bj_hands set stand = true where round_id = p_round and user_id = uid;
  perform bj_advance(p_round);
  return json_build_object('ok', true);
end; $$;

grant execute on function public.bj_finish(uuid), public.bj_advance(uuid) to authenticated;

