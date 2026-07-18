import { NextRequest, NextResponse } from "next/server";
import { guestChats, guestUnreadCounts } from "@/lib/guest";

/**
 * Total unread messages across the guest's chats — drives the badge on the
 * Chats tab in the guest footer menu.
 */
export async function GET(req: NextRequest) {
  const chats = await guestChats(req.headers);
  if (!chats.length) return NextResponse.json({ unread: 0 });
  const counts = await guestUnreadCounts(chats);
  const unread = [...counts.values()].reduce((a, b) => a + b, 0);
  return NextResponse.json({ unread });
}
