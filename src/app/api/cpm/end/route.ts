import { NextRequest, NextResponse } from "next/server";
import { getGuestChatId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeCpmSession, endCpmSession } from "@/lib/cpm";

/**
 * Fan left the chat (hang-up / tab close). Charge any unpaid minutes and
 * end the metering session. Safe to call repeatedly / via sendBeacon.
 */
export async function POST(req: NextRequest) {
  // Prefer body.chatId (sendBeacon may race the cookie) but fall back to cookie.
  const body = await req.json().catch(() => ({}));
  const chatId =
    String(body.chatId || "").trim() || (await getGuestChatId()) || "";
  if (!chatId) return NextResponse.json({ ok: true });

  const { data: chat } = await supabaseAdmin()
    .from("chats")
    .select("id, cpm")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat?.cpm) return NextResponse.json({ ok: true });

  const session = await activeCpmSession(chatId);
  if (session) await endCpmSession(session);
  return NextResponse.json({ ok: true });
}
