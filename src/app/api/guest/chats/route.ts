import { NextRequest, NextResponse } from "next/server";
import { guestChats, guestUnreadCounts } from "@/lib/guest";

/**
 * Total unread messages across the guest's chats — drives the badge on the
 * Chats tab in the guest footer menu. Also returns the chat/creator id pairs
 * so the client can subscribe to realtime signals for instant badge updates.
 */
export async function GET(req: NextRequest) {
  const chats = await guestChats(req.headers);
  if (!chats.length) return NextResponse.json({ unread: 0, chats: [] });
  const counts = await guestUnreadCounts(chats);
  const unread = [...counts.values()].reduce((a, b) => a + b, 0);
  return NextResponse.json({
    unread,
    chats: chats.map((c) => ({ chatId: c.id, ownerId: c.owner_id })),
  });
}
