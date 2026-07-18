import { NextRequest, NextResponse } from "next/server";
import { guestChats } from "@/lib/guest";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";

/**
 * Switch the guest session to one of their chats (from the chat list) so the
 * /chat page opens that conversation.
 */
export async function POST(req: NextRequest) {
  const { chatId } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  const chats = await guestChats(req.headers);
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return NextResponse.json({ error: "Not your chat" }, { status: 403 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    GUEST_COOKIE,
    createToken({ chatId: chat.id, name: chat.guest_name }),
    cookieOptions
  );
  return res;
}
