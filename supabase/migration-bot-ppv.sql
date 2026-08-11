-- Bot PPV maker (replaces the Mini App):
-- the creator DMs the bot, activates with the private code, sends a photo or
-- video, sets a Stars price, and gets back a forwardable invoice message.
-- Run once in the Supabase SQL editor.

create table if not exists bot_operators (
  owner_id uuid not null references auth.users(id) on delete cascade,
  tg_user_id bigint not null,
  username text,
  first_name text,
  -- Unlock waiting for a price reply ("How many Stars?").
  pending_unlock_id uuid,
  activated_at timestamptz not null default now(),
  primary key (owner_id, tg_user_id)
);
alter table bot_operators enable row level security;

-- PPVs no longer hang off a Mini App chat.
alter table stars_unlocks add column if not exists tg_file_id text;
alter table stars_unlocks add column if not exists creator_tg_id bigint;
alter table stars_unlocks add column if not exists caption text;
alter table stars_unlocks alter column chat_id drop not null;
alter table stars_unlocks alter column media_path drop not null;
alter table stars_unlocks drop constraint if exists stars_unlocks_chat_id_fkey;
alter table stars_unlocks drop constraint if exists stars_unlocks_message_id_fkey;
alter table stars_unlocks drop constraint if exists stars_unlocks_status_check;
alter table stars_unlocks add constraint stars_unlocks_status_check
  check (status in ('draft', 'pending', 'paid', 'delivered', 'refunded'));

-- Mini App chat tables go with the feature.
drop table if exists stars_messages;
drop table if exists stars_chats;
