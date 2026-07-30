-- Batched BlurDrainer settlement.
--
-- Banks decline rapid-fire per-tap charges (velocity + duplicate-transaction
-- rules), so only the FIRST tap of a session is charged on its own. Every
-- later tap unblurs instantly and is counted in pending_layers; the pending
-- taps settle as one combined PaymentIntent shortly after the fan stops
-- tapping (or when they close the player). If that settlement charge fails,
-- the unpaid layers re-fog.
--
-- Run this in the Supabase SQL editor.

alter table message_blur_progress
  add column if not exists pending_layers int not null default 0;
