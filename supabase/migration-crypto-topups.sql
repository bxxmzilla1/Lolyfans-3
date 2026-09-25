-- Crypto token top-ups (USDC on Solana via Phantom).
-- Run once in the Supabase SQL editor.

-- One row per top-up attempt. `reference` is a random public key the fan's
-- transaction must include, which ties the on-chain payment to this exact
-- attempt (so a payment can't be claimed by anyone else). `signature` is the
-- confirmed transaction, unique so it can only ever be credited once.
create table if not exists crypto_topups (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  pack_id text not null,
  tokens int not null,
  amount_micro bigint not null,          -- USDC, 6 decimals
  reference text not null unique,
  signature text unique,
  payer text,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table crypto_topups enable row level security;
create index if not exists crypto_topups_chat_idx on crypto_topups (chat_id, created_at desc);
