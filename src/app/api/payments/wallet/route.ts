import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { grantPpmTokens, tokenBalance } from "@/lib/payments";
import { TOKEN_PACKS, tokensForCents } from "@/lib/tokens";
import {
  popupOfferFromMetadata,
  verifyPopupFromMetadata,
  welcomeOfferFromMetadata,
} from "@/lib/popupOffer";
import { payPerMessageFromMetadata } from "@/lib/payPerMessage";
import { paidSubFromMetadata } from "@/lib/paidSub";

/**
 * Fan wallet: current token balance + the top-up packs on offer, plus the
 * creator's Card Verify switch, Pay per Message config (token-priced) and
 * PaidSub state for this chat.
 */
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
        "owner_id, custom_offer, stripe_payment_method_id, ppm_accepted_at, ppm_credit_cents, ppm_credit_granted, paidsub_offer_at, paidsub_paid_at"
      )
      .eq("id", chatId)
      .maybeSingle(),
  ]);
  const { data: ownerUser } = chat
    ? await db.auth.admin.getUserById(chat.owner_id)
    : { data: null };
  const ownerMeta = ownerUser?.user?.user_metadata ?? {};

  const ppm = payPerMessageFromMetadata(ownerMeta);
  const paidSub = paidSubFromMetadata(ownerMeta);
  // PaidSub paid = unlimited messaging: all Pay per Message gating disappears.
  const paidSubPaid = !!chat?.paidsub_paid_at;
  if (paidSubPaid) ppm.enabled = false;

  let accepted = !!chat?.ppm_accepted_at;
  let freshBalance: number | null = null;
  if (ppm.enabled && chat) {
    const granted = await grantPpmTokens({
      chatId,
      freeCreditCents: ppm.freeCreditCents,
      chat,
      // Popup off → grant the free Tokens silently so chatting isn't blocked.
      silentAccept: !ppm.showPopup,
    });
    accepted = granted.accepted;
    freshBalance = granted.balance;
  }

  return NextResponse.json({
    balance: freshBalance ?? balance,
    packs: TOKEN_PACKS,
    firstTopupOffer: (topupCount ?? 0) === 0,
    offer: popupOfferFromMetadata(ownerMeta),
    welcomeOffer: welcomeOfferFromMetadata(ownerMeta),
    verifyPopup: verifyPopupFromMetadata(ownerMeta),
    hasCard: !!chat?.stripe_payment_method_id,
    customOffer: chat?.custom_offer ?? null,
    ppm: {
      enabled: ppm.enabled,
      showPopup: ppm.showPopup,
      priceCents: ppm.priceCents,
      priceTokens: tokensForCents(ppm.priceCents),
      freeCreditCents: ppm.freeCreditCents,
      freeTokens:
        ppm.freeCreditCents > 0 ? tokensForCents(ppm.freeCreditCents) : 0,
      accepted,
    },
    paidSub: {
      offered: paidSub.enabled && !!chat?.paidsub_offer_at && !paidSubPaid,
      paid: paidSubPaid,
      tokens: paidSub.tokens,
      priceCents: paidSub.priceCents,
      originalCents: paidSub.originalCents,
    },
  });
}
