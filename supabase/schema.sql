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

-- Unique-IP visits of an invite link page (drives the "clicks" stat)
create table if not exists invite_visits (
  invite_id uuid not null references invites(id) on delete cascade,
  ip text not null,
  created_at timestamptz not null default now(),
  primary key (invite_id, ip)
);
alter table invite_visits enable row level security;

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
-- Owner-chosen display name (the guest's original name stays visible subtly)
alter table chats add column if not exists custom_name text;
-- Whether the chat shows in the main "All" section (unchecked when categorized)
alter table chats add column if not exists in_all boolean not null default true;

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
  -- Locked media renders blurred for the receiver until the sender unlocks it
  locked boolean not null default false,
  -- Hidden messages are invisible to the guest; the owner still sees them
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table messages add column if not exists locked boolean not null default false;
alter table messages add column if not exists hidden boolean not null default false;

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

-- An item can be shown in any number of albums (it always stays in "All").
create table if not exists vault_item_albums (
  item_id uuid not null references vault_items(id) on delete cascade,
  album_id uuid not null references vault_albums(id) on delete cascade,
  primary key (item_id, album_id)
);

-- Migrate the old single-album assignments into the join table (no-op when empty)
insert into vault_item_albums (item_id, album_id)
select id, album_id from vault_items where album_id is not null
on conflict do nothing;

alter table vault_item_albums enable row level security;

-- Custom inbox categories (tabs); a chat can belong to any number of them
create table if not exists chat_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists chat_category_members (
  chat_id uuid not null references chats(id) on delete cascade,
  category_id uuid not null references chat_categories(id) on delete cascade,
  primary key (chat_id, category_id)
);

alter table chat_categories enable row level security;
alter table chat_category_members enable row level security;

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

-- API keys: let external apps (e.g. the Orion chatbot) read the owner's chats
-- and send replies on their behalf. One active key per owner (regenerating
-- replaces it). The token is a random string checked on every external call.
create table if not exists api_keys (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  token text unique not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table api_keys enable row level security;

-- Track what an external app has already answered so auto-respond never
-- double-replies to the same fan message.
alter table chats add column if not exists bot_replied_at timestamptz;

create index if not exists api_keys_token_idx on api_keys (token);

-- Guest sign-up: guests register with an email + password (no verification
-- step). The password is stored as a salted scrypt hash, never in plain text.
-- guest_phone remains from the earlier SMS sign-up flow; it's still used to
-- text offline nudges to guests who registered with a number.
alter table chats add column if not exists guest_phone text;
alter table chats add column if not exists guest_email text;
alter table chats add column if not exists guest_password text;

-- One account per email per owner: the same email always resumes the same
-- chat (with the right password) instead of creating duplicates.
create unique index if not exists chats_owner_email_idx
  on chats (owner_id, guest_email)
  where guest_email is not null;

create unique index if not exists chats_owner_phone_idx
  on chats (owner_id, guest_phone)
  where guest_phone is not null;

-- Offline SMS notifications: the guest chat page heartbeats guest_last_seen_at
-- while open; when the owner messages an offline guest, one SMS nudge is sent
-- per offline period (tracked by sms_notified_at).
alter table chats add column if not exists guest_last_seen_at timestamptz;
alter table chats add column if not exists sms_notified_at timestamptz;

-- Creator posts: images/videos shown on the creator's public profile and in
-- the home feed of guests who follow them.
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  media_path text not null,
  media_type text not null check (media_type in ('image', 'video')),
  caption text,
  created_at timestamptz not null default now()
);
alter table posts enable row level security;
create index if not exists posts_owner_idx on posts (owner_id, created_at desc);

-- A guest (identified by their chat) following a creator.
create table if not exists follows (
  chat_id uuid not null references chats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, owner_id)
);
alter table follows enable row level security;

-- Guest profile (picture) + guest-side read tracking for their chat list
-- unread badges.
alter table chats add column if not exists guest_avatar_path text;
alter table chats add column if not exists guest_last_read_at timestamptz;

-- Public storage bucket for chat media and vault files
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;
