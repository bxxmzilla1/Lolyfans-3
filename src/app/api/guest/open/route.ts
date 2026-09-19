import { NextRequest, NextResponse } from "next/server";
import { guestChats } from "@/lib/guest";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { ensureGuestChatWith } from "@/lib/guestChatWith";

/**
 * Switch the guest session to one of their chats so the /chat page opens that
 * conversation — either by chat id (from the chat list) or by creator id
 * (from a post's Message button). Unread is cleared only after the chat page
 * itself has loaded (GuestPresence), not here.
 */
export async function POST(req: NextRequest) {
  const { chatId, ownerId } = await req.json();
  if (!chatId && !ownerId) {
    return NextResponse.json({ error: "chatId or ownerId required" }, { status: 400 });
  }

  const chats = await guestChats(req.headers);
  if (!chats.length) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // By creator: open (or start) the fan's chat with them.
  const chat = chatId
    ? chats.find((c) => c.id === chatId)
    : (await ensureGuestChatWith(String(ownerId), chats))?.chat;
  if (!chat) return NextResponse.json({ error: "Not your chat" }, { status: 403 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    GUEST_COOKIE,
    createToken({ chatId: chat.id, name: chat.guest_name }),
    cookieOptions
  );
  return res;
}
