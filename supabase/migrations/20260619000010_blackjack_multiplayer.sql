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
