import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { verifyPopupFromMetadata } from "@/lib/popupOffer";

/**
 * Fan payment state: whether a card is saved (one-tap unlocks) and the
 * creator's Card Verify setting. The token wallet is gone — unlocks are
 * direct one-tap card purchases now.
 */
export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("owner_id, stripe_payment_method_id")
    .eq("id", chatId)
    .maybeSingle();
  const { data: ownerUser } = chat
    ? await db.auth.admin.getUserById(chat.owner_id)
    : { data: null };
  return NextResponse.json({
    hasCard: !!chat?.stripe_payment_method_id,
    verifyPopup: verifyPopupFromMetadata(ownerUser?.user?.user_metadata ?? {}),
  });
}
