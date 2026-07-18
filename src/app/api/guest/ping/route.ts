import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { guestChats } from "@/lib/guest";

/**
 * Guest heartbeat. Keeps guest_last_seen_at fresh so the server knows the
 * guest is online and skips the offline SMS nudge.
 *
 * - `{ seenOnly: true }` — sent from anywhere in the app: bumps last-seen on
 *   ALL the guest's chats without touching read state (badges stay accurate).
 * - no body / default — sent from the open chat page: also marks that chat
 *   as read (the guest is looking at it).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  const db = supabaseAdmin();

  if (body?.seenOnly) {
    const chats = await guestChats(req.headers);
    if (!chats.length) return NextResponse.json({ ok: false }, { status: 401 });
    await db
      .from("chats")
      .update({ guest_last_seen_at: now })
      .in("id", chats.map((c) => c.id));
    return NextResponse.json({ ok: true });
  }

  const chatId = await getGuestChatId();
  if (!chatId) return NextResponse.json({ ok: false }, { status: 401 });

  await db
    .from("chats")
    .update({ guest_last_seen_at: now, guest_last_read_at: now })
    .eq("id", chatId);

  return NextResponse.json({ ok: true });
}
