-- Add three more avatars (penguin, tiger, panda) to the allowed set.
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles
  add constraint profiles_avatar_check
  check (avatar in ('dog', 'cat', 'capybara', 'penguin', 'tiger', 'panda'));
