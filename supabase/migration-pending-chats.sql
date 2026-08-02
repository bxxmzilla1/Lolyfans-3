-- Chats created through a PAID profile sign-up stay "pending" (invisible in
-- the creator's chat list) until the fan finishes adding their payment
-- details. The flag is cleared when the subscription/one-time payment
-- activates. Existing rows default to false, so nothing disappears.
--
-- Run this once in the Supabase SQL editor.

alter table chats add column if not exists pending boolean not null default false;
