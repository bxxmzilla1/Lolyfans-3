-- Migration for databases created with the original single-owner schema.
-- Adds owner_id columns for the sign in / sign up feature.
-- Fresh projects should run schema.sql instead — this file is not needed then.

alter table invites add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table chats add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table vault_albums add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table vault_items add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists chats_owner_idx on chats (owner_id, last_message_at desc);
create index if not exists vault_items_owner_idx on vault_items (owner_id, created_at desc);

-- Optional: claim data created before accounts existed for your new account.
-- Replace the email below with the one you signed up with, then uncomment and run.
-- update invites set owner_id = (select id from auth.users where email = 'you@example.com') where owner_id is null;
-- update chats set owner_id = (select id from auth.users where email = 'you@example.com') where owner_id is null;
-- update vault_albums set owner_id = (select id from auth.users where email = 'you@example.com') where owner_id is null;
-- update vault_items set owner_id = (select id from auth.users where email = 'you@example.com') where owner_id is null;
