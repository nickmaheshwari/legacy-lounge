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
