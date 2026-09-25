-- Invite links without sign-up + device memory for fans.
-- Run once in the Supabase SQL editor.

-- false = visitors of this link start chatting right away (no name / email /
-- password form); their device is remembered instead.
alter table invites add column if not exists signup_required boolean not null default true;

-- Hash of the fan's device (screen, timezone, language, OS …) — identical in
-- every browser on the same phone, so the fan stays signed in across them.
alter table chats add column if not exists guest_device text;
create index if not exists chats_guest_device_idx on chats (guest_device);
