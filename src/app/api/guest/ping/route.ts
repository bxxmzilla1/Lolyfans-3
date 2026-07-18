import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";

/**
 * Heartbeat from the open guest chat page. Keeps guest_last_seen_at fresh so
 * the server knows the guest is online and skips the offline SMS nudge. Also
 * marks the chat as read (the guest is looking at it) so their chat-list
 * unread badges stay accurate.
 */
export async function POST() {
  const chatId = await getGuestChatId();
  if (!chatId) return NextResponse.json({ ok: false }, { status: 401 });

  const now = new Date().toISOString();
  await supabaseAdmin()
    .from("chats")
    .update({ guest_last_seen_at: now, guest_last_read_at: now })
    .eq("id", chatId);

  return NextResponse.json({ ok: true });
}
