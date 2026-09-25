-- Phantom-only: fans sign up with their Solana wallet and pay in USDC.
-- Run once in the Supabase SQL editor. Safe to re-run.

-- One row per USDC payment attempt. `reference` is a random public key the
-- fan's transaction must include (ties the on-chain payment to this exact
-- attempt); `signature` is unique so a payment is only ever credited once.
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

-- Fan identity = their Phantom wallet address. One chat per wallet per
-- creator; the same wallet links a fan's chats across creators.
alter table chats add column if not exists guest_wallet text;
create index if not exists chats_guest_wallet_idx on chats (guest_wallet);
create unique index if not exists chats_owner_wallet_idx
  on chats (owner_id, guest_wallet)
  where guest_wallet is not null;

-- Crypto payments now cover token packs, creator-sent coupons and paid
-- subscription periods.
alter table crypto_topups add column if not exists kind text not null default 'topup';
alter table crypto_topups drop constraint if exists crypto_topups_kind_check;
alter table crypto_topups add constraint crypto_topups_kind_check
  check (kind in ('topup', 'coupon', 'subscription'));
alter table crypto_topups add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table crypto_topups add column if not exists message_id uuid references messages(id) on delete set null;

-- Voice-call minutes are paid from the token wallet.
alter table token_transactions drop constraint if exists token_transactions_kind_check;
alter table token_transactions add constraint token_transactions_kind_check
  check (kind in ('topup', 'unlock', 'tip', 'call'));

-- Invite stats without cards:
--   'all'  — free profile: every signup counts
--   'card' — paid profile with a free trial: fans who started the trial
--   'paid' — paid profile: fans who actually paid in USDC
create or replace function invite_stats(p_owner_id uuid, p_mode text default 'all')
returns table (
  invite_id uuid,
  joins bigint,
  clicks bigint,
  countries jsonb
) language sql stable as $$
  with dedup as (
    select distinct on (c.invite_id, coalesce(c.guest_ip, 'chat:' || c.id::text))
      c.invite_id,
      upper(coalesce(nullif(c.guest_country, ''), '??')) as country
    from chats c
    where c.owner_id = p_owner_id
      and c.invite_id is not null
      and (
        coalesce(p_mode, 'all') = 'all'
        or (p_mode = 'card' and exists (
          select 1 from subscriptions s
          where s.chat_id = c.id and s.owner_id = c.owner_id
        ))
        or (p_mode = 'paid' and exists (
          select 1 from subscriptions s
          where s.chat_id = c.id
            and s.owner_id = c.owner_id
            and s.status in ('active', 'past_due', 'canceling')
            and (s.trial_end is null or s.trial_end <= now())
        ))
      )
    order by
      c.invite_id,
      coalesce(c.guest_ip, 'chat:' || c.id::text),
      c.created_at asc
  ),
  join_stats as (
    select t.invite_id, sum(t.cnt)::bigint as joins,
      jsonb_object_agg(t.country, t.cnt) as countries
    from (
      select d.invite_id, d.country, count(*)::bigint as cnt
      from dedup d
      group by d.invite_id, d.country
    ) t
    group by t.invite_id
  ),
  click_stats as (
    select v.invite_id, count(*)::bigint as clicks
    from invite_visits v
    join invites i on i.id = v.invite_id
    where i.owner_id = p_owner_id
      and (
        i.allowed_countries is null
        or cardinality(i.allowed_countries) = 0
        or upper(coalesce(v.country, '')) = any (
          select upper(a) from unnest(i.allowed_countries) a
        )
      )
    group by v.invite_id
  )
  select
    i.id,
    coalesce(j.joins, 0),
    coalesce(cs.clicks, 0),
    coalesce(j.countries, '{}'::jsonb)
  from invites i
  left join join_stats j on j.invite_id = i.id
  left join click_stats cs on cs.invite_id = i.id
  where i.owner_id = p_owner_id
$$;
