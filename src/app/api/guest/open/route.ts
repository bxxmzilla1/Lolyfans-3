import { NextRequest, NextResponse } from "next/server";
import { guestChats } from "@/lib/guest";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";

/**
 * Switch the guest session to one of their chats so the /chat page opens that
 * conversation — either by chat id (from the chat list) or by creator id
 * (from a post's Message button).
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

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    GUEST_COOKIE,
    createToken({ chatId: chat.id, name: chat.guest_name }),
    cookieOptions
  );
  return res;
}
