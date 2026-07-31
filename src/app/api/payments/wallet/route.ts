import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { verifyPopupFromMetadata } from "@/lib/popupOffer";
import { payPerMessageFromMetadata } from "@/lib/payPerMessage";
import { settlePpmBalance } from "@/lib/payments";

/**
 * Fan payment state: card on file, Card Verify setting, and Pay per Message
 * (terms, free credit remaining, owed balance, declined). Also the lazy
 * trigger for the hourly owed-balance settlement.
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
    .select(
      "owner_id, stripe_payment_method_id, ppm_accepted_at, ppm_messages_used, ppm_balance_cents, ppm_credit_cents, ppm_credit_granted, ppm_card_declined"
    )
    .eq("id", chatId)
    .maybeSingle();
  const { data: ownerUser } = chat
    ? await db.auth.admin.getUserById(chat.owner_id)
    : { data: null };
  const ownerMeta = ownerUser?.user?.user_metadata ?? {};
  const ppm = payPerMessageFromMetadata(ownerMeta);

  let creditCents = chat?.ppm_credit_cents ?? 0;
  // One-time heal for fans who accepted under the old free-messages model.
  if (
    ppm.enabled &&
    chat?.ppm_accepted_at &&
    chat.ppm_credit_granted === false
  ) {
    const usedCost = (chat.ppm_messages_used ?? 0) * ppm.priceCents;
    creditCents = Math.max(0, ppm.freeCreditCents - usedCost);
    await db
      .from("chats")
      .update({ ppm_credit_cents: creditCents, ppm_credit_granted: true })
      .eq("id", chatId);
  }

  if (ppm.enabled && (chat?.ppm_balance_cents ?? 0) > 0) {
    after(() => settlePpmBalance(chatId));
  }

  return NextResponse.json({
    hasCard: !!chat?.stripe_payment_method_id,
    verifyPopup: verifyPopupFromMetadata(ownerMeta),
    ppm: {
      enabled: ppm.enabled,
      priceCents: ppm.priceCents,
      freeCreditCents: ppm.freeCreditCents,
      accepted: !!chat?.ppm_accepted_at,
      messagesUsed: chat?.ppm_messages_used ?? 0,
      creditCents,
      balanceCents: chat?.ppm_balance_cents ?? 0,
      declined: !!chat?.ppm_card_declined,
    },
  });
}
