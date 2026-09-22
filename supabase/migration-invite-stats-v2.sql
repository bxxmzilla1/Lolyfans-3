-- Invite link stats v2. Run this in the Supabase SQL editor.
--
--  * Clicks only count visits from the link's allowed countries (when the
--    link is restricted). Unrestricted links still count everyone.
--  * Subscribers depend on the creator's subscription plan (p_mode):
--      'all'  — free profile: every signup counts (as before)
--      'card' — paid profile with a free trial: only fans who verified a card
--      'paid' — paid profile without trial: only fans who actually paid
--    The API picks the mode from the creator's Settings → Subscription.

-- When the fan's trial ends (null = no trial). Lets 'paid' tell a fan who is
-- still on a free trial (even one set to cancel) apart from one who paid.
alter table subscriptions add column if not exists trial_end timestamptz;

drop function if exists invite_stats(uuid);

create or replace function invite_stats(p_owner_id uuid, p_mode text default 'all')
returns table (
  invite_id uuid,
  joins bigint,
  clicks bigint,
  countries jsonb
) language sql stable as $$
  with dedup as (
    -- Subscribers deduplicated by IP (a device rejoining doesn't count
    -- twice); chats without a stored IP still count once each. The first
    -- chat per IP wins, so its country is the one tallied.
    select distinct on (c.invite_id, coalesce(c.guest_ip, 'chat:' || c.id::text))
      c.invite_id,
      upper(coalesce(nullif(c.guest_country, ''), '??')) as country
    from chats c
    where c.owner_id = p_owner_id
      and c.invite_id is not null
      and (
        coalesce(p_mode, 'all') = 'all'
        or (p_mode = 'card' and c.stripe_payment_method_id is not null)
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
    -- invite_visits rows are already unique per (invite, ip). Restricted
    -- links only count visitors from their allowed countries.
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

create index if not exists chats_owner_invite_idx
  on chats (owner_id, invite_id)
  where invite_id is not null;
