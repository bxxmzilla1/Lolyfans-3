-- Heal inbox "New chat" rows: pick a previewable latest message and derive
-- media_type from media_items when the legacy column is null.
create or replace function owner_chat_stats(p_owner_id uuid)
returns table (
  chat_id uuid,
  preview_content text,
  preview_media_type text,
  preview_sender text,
  preview_created_at timestamptz,
  unread_count bigint
) language sql stable as $$
  select
    c.id,
    m.content,
    m.media_type,
    m.sender,
    m.created_at,
    coalesce(u.cnt, 0)
  from chats c
  left join lateral (
    select
      nullif(trim(content), '') as content,
      coalesce(
        media_type,
        media_items -> 0 ->> 'type'
      ) as media_type,
      sender,
      created_at
    from messages
    where chat_id = c.id
      and (
        coalesce(nullif(trim(content), ''), '') <> ''
        or media_type is not null
        or media_path is not null
        or (
          media_items is not null
          and jsonb_typeof(media_items) = 'array'
          and jsonb_array_length(media_items) > 0
        )
      )
    order by created_at desc
    limit 1
  ) m on true
  left join lateral (
    select count(*) as cnt
    from messages
    where chat_id = c.id
      and sender = 'guest'
      and created_at > coalesce(c.last_read_at, 'epoch'::timestamptz)
  ) u on true
  where c.owner_id = p_owner_id
$$;
