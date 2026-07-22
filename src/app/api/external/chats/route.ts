import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerFromApiKey } from "@/lib/apiKey";
import { mediaUrl } from "@/lib/utils";

// Loading hundreds of chats with messages can exceed the default serverless
// budget — allow up to 60s so the list never dies mid-page.
export const maxDuration = 60;

// Allow the Orion desktop app (or any external client) to call this.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type MsgRow = {
  id: string;
  chat_id: string;
  sender: string;
  content: string | null;
  media_path: string | null;
  media_type: string | null;
  media_items: { path: string; type: string }[] | null;
  locked: boolean | null;
  price_cents: number | null;
  created_at: string;
};

function shapeMessage(m: MsgRow, unlockedIds?: Set<string>) {
  const items =
    Array.isArray(m.media_items) && m.media_items.length
      ? m.media_items
      : m.media_path
        ? [{ path: m.media_path, type: m.media_type || "image" }]
        : [];
  const priceCents = m.price_cents || 0;
  return {
    id: m.id,
    role: m.sender === "owner" ? "me" : "fan",
    content: m.content || "",
    at: m.created_at,
    media: m.media_path
      ? {
          kind: m.media_type === "video" ? "video" : "image",
          url: mediaUrl(m.media_path),
          path: m.media_path,
        }
      : null,
    mediaItems: items.map((it) => ({
      kind: it.type === "video" ? "video" : "image",
      url: mediaUrl(it.path),
      path: it.path,
    })),
    locked: !!m.locked,
    priceTokens: priceCents > 0 ? Math.max(1, Math.ceil(priceCents / 10)) : 0,
    unlocked: unlockedIds ? unlockedIds.has(m.id) : false,
  };
}

const MSG_COLUMNS =
  "id, chat_id, sender, content, media_path, media_type, media_items, locked, price_cents, created_at";

/** Which locked messages each fan has already paid for. */
async function loadUnlockedIds(db: ReturnType<typeof supabaseAdmin>, chatIds: string[]) {
  const unlocked = new Set<string>();
  const CHUNK = 40;
  for (let i = 0; i < chatIds.length; i += CHUNK) {
    const { data } = await db
      .from("message_unlocks")
      .select("message_id")
      .in("chat_id", chatIds.slice(i, i + CHUNK));
    for (const u of data ?? []) unlocked.add(u.message_id);
  }
  return unlocked;
}

/** Recent messages for one chat (newest first, then flipped). */
async function loadMessagesForChat(db: ReturnType<typeof supabaseAdmin>, chatId: string, limit = 200) {
  const [{ data, error }, unlockedIds] = await Promise.all([
    db
      .from("messages")
      .select(MSG_COLUMNS)
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(limit),
    loadUnlockedIds(db, [chatId]),
  ]);
  if (error) throw new Error(error.message);
  return ((data as MsgRow[]) ?? []).reverse().map((m) => shapeMessage(m, unlockedIds));
}

/**
 * Recent messages for many chats. Chunks the `.in()` filter so PostgREST
 * never chokes on a giant URL, pages newest-first, and caps per chat so a
 * busy chat can't starve the rest.
 */
async function loadMessagesForChats(
  db: ReturnType<typeof supabaseAdmin>,
  chatIds: string[],
  perChat = 80
) {
  const messagesByChat = new Map<string, ReturnType<typeof shapeMessage>[]>();
  const counts = new Map<string, number>();
  const CHUNK = 40;
  const PAGE = 1000;
  const unlockedIds = await loadUnlockedIds(db, chatIds);

  for (let i = 0; i < chatIds.length; i += CHUNK) {
    const chunk = chatIds.slice(i, i + CHUNK);
    for (let from = 0; from < 5000; from += PAGE) {
      const { data: page, error } = await db
        .from("messages")
        .select(MSG_COLUMNS)
        .in("chat_id", chunk)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!page?.length) break;
      for (const m of page as MsgRow[]) {
        const n = counts.get(m.chat_id) ?? 0;
        if (n >= perChat) continue;
        counts.set(m.chat_id, n + 1);
        const list = messagesByChat.get(m.chat_id) ?? [];
        list.push(shapeMessage(m, unlockedIds));
        messagesByChat.set(m.chat_id, list);
      }
      if (page.length < PAGE) break;
      // Every chat in this chunk already full — stop paging it.
      if (chunk.every((id) => (counts.get(id) ?? 0) >= perChat)) break;
    }
  }

  for (const list of messagesByChat.values()) list.reverse();
  return messagesByChat;
}

/**
 * External read API for connected apps (Orion). Returns every chat the owner
 * has, with recent messages, shaped so a chatbot can display and answer them.
 *
 * Optional `?chatId=<uuid>` returns only that chat with a deeper message
 * history — used when Orion opens a conversation so the transcript never
 * arrives empty because of a list-level cap.
 */
export async function GET(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }

  const db = supabaseAdmin();
  const chatId = req.nextUrl.searchParams.get("chatId");

  // Single-chat deep fetch (opened conversation).
  if (chatId) {
    const { data: chat, error } = await db
      .from("chats")
      .select("id, guest_name, custom_name, guest_country, last_message_at, bot_replied_at")
      .eq("owner_id", ownerId)
      .eq("id", chatId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
    }
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404, headers: CORS });
    }
    try {
      const msgs = await loadMessagesForChat(db, chat.id, 200);
      const last = msgs[msgs.length - 1];
      return NextResponse.json(
        {
          chat: {
            id: chat.id,
            name: chat.custom_name || chat.guest_name || "Guest",
            username: "",
            country: chat.guest_country || "",
            lastMessage: last?.content || "",
            lastMessageAt: chat.last_message_at,
            botRepliedAt: chat.bot_replied_at || null,
            messages: msgs,
          },
        },
        { headers: CORS }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load messages";
      return NextResponse.json({ error: message }, { status: 500, headers: CORS });
    }
  }

  const { data: chats, error } = await db
    .from("chats")
    .select("id, guest_name, custom_name, guest_country, last_message_at, bot_replied_at")
    .eq("owner_id", ownerId)
    .order("last_message_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  const ids = (chats ?? []).map((c) => c.id);
  let messagesByChat = new Map<string, ReturnType<typeof shapeMessage>[]>();
  if (ids.length) {
    try {
      messagesByChat = await loadMessagesForChats(db, ids, 80);
    } catch (err) {
      console.error("external/chats message load failed:", err);
      // Still return the chat list — Orion can deep-fetch per chat.
    }
  }

  const out = (chats ?? []).map((c) => {
    const msgs = messagesByChat.get(c.id) ?? [];
    const last = msgs[msgs.length - 1];
    return {
      id: c.id,
      name: c.custom_name || c.guest_name || "Guest",
      username: "",
      country: c.guest_country || "",
      lastMessage: last?.content || "",
      lastMessageAt: c.last_message_at,
      botRepliedAt: c.bot_replied_at || null,
      messages: msgs,
    };
  });

  return NextResponse.json({ chats: out }, { headers: CORS });
}
