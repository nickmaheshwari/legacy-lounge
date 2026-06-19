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
