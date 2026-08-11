-- Telegram Mini App + Stars chats / unlocks
-- Run once in the Supabase SQL editor.

create table if not exists telegram_bots (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  bot_token text not null,
  bot_username text,
  bot_id bigint,
  webhook_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table telegram_bots enable row level security;

create table if not exists stars_chats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  tg_user_id bigint not null,
  username text,
  first_name text,
  last_name text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, tg_user_id)
);
create index if not exists stars_chats_owner_idx
  on stars_chats (owner_id, last_message_at desc);
alter table stars_chats enable row level security;

create table if not exists stars_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references stars_chats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  sender text not null check (sender in ('owner', 'fan')),
  content text,
  media_path text,
  media_type text,
  locked boolean not null default false,
  price_stars int not null default 0,
  unlock_id uuid,
  status text not null default 'visible',
  created_at timestamptz not null default now()
);
create index if not exists stars_messages_chat_idx
  on stars_messages (chat_id, created_at asc);
alter table stars_messages enable row level security;

create table if not exists stars_unlocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null references stars_chats(id) on delete cascade,
  message_id uuid references stars_messages(id) on delete set null,
  media_path text not null,
  media_type text not null,
  price_stars int not null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'delivered', 'refunded')),
  telegram_payment_charge_id text,
  paid_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists stars_unlocks_owner_idx
  on stars_unlocks (owner_id, created_at desc);
alter table stars_unlocks enable row level security;

-- Fan Mini App presence (heartbeat). Safe to re-run.
alter table stars_chats add column if not exists fan_last_seen_at timestamptz;
