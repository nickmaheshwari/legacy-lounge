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
