import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerFromApiKey } from "@/lib/apiKey";
import { mediaUrl } from "@/lib/utils";

// Allow the Orion desktop app (or any external client) to call this.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * External read API for connected apps (Orion). Returns every chat the owner
 * has, with recent messages, shaped so a chatbot can display and answer them.
 * Auth is the owner's API key (Authorization: Bearer, or x-api-key).
 */
export async function GET(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }

  const db = supabaseAdmin();
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
  const messagesByChat = new Map<string, unknown[]>();
  if (ids.length) {
    const { data: messages } = await db
      .from("messages")
      .select("id, chat_id, sender, content, media_path, media_type, created_at")
      .in("chat_id", ids)
      .order("created_at", { ascending: true })
      .limit(5000);
    for (const m of messages ?? []) {
      const list = messagesByChat.get(m.chat_id) ?? [];
      list.push({
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
      });
      messagesByChat.set(m.chat_id, list);
    }
  }

  const out = (chats ?? []).map((c) => {
    const msgs = messagesByChat.get(c.id) ?? [];
    const last = msgs[msgs.length - 1] as { content?: string } | undefined;
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
