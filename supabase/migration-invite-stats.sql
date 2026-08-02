-- Invite link stats in ONE query. The API used to page through every chat
-- and visit row (1000 at a time) just to count joins/clicks per link, which
-- made the Invite links tab crawl once an account had many fans.
-- Run this in the Supabase SQL editor.

create or replace function invite_stats(p_owner_id uuid)
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
    -- invite_visits rows are already unique per (invite, ip)
    select v.invite_id, count(*)::bigint as clicks
    from invite_visits v
    join invites i on i.id = v.invite_id
    where i.owner_id = p_owner_id
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

-- Speeds up the per-owner invite scan used by the function above.
create index if not exists chats_owner_invite_idx
  on chats (owner_id, invite_id)
  where invite_id is not null;
