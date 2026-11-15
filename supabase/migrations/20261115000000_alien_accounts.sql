-- Alien Technology accounts. Each person signs in with their email and a
-- 6-digit code sent to it, and sees only their own recordings. One master
-- account adds, pauses and removes the others.
-- Applied to the quiet-work project. Only the alien-tech function (service
-- role) reads or writes these tables; row level security is on with no policies.

create table if not exists public.alien_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and length(email) <= 254),
  role text not null default 'member' check (role in ('master', 'member')),
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- There is never more than one master.
create unique index if not exists alien_accounts_one_master on public.alien_accounts ((true)) where role = 'master';

-- The newest sign-in code for an email. Only its hash is kept.
create table if not exists public.alien_login_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  sent_count integer not null default 1,
  window_started_at timestamptz not null default now()
);

-- A signed-in phone. Only the hash of its token is kept.
create table if not exists public.alien_sessions (
  token_hash text primary key,
  account_id uuid not null references public.alien_accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists alien_sessions_account_idx on public.alien_sessions (account_id);

alter table public.alien_accounts enable row level security;
alter table public.alien_login_codes enable row level security;
alter table public.alien_sessions enable row level security;

revoke all on public.alien_accounts, public.alien_login_codes, public.alien_sessions from anon, authenticated;
grant select, insert, update, delete on public.alien_accounts, public.alien_login_codes, public.alien_sessions to service_role;

-- The master account is made once by hand, so its address stays out of this
-- repository. Recordings made before accounts existed are then given to it:
--   insert into public.alien_accounts (email, role) values ('<email>', 'master');
--   update public.alien_recordings
--   set owner_id = (select id from public.alien_accounts where role = 'master')
--   where owner_id is null;

-- Every recording belongs to one account.
alter table public.alien_recordings
  add column if not exists owner_id uuid references public.alien_accounts (id) on delete restrict;

create index if not exists alien_recordings_owner_idx on public.alien_recordings (owner_id, recorded_at desc);

-- A recording saved without an owner (a phone still on the older app) goes to the master.
create or replace function public.alien_recordings_default_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is null then
    new.owner_id := (select id from public.alien_accounts where role = 'master');
  end if;
  return new;
end;
$$;

create or replace trigger alien_recordings_default_owner
before insert on public.alien_recordings
for each row execute function public.alien_recordings_default_owner();

-- How much each account has recorded, for the master's accounts screen.
create or replace function public.alien_account_usage()
returns table (owner_id uuid, recordings bigint, duration_ms bigint)
language sql
stable
set search_path = ''
as $$
  select r.owner_id, count(*)::bigint, coalesce(sum(r.duration_ms), 0)::bigint
  from public.alien_recordings r
  where r.owner_id is not null
  group by r.owner_id;
$$;

revoke all on function public.alien_account_usage() from public, anon, authenticated;
grant execute on function public.alien_account_usage() to service_role;
