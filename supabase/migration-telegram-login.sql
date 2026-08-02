-- Telegram Login Widget: fans authenticate on the unlock page with their
-- Telegram account (verified server-side against the bot token), so their
-- card can be saved against their Telegram user id — no Lolyfans sign-up
-- needed for one-tap unlocks.
--
-- Requires two env vars on the server:
--   TELEGRAM_BOT_TOKEN     - token from @BotFather (used only to verify logins)
--   TELEGRAM_BOT_USERNAME  - the bot's @username (rendered into the widget)
-- Also run /setdomain in @BotFather and point it at your site's domain.
--
-- Run this once in the Supabase SQL editor.

-- One row per Telegram user who logged in on an unlock page. Holds their
-- saved Stripe card so the next unlock is one tap.
create table if not exists telegram_fans (
  tg_user_id bigint primary key,
  username text,
  first_name text,
  photo_url text,
  stripe_customer_id text,
  stripe_payment_method_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Which Telegram user paid for an unlock (when they were logged in).
alter table telegram_unlocks
  add column if not exists paid_tg_user_id bigint;

-- Server-only table (accessed with the service key); RLS keeps the anon key out.
alter table telegram_fans enable row level security;
