-- ReDuX shared data
create table if not exists public.profiles (
  login text primary key,
  nickname text not null,
  avatar text default '',
  created_at timestamptz default now()
);

create table if not exists public.app_state (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.app_state enable row level security;

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles for select using (true);

drop policy if exists profiles_public_write on public.profiles;
create policy profiles_public_write on public.profiles for insert with check (true);
drop policy if exists profiles_public_update on public.profiles;
create policy profiles_public_update on public.profiles for update using (true) with check (true);

drop policy if exists app_state_public_read on public.app_state;
create policy app_state_public_read on public.app_state for select using (true);
drop policy if exists app_state_public_write on public.app_state;
create policy app_state_public_write on public.app_state for insert with check (true);
drop policy if exists app_state_public_update on public.app_state;
create policy app_state_public_update on public.app_state for update using (true) with check (true);

alter table public.app_state replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.app_state;
exception when duplicate_object then null; end $$;
