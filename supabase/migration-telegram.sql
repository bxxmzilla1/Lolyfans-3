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

-- Server-only tables (accessed with the service key); RLS keeps the anon key out.
alter table telegram_accounts enable row level security;
alter table telegram_unlocks enable row level security;
