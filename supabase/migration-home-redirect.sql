-- Site-wide key/value settings. First use: "Main Page Redirect" — send
-- visitors of the bare domain (lolyfans.com) straight to an invite link.
-- Run once in the Supabase SQL editor.

create table if not exists site_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;
