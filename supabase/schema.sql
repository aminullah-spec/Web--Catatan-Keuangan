-- Jalankan sekali di Supabase: SQL Editor > New query > paste > Run
-- Aman dijalankan ulang jika Anda memperbarui aplikasi dari versi sebelumnya.

create table if not exists public.vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,            -- berisi data terenkripsi (server tidak bisa membacanya)
  salt text,                      -- salt untuk kunci enkripsi (bukan rahasia)
  rev bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.vaults add column if not exists salt text;
alter table public.vaults enable row level security;

drop policy if exists "vault_select_own" on public.vaults;
drop policy if exists "vault_insert_own" on public.vaults;
drop policy if exists "vault_update_own" on public.vaults;
create policy "vault_select_own" on public.vaults for select using (auth.uid() = user_id);
create policy "vault_insert_own" on public.vaults for insert with check (auth.uid() = user_id);
create policy "vault_update_own" on public.vaults for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Riwayat versi: setiap kali data akan ditimpa, keadaan sebelumnya disimpan
-- (paling sering sekali per 30 menit, simpan 40 versi terakhir).
create table if not exists public.vault_versions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  rev bigint,
  salt text,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists vault_versions_user_time on public.vault_versions (user_id, created_at desc);
alter table public.vault_versions enable row level security;
drop policy if exists "version_select_own" on public.vault_versions;
create policy "version_select_own" on public.vault_versions for select using (auth.uid() = user_id);

create or replace function public.snapshot_vault() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.vault_versions where user_id = old.user_id and created_at > now() - interval '30 minutes') then
    insert into public.vault_versions (user_id, rev, salt, data) values (old.user_id, old.rev, old.salt, old.data);
    delete from public.vault_versions
      where user_id = old.user_id
        and id not in (select id from public.vault_versions where user_id = old.user_id order by created_at desc limit 40);
  end if;
  return new;
end $$;

drop trigger if exists vault_snapshot on public.vaults;
create trigger vault_snapshot before update on public.vaults for each row execute function public.snapshot_vault();

-- Agar perubahan terkirim langsung (realtime) ke perangkat lain
do $$ begin
  alter publication supabase_realtime add table public.vaults;
exception when duplicate_object then null; end $$;
