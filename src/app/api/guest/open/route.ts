import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";

/**
 * Switch the guest session to one of their chats so the /chat page opens that
 * conversation — either by chat id (from the chat list) or by creator id
 * (from a post's Message button). Also marks the chat as read immediately so
 * its list badge is gone by the time they leave the conversation.
 */
export async function POST(req: NextRequest) {
  const { chatId, ownerId } = await req.json();
  if (!chatId && !ownerId) {
    return NextResponse.json({ error: "chatId or ownerId required" }, { status: 400 });
  }

  const chats = await guestChats(req.headers);
  const chat = chatId
    ? chats.find((c) => c.id === chatId)
    : chats.find((c) => c.owner_id === ownerId);
  if (!chat) return NextResponse.json({ error: "Not your chat" }, { status: 403 });

  // Opening the chat = reading it. Don't wait for the presence heartbeat.
  await supabaseAdmin()
    .from("chats")
    .update({ guest_last_read_at: new Date().toISOString() })
    .eq("id", chat.id);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    GUEST_COOKIE,
    createToken({ chatId: chat.id, name: chat.guest_name }),
    cookieOptions
  );
  return res;
}
