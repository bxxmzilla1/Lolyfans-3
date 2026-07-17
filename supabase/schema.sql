-- Lolyfans database schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Accounts are handled by Supabase Auth (sign up / sign in with email + password).

create extension if not exists pgcrypto;

-- Invite links that let guests start chatting without registration
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  code text unique not null,
  label text,
  -- null / empty = available worldwide, otherwise list of ISO 3166-1 alpha-2 codes
  allowed_countries text[],
  max_uses int,
  uses int not null default 0,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- One chat per guest that joined through an invite
create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_id uuid references invites(id) on delete set null,
  guest_name text not null,
  guest_country text,
  guest_ip text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- When the owner last opened this chat (drives unread badges)
  last_read_at timestamptz not null default now()
);

-- Upgrade path: if the tables were created by the old single-owner schema,
-- they exist without owner_id. Add it here (no-op on fresh databases).
alter table invites add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table chats add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table chats add column if not exists guest_ip text;
alter table chats add column if not exists last_read_at timestamptz not null default now();

create index if not exists chats_owner_idx on chats (owner_id, last_message_at desc);
create index if not exists chats_guest_ip_idx on chats (guest_ip);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  sender text not null check (sender in ('owner', 'guest')),
  content text,
  media_path text,
  media_type text check (media_type in ('image', 'video')),
  reply_to_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_created_idx on messages (chat_id, created_at);

-- Vault: private media library with optional albums
create table if not exists vault_albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists vault_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  album_id uuid references vault_albums(id) on delete set null,
  media_path text not null,
  media_type text not null check (media_type in ('image', 'video')),
  created_at timestamptz not null default now()
);

alter table vault_albums add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table vault_items add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists vault_items_owner_idx on vault_items (owner_id, created_at desc);

-- All access goes through the app's API routes (service role key),
-- so RLS is enabled with no public policies: the anon key can't touch data.
alter table invites enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table vault_albums enable row level security;
alter table vault_items enable row level security;

-- Realtime: stream message inserts straight from the database so the owner's
-- chat sidebar refreshes instantly on every new message.
do $$
begin
  alter publication supabase_realtime add table messages;
exception
  when duplicate_object then null;
end $$;

-- RLS policies that let a signed-in owner receive realtime events (and read)
-- only for their own chats. Guests and the public still have no access.
drop policy if exists "Owners can read their chats" on chats;
create policy "Owners can read their chats" on chats
  for select using (owner_id = (select auth.uid()));

drop policy if exists "Owners can read messages in their chats" on messages;
create policy "Owners can read messages in their chats" on messages
  for select using (
    exists (
      select 1 from chats
      where chats.id = messages.chat_id
        and chats.owner_id = (select auth.uid())
    )
  );

-- Public storage bucket for chat media and vault files
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;
