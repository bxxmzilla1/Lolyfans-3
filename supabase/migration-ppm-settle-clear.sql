-- Pay per Message: clear the balance safely after an automatic charge.
--
-- Atomic debit so messages sent during settlement aren't wiped, plus a
-- settlements ledger so Stripe webhooks can re-apply the clear idempotently
-- if the original request died after charging.
--
-- Run this in the Supabase SQL editor (safe if migration-pay-per-message.sql
-- already ran).

create table if not exists ppm_settlements (
  stripe_payment_intent_id text primary key,
  chat_id uuid not null references chats(id) on delete cascade,
  amount_cents int not null,
  created_at timestamptz not null default now()
);

create index if not exists ppm_settlements_chat_idx on ppm_settlements (chat_id);

-- Subtract a charged amount from the chat balance and clear the decline flag.
-- Returns the new balance. Safe to call only after a ledger insert succeeds.
create or replace function ppm_debit_balance(p_chat_id uuid, p_amount int)
returns int
language plpgsql
as $$
declare
  new_bal int;
begin
  update chats
  set
    ppm_balance_cents = greatest(0, coalesce(ppm_balance_cents, 0) - greatest(0, p_amount)),
    ppm_card_declined = false
  where id = p_chat_id
  returning ppm_balance_cents into new_bal;
  return coalesce(new_bal, 0);
end;
$$;
