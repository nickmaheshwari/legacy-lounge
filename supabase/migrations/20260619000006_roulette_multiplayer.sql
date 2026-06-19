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
