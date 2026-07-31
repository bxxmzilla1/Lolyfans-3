-- Pay per Message: free money credit instead of free message count.
--
-- When a fan accepts the terms popup they receive ppm_credit_cents on the
-- chat (from the creator's ppm_free_credit_cents setting). Messages spend
-- that credit first; once it's gone, further messages accrue on
-- ppm_balance_cents (hourly card charge) and require a verified card.
--
-- Run this in the Supabase SQL editor.

alter table chats add column if not exists ppm_credit_cents int not null default 0;
-- True once the free credit has been applied (accept or one-time legacy heal).
alter table chats add column if not exists ppm_credit_granted boolean not null default false;
