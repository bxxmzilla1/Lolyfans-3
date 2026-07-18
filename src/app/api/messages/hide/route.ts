import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";

/**
 * Hide or unhide messages from the guest. Owner only. Hidden messages stay
 * visible to the owner.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId, messageIds, hidden } = await req.json();
  if (!chatId || !Array.isArray(messageIds) || messageIds.length === 0) {
    return NextResponse.json({ error: "chatId and messageIds required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .single();
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: messages, error } = await db
    .from("messages")
    .update({ hidden: !!hidden })
    .eq("chat_id", chatId)
    .in("id", messageIds)
    .select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcast(`chat:${chatId}`, "hide-messages", {
    ids: messageIds,
    hidden: !!hidden,
  });

  return NextResponse.json({ messages });
}
