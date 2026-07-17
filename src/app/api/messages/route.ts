import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId, getGuestChatId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";

/** A user may access a chat if they own it (signed in) or joined it as a guest. */
async function authorizeChat(chatId: string): Promise<"owner" | "guest" | null> {
  const guestChatId = await getGuestChatId();
  if (guestChatId && guestChatId === chatId) return "guest";

  const ownerId = await getOwnerId();
  if (ownerId) {
    const { data: chat } = await supabaseAdmin()
      .from("chats")
      .select("owner_id")
      .eq("id", chatId)
      .single();
    if (chat?.owner_id === ownerId) return "owner";
  }
  return null;
}

export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  // Run the auth check and the query in parallel; data is only returned if authorized.
  const [role, { data, error }] = await Promise.all([
    authorizeChat(chatId),
    supabaseAdmin()
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(500),
  ]);
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data, role });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { chatId, content, mediaPath, mediaType, replyToId } = body;
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });
  if (!content?.trim() && !mediaPath) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const role = await authorizeChat(chatId);
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: message, error } = await db
    .from("messages")
    .insert({
      chat_id: chatId,
      sender: role,
      content: content?.trim() || null,
      media_path: mediaPath || null,
      media_type: mediaType || null,
      reply_to_id: replyToId || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await Promise.all([
    db.from("chats").update({ last_message_at: message.created_at }).eq("id", chatId),
    broadcast(`chat:${chatId}`, "new-message", message),
  ]);

  return NextResponse.json({ message });
}
