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

-- Visitor country (ISO alpha-2) recorded per click so external analytics can
-- show only clicks from countries the invite allows. Null on rows recorded
-- before this column existed (those count as allowed).
alter table invite_visits add column if not exists country text;

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

-- AI analysis of each vault item (written by Orion): what's in the media and
-- sales tags, keyed by the item's unique id so it's found instantly.
create table if not exists vault_analyses (
  item_id uuid primary key references vault_items(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  media_type text,
  description text not null default '',
  tags jsonb not null default '[]'::jsonb,
  albums jsonb not null default '[]'::jsonb,
  analyzed_at timestamptz not null default now()
);

create index if not exists vault_analyses_owner_idx on vault_analyses (owner_id);

alter table vault_analyses enable row level security;

-- Script Layers (written by Orion): each vault item can be assigned to an
-- escalation level, so the chatbot knows which content fits the current
-- heat of a conversation and can climb casual -> flirt -> tease -> horny ->
-- sexting one step at a time. Assignments are scoped PER ALBUM (album_key is
-- the album uuid, or 'all' for the album-less view) so every album keeps its
-- own independent ladder.
create table if not exists vault_script_layers (
  item_id uuid not null references vault_items(id) on delete cascade,
  album_key text not null default 'all',
  owner_id uuid not null references auth.users(id) on delete cascade,
  layer text not null check (layer in ('casual', 'flirt', 'tease', 'horny', 'sexting')),
  updated_at timestamptz not null default now(),
  primary key (item_id, album_key)
);

-- Upgrade path from the first per-item version of this table (no-op on fresh
-- databases): keep old assignments as the 'all' scope.
alter table vault_script_layers add column if not exists album_key text not null default 'all';
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'vault_script_layers'
      and constraint_type = 'PRIMARY KEY'
      and constraint_name = 'vault_script_layers_pkey'
  ) and not exists (
    select 1 from information_schema.key_column_usage
    where table_name = 'vault_script_layers'
      and constraint_name = 'vault_script_layers_pkey'
      and column_name = 'album_key'
  ) then
    alter table vault_script_layers drop constraint vault_script_layers_pkey;
    alter table vault_script_layers add primary key (item_id, album_key);
  end if;
end $$;

create index if not exists vault_script_layers_owner_idx on vault_script_layers (owner_id);

alter table vault_script_layers enable row level security;

-- Token price ranges per Script Layer (set in Orion): the chatbot picks the
-- best price inside the range when offering locked content from that layer.
-- Scoped per album like the layers themselves.
create table if not exists vault_layer_prices (
  owner_id uuid not null references auth.users(id) on delete cascade,
  album_key text not null default 'all',
  layer text not null check (layer in ('casual', 'flirt', 'tease', 'horny', 'sexting')),
  min_tokens integer not null default 0,
  max_tokens integer not null default 0,
  -- Free layer: content is sent unlocked (gifts/teasers), no price at all
  is_free boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, album_key, layer)
);

alter table vault_layer_prices add column if not exists is_free boolean not null default false;

create index if not exists vault_layer_prices_owner_idx on vault_layer_prices (owner_id);

alter table vault_layer_prices enable row level security;

-- Which albums the chatbot may pull content from (set in Orion's Vault tab).
-- No row for an album = allowed (default). enabled=false blocks the bot from
-- using that album's items, layers and prices in chats.
create table if not exists vault_bot_albums (
  owner_id uuid not null references auth.users(id) on delete cascade,
  album_key text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (owner_id, album_key)
);

create index if not exists vault_bot_albums_owner_idx on vault_bot_albums (owner_id);

alter table vault_bot_albums enable row level security;

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

-- Social proof: the owner can set a base like count per post (shown on top of
-- real guest likes). The base follower count lives in the owner's metadata.
alter table posts add column if not exists like_count int not null default 0;

-- Real likes from guests (one per guest per post).
create table if not exists post_likes (
  post_id uuid not null references posts(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, chat_id)
);
alter table post_likes enable row level security;

-- Comments on posts: from guests (chat_id set) or seeded by the owner via
-- the Social proof tab (chat_id null, generated author names).
create table if not exists post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  chat_id uuid references chats(id) on delete set null,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
alter table post_comments enable row level security;
create index if not exists post_comments_post_idx on post_comments (post_id, created_at);

-- Invite links can skip the invite landing page and drop visitors straight on
-- the creator's locked profile preview. Clicks are recorded there too, so the
-- stats keep working either way.
alter table invites add column if not exists skip_landing boolean not null default false;

-- Unlock price of a locked media message, in cents. 0 = manual lock only
-- (owner blur toggle). A positive price makes it pay-to-unlock via Stripe.
alter table messages add column if not exists price_cents int not null default 0;

-- Multi-media messages: [{ "path": "...", "type": "image"|"video" }, ...].
-- media_path / media_type stay as the first item for older clients & previews.
alter table messages add column if not exists media_items jsonb not null default '[]'::jsonb;

-- Which fan has unlocked which locked message (one row = revealed for them).
create table if not exists message_unlocks (
  message_id uuid not null references messages(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  price_cents int not null default 0,
  created_at timestamptz not null default now(),
  primary key (message_id, chat_id)
);
alter table message_unlocks enable row level security;
create index if not exists message_unlocks_chat_idx on message_unlocks (chat_id);

-- Stripe customer + saved card for one-tap unlocks after the first Checkout.
alter table chats add column if not exists stripe_customer_id text;
alter table chats add column if not exists stripe_payment_method_id text;

-- Token wallet: fans top up tokens with Stripe (one-tap after the first
-- purchase) and spend them on unlocks and tips inside the chat.
alter table chats add column if not exists token_balance int not null default 0;

-- Every token movement: positive = top-up credit, negative = spend.
create table if not exists token_transactions (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  amount int not null,
  kind text not null check (kind in ('topup', 'unlock', 'tip')),
  message_id uuid references messages(id) on delete set null,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);
alter table token_transactions enable row level security;
create index if not exists token_tx_chat_idx on token_transactions (chat_id, created_at desc);
-- The webhook and the return-URL confirm can both try to credit the same
-- payment; the unique payment intent id makes the credit happen exactly once.
create unique index if not exists token_tx_pi_idx
  on token_transactions (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Atomic spend: only succeeds when the balance covers it. Returns the new
-- balance, or -1 when there aren't enough tokens (or the chat is unknown).
create or replace function spend_tokens(p_chat_id uuid, p_amount int)
returns int language plpgsql security definer as $$
declare new_balance int;
begin
  if p_amount <= 0 then return -1; end if;
  update chats set token_balance = token_balance - p_amount
    where id = p_chat_id and token_balance >= p_amount
    returning token_balance into new_balance;
  return coalesce(new_balance, -1);
end $$;

-- Atomic credit. Returns the new balance, or -1 when the chat is unknown.
create or replace function credit_tokens(p_chat_id uuid, p_amount int)
returns int language plpgsql security definer as $$
declare new_balance int;
begin
  if p_amount <= 0 then return -1; end if;
  update chats set token_balance = token_balance + p_amount
    where id = p_chat_id
    returning token_balance into new_balance;
  return coalesce(new_balance, -1);
end $$;

-- Paid profile subscriptions (Stripe Billing). One row per fan chat + creator.
-- status mirrors Stripe: trialing / active / canceling / past_due / canceled.
create table if not exists subscriptions (
  chat_id uuid not null references chats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  stripe_subscription_id text,
  status text not null default 'active',
  price_cents int not null default 0,
  billing_interval text not null default 'month',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  primary key (chat_id, owner_id)
);
alter table subscriptions enable row level security;
create index if not exists subscriptions_owner_idx on subscriptions (owner_id);

-- Public storage bucket for chat media and vault files.
-- file_size_limit null = no per-bucket cap (project global Storage limit applies).
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, null)
on conflict (id) do update set file_size_limit = null;
