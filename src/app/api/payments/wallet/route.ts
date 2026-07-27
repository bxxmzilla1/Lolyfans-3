import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { tokenBalance } from "@/lib/payments";
import {
  AUTO_REFILL_BONUS_PERCENT,
  AUTO_REFILL_THRESHOLD_TOKENS,
  TOKEN_PACKS,
  packById,
} from "@/lib/tokens";
import { popupOfferFromMetadata, welcomeOfferFromMetadata } from "@/lib/popupOffer";

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
      .select("owner_id, custom_offer, auto_refill_pack_id, stripe_payment_method_id")
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
    customOffer: chat?.custom_offer ?? null,
    autoRefill: {
      packId: chat?.auto_refill_pack_id ?? null,
      threshold: AUTO_REFILL_THRESHOLD_TOKENS,
      bonusPercent: AUTO_REFILL_BONUS_PERCENT,
      // Auto refill charges the saved card; without one it can't run yet.
      hasCard: !!chat?.stripe_payment_method_id,
    },
  });
}

/** Fan turns auto refill on (with a pack) or off. */
export async function POST(req: NextRequest) {
  const { chatId, autoRefillPackId } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const packId = autoRefillPackId ? String(autoRefillPackId) : null;
  if (packId && !packById(packId)) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("chats")
    .update({ auto_refill_pack_id: packId })
    .eq("id", chatId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, autoRefillPackId: packId });
}
