-- Alien Technology recorder: one row per recording, audio in a private bucket.
-- Applied to the quiet-work project. Only the alien-tech function (service
-- role) reads or writes these; row level security is on with no policies.

create table if not exists public.alien_recordings (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  recorded_at timestamptz not null,
  duration_ms integer not null default 0,
  mime_type text,
  size_bytes bigint,
  audio_path text,
  status text not null default 'uploading'
    check (status in ('uploading', 'uploaded', 'processing', 'ready', 'failed')),
  stage text,
  error text,
  title text,
  language text,
  transcript jsonb,
  transcript_text text,
  notes jsonb,
  speaker_names jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  parts smallint not null default 1 check (parts between 1 and 8),
  time_zone text
);

alter table public.alien_recordings enable row level security;

create index if not exists alien_recordings_recorded_at_idx on public.alien_recordings (recorded_at desc);

create or replace function public.alien_recordings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger alien_recordings_touch
before update on public.alien_recordings
for each row execute function public.alien_recordings_touch();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'alien-recordings', 'alien-recordings', false, 52428800,
  array['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'video/mp4', 'video/webm']
)
on conflict (id) do nothing;

-- The access code is stored only as a SHA-256 hash, in Vault:
--   select vault.create_secret('<sha256 hex>', 'ALIEN_TECH_KEY_SHA256', 'SHA-256 of the Alien Technology access code');
