-- Pay per Message.
--
-- Every fan message costs a creator-set price (config lives in the creator's
-- auth user_metadata: ppm_enabled / ppm_price_cents / ppm_free_messages).
-- Per-chat state lives on chats:
--   ppm_accepted_at    when the fan accepted the terms popup (checkmark for
--                      the creator; chatting is blocked until accepted)
--   ppm_messages_used  fan messages counted against the free allowance
--   ppm_balance_cents  accrued unbilled message costs (shown in the fan's
--                      wallet badge; auto-charged roughly once an hour)
--   ppm_last_settle_at when the balance was last charged / attempted
--   ppm_card_declined  the hourly charge failed -> chat input is replaced by
--                      the card form until a working card is added
--
-- Run this in the Supabase SQL editor.

alter table chats add column if not exists ppm_accepted_at timestamptz;
alter table chats add column if not exists ppm_messages_used int not null default 0;
alter table chats add column if not exists ppm_balance_cents int not null default 0;
alter table chats add column if not exists ppm_last_settle_at timestamptz;
alter table chats add column if not exists ppm_card_declined boolean not null default false;
