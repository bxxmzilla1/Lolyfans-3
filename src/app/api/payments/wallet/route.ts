import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { tokenBalance } from "@/lib/payments";
import {
  AUTO_REFILL_BONUS_PERCENT,
  AUTO_REFILL_FIRST_MULTIPLIER,
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
      .select(
        "owner_id, custom_offer, auto_refill_pack_id, last_topup_pack_id, stripe_payment_method_id"
      )
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
      // Refills always follow the fan's last purchased pack.
      lastPackId: chat?.last_topup_pack_id ?? null,
      threshold: AUTO_REFILL_THRESHOLD_TOKENS,
      bonusPercent: AUTO_REFILL_BONUS_PERCENT,
      firstMultiplier: AUTO_REFILL_FIRST_MULTIPLIER,
      // Auto refill charges the saved card; without one it can't run yet.
      hasCard: !!chat?.stripe_payment_method_id,
    },
  });
}

/**
 * Fan turns auto refill on or off. No pack choice: the refill pack is
 * always the last pack they bought. `firstDouble` marks the activation as
 * coming from the post-purchase offer popup — the next refill grants 2X
 * the pack's tokens.
 */
export async function POST(req: NextRequest) {
  const { chatId, enable, firstDouble } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  if (!enable) {
    const { error } = await db
      .from("chats")
      .update({ auto_refill_pack_id: null, auto_refill_double_next: false })
      .eq("id", chatId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, autoRefillPackId: null });
  }

  const { data: chat } = await db
    .from("chats")
    .select("last_topup_pack_id")
    .eq("id", chatId)
    .maybeSingle();
  // Fallback for fans who somehow never bought a pack: the most popular one.
  const packId =
    (chat?.last_topup_pack_id && packById(chat.last_topup_pack_id)?.id) || "plus";

  const { error } = await db
    .from("chats")
    .update({
      auto_refill_pack_id: packId,
      ...(firstDouble ? { auto_refill_double_next: true } : {}),
    })
    .eq("id", chatId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, autoRefillPackId: packId });
}
