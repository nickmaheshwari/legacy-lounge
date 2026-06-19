-- Player avatar (animal) chosen at signup. Defaults to dog for any existing rows.
alter table public.profiles
  add column if not exists avatar text not null default 'dog'
  check (avatar in ('dog', 'cat', 'capybara'));
