import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";

/**
 * Heartbeat from the open guest chat page. Keeps guest_last_seen_at fresh so
 * the server knows the guest is online and skips the offline SMS nudge.
 */
export async function POST() {
  const chatId = await getGuestChatId();
  if (!chatId) return NextResponse.json({ ok: false }, { status: 401 });

  await supabaseAdmin()
    .from("chats")
    .update({ guest_last_seen_at: new Date().toISOString() })
    .eq("id", chatId);

  return NextResponse.json({ ok: true });
}
