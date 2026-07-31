-- PaidSub: a creator-triggered popup that offers the fan unlimited messaging
-- for a one-time payment. The popup blocks the chat until they pay.
--   paidsub_offer_at — when the creator sent the offer popup (null = none)
--   paidsub_paid_at  — when the fan paid (unlimited messaging active)
alter table chats add column if not exists paidsub_offer_at timestamptz;
alter table chats add column if not exists paidsub_paid_at timestamptz;
