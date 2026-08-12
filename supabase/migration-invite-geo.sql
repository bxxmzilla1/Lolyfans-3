-- Invite visitor geolocation (ipinfo.io): city / region / ISP per unique
-- visitor IP, shown in the "Visitors" popup on each invite link card.
-- Run once in the Supabase SQL editor.

alter table invite_visits add column if not exists city text;
alter table invite_visits add column if not exists region text;
alter table invite_visits add column if not exists org text;
alter table invite_visits add column if not exists last_seen_at timestamptz;
