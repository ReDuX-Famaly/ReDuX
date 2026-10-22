
-- ReDuX Owner account
insert into public.redux_users
  (login,name,nickname,password_hash,bio,role,admin,guest,avatar,banned,ban_reason)
values
  ('owner','Owner','Owner','9ced5922d4abbfc50d8846710b653ab6a7b16f213610dcf503f0066269e6ced4','Владелец ReDuX','Owner',true,false,'',false,'')
on conflict (login) do update set
  name=excluded.name, nickname=excluded.nickname, password_hash=excluded.password_hash,
  role='Owner', admin=true, guest=false, banned=false, ban_reason='';

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

-- Дополнительные поля для хранения исходных объектов Redux/обновлений.
alter table public.redux_mods add column if not exists data jsonb default '{}'::jsonb;
alter table public.redux_updates add column if not exists data jsonb default '{}'::jsonb;

update public.redux_users
set password_hash='72b075d216bf6d6bc2d57e89c9bd7b08103f41a9b60c922962ace4616aa09f7b'
where login='worixy' and (password_hash is null or password_hash='');

-- Storage: публичное чтение файлов, загрузка/изменение/удаление для клиента.
insert into storage.buckets (id, name, public)
values ('redux-assets','redux-assets',true)
on conflict (id) do update set public=true;

drop policy if exists "redux_assets_public_read" on storage.objects;
drop policy if exists "redux_assets_public_insert" on storage.objects;
drop policy if exists "redux_assets_public_update" on storage.objects;
drop policy if exists "redux_assets_public_delete" on storage.objects;
create policy "redux_assets_public_read" on storage.objects for select to anon, authenticated using (bucket_id='redux-assets');
create policy "redux_assets_public_insert" on storage.objects for insert to anon, authenticated with check (bucket_id='redux-assets');
create policy "redux_assets_public_update" on storage.objects for update to anon, authenticated using (bucket_id='redux-assets') with check (bucket_id='redux-assets');
create policy "redux_assets_public_delete" on storage.objects for delete to anon, authenticated using (bucket_id='redux-assets');
