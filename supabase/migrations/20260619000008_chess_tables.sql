-- Multiple chess tables: scope each game to a table so independent matches can
-- run in parallel. Existing rows default to the first table.
alter table public.chess_games
  add column if not exists table_id text not null default 'lounge-1';
create index if not exists chess_games_table_idx on public.chess_games (table_id);
