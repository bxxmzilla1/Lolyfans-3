import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerFromApiKey } from "@/lib/apiKey";
import { broadcast } from "@/lib/realtime";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * External send API for connected apps (Orion): post a reply into a chat as
 * the owner. Marks the chat as bot-replied so auto-respond won't answer the
 * same fan message twice. Auth is the owner's API key.
 */
export async function POST(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }

  const { chatId, content, mediaPath, mediaType, locked } = await req.json();
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400, headers: CORS });
  }
  if (!content?.trim() && !mediaPath) {
    return NextResponse.json({ error: "Empty message" }, { status: 400, headers: CORS });
  }

  const db = supabaseAdmin();
  // Only allow sending into a chat this owner actually owns.
  const { data: chat } = await db
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404, headers: CORS });
  }

  const { data: message, error } = await db
    .from("messages")
    .insert({
      chat_id: chatId,
      sender: "owner",
      content: content?.trim() || null,
      media_path: mediaPath || null,
      media_type: mediaType || null,
      locked: !!locked && !!mediaPath,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  const now = message.created_at;
  await Promise.all([
    db
      .from("chats")
      .update({ last_message_at: now, last_read_at: now, bot_replied_at: now })
      .eq("id", chatId),
    broadcast(`chat:${chatId}`, "new-message", message),
    broadcast(`inbox:${ownerId}`, "new-message", { chatId }),
  ]);

  return NextResponse.json({ message }, { headers: CORS });
}
