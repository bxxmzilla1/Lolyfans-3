import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { tokenBalance } from "@/lib/payments";
import { TOKEN_PACKS } from "@/lib/tokens";
import {
  popupOfferFromMetadata,
  verifyPopupFromMetadata,
  welcomeOfferFromMetadata,
} from "@/lib/popupOffer";

/** Fan wallet: current token balance + the top-up packs on offer. */
export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Never topped up → the one-time first-purchase offer is still available,
  // priced per the creator's Pop up Offers settings.
  const db = supabaseAdmin();
  const [balance, { count: topupCount }, { data: chat }] = await Promise.all([
    tokenBalance(chatId),
    db
      .from("token_transactions")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chatId)
      .eq("kind", "topup"),
    db
      .from("chats")
      .select("owner_id, custom_offer, stripe_payment_method_id")
      .eq("id", chatId)
      .maybeSingle(),
  ]);
  const { data: ownerUser } = chat
    ? await db.auth.admin.getUserById(chat.owner_id)
    : { data: null };
  return NextResponse.json({
    balance,
    packs: TOKEN_PACKS,
    firstTopupOffer: (topupCount ?? 0) === 0,
    offer: popupOfferFromMetadata(ownerUser?.user?.user_metadata ?? {}),
    welcomeOffer: welcomeOfferFromMetadata(ownerUser?.user?.user_metadata ?? {}),
    verifyPopup: verifyPopupFromMetadata(ownerUser?.user?.user_metadata ?? {}),
    hasCard: !!chat?.stripe_payment_method_id,
    customOffer: chat?.custom_offer ?? null,
  });
}
