import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { guestAccessDestination } from "@/lib/subscriptionAccess";
import { ensureGuestChatWith } from "@/lib/guestChatWith";

/** Follow or unfollow a creator; their posts then appear in the home feed. */
export async function POST(req: NextRequest) {
  const { ownerId, follow } = await req.json();
  if (!ownerId) return NextResponse.json({ error: "ownerId required" }, { status: 400 });

  const chats = await guestChats(req.headers);
  if (!chats.length) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();

  if (follow) {
    // Following a creator opens a chat with them (created from the fan's
    // account if needed, inheriting their verified card), so the creator
    // sees the fan in their inbox and the fan gets them in their chat list.
    const ensured = await ensureGuestChatWith(ownerId, chats);
    if (!ensured) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const anchor = ensured.chat;

    // Paid profiles: free follows aren't a way around the paywall.
    const access = await guestAccessDestination(anchor.id, ownerId);
    if (!access.allowed) {
      return NextResponse.json(
        { error: "Subscribe to this profile first", paywall: access.href },
        { status: 402 }
      );
    }

    const { error } = await db
      .from("follows")
      .upsert({ chat_id: anchor.id, owner_id: ownerId }, { onConflict: "chat_id,owner_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const chatIds = chats.map((c) => c.id);
    const { error } = await db
      .from("follows")
      .delete()
      .in("chat_id", chatIds)
      .eq("owner_id", ownerId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, following: !!follow });
}
