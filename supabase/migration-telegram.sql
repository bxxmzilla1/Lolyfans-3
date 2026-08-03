-- Telegram DM selling: the creator connects their own Telegram account
-- (MTProto session) and sends locked media into fans' DMs with a pay link.
-- After the fan pays on the unlock page, the clear media is delivered into
-- the same DM automatically.
--
-- Run this once in the Supabase SQL editor.

-- One connected Telegram account per creator. `session` is the GramJS
-- StringSession (auth key); during login it temporarily holds the
-- pre-sign-in session while the code / 2FA password is entered.
create table if not exists telegram_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'disconnected', -- disconnected | code_sent | password_needed | connected
  phone text,
  username text,
  session text,
  phone_code_hash text,
  updated_at timestamptz not null default now()
);

-- One row per locked media sent to a Telegram DM. The row id doubles as the
-- unguessable unlock-link token (lolyfans.com/u/<id>).
create table if not exists telegram_unlocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  media_path text not null,
  media_type text not null, -- image | video
  price_cents int not null,
  tg_peer text not null,    -- @username or phone the teaser was sent to
  status text not null default 'pending', -- pending | paid
  paid_chat_id uuid references chats(id) on delete set null,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_unlocks_owner_idx
  on telegram_unlocks (owner_id, created_at desc);

-- Short pay-link token (lolyfans.com/payment/<code>) and the Telegram id of
-- the teaser message, so a double-tap reaction on it can auto-charge a fan
-- with a saved card. Safe to re-run.
alter table telegram_unlocks add column if not exists short_code text unique;
alter table telegram_unlocks add column if not exists tg_message_id bigint;

-- Saved Messages copy of the clear media, uploaded when the PPV is sent.
-- Unlock delivery re-sends it by reference (instant server-side copy).
alter table telegram_unlocks add column if not exists tg_cached_message_id bigint;

-- Vault media pre-uploaded to Telegram: one Saved Messages copy per file
-- (instant sends and unlock deliveries by reference) plus a pre-rendered
-- blurred teaser clip for videos (locked video sends become as fast as
-- images — only the price badge is overlaid at send time). Safe to re-run.
create table if not exists telegram_media_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  media_path text not null,
  media_type text not null, -- image | video
  tg_message_id bigint,     -- clear copy in Saved Messages
  teaser_path text,         -- storage path of the badge-less blurred clip
  caching_at timestamptz,   -- in-flight claim (prevents duplicate uploads)
  created_at timestamptz not null default now(),
  unique (owner_id, media_path)
);

-- Telegram-native vault: vault items can mirror the creator's Saved
-- Messages (media_path "tg:<messageId>"). Video length comes from Telegram
-- so the grid can show durations without loading the file. Safe to re-run.
alter table vault_items add column if not exists duration_seconds int;

-- Server-only tables (accessed with the service key); RLS keeps the anon key out.
alter table telegram_accounts enable row level security;
alter table telegram_unlocks enable row level security;
alter table telegram_media_cache enable row level security;
