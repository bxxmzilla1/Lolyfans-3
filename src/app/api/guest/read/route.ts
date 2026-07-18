import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";

/**
 * Mark the guest's chats as read (advances guest_last_read_at) so footer and
 * chat-list unread badges clear immediately. Body:
 *   { all: true }           — every chat this guest owns
 *   { chatId: "<uuid>" }    — one conversation (must belong to them)
 */
export async function POST(req: NextRequest) {
  const chats = await guestChats(req.headers);
  if (!chats.length) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  const db = supabaseAdmin();

  if (body?.all) {
    const ids = chats.map((c) => c.id);
    const { error } = await db
      .from("chats")
      .update({ guest_last_read_at: now })
      .in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: ids.length });
  }

  const chatId = String(body?.chatId || "");
  if (!chatId || !chats.some((c) => c.id === chatId)) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  const { error } = await db
    .from("chats")
    .update({ guest_last_read_at: now })
    .eq("id", chatId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cleared: 1 });
}
