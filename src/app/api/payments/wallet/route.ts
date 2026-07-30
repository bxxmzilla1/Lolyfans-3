import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { verifyPopupFromMetadata } from "@/lib/popupOffer";
import { payPerMessageFromMetadata } from "@/lib/payPerMessage";
import { settlePpmBalance } from "@/lib/payments";

/**
 * Fan payment state: whether a card is saved (one-tap unlocks), the creator's
 * Card Verify setting, and the Pay per Message config + this chat's state
 * (terms accepted, free messages used, accrued balance, declined card).
 * Polled by the fan's chat — also the lazy trigger for the hourly balance
 * settlement.
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
      "owner_id, stripe_payment_method_id, ppm_accepted_at, ppm_messages_used, ppm_balance_cents, ppm_card_declined"
    )
    .eq("id", chatId)
    .maybeSingle();
  const { data: ownerUser } = chat
    ? await db.auth.admin.getUserById(chat.owner_id)
    : { data: null };
  const ownerMeta = ownerUser?.user?.user_metadata ?? {};
  const ppm = payPerMessageFromMetadata(ownerMeta);

  // Hourly auto-charge, attempted after the response so polls stay fast.
  if (ppm.enabled && (chat?.ppm_balance_cents ?? 0) > 0) {
    after(() => settlePpmBalance(chatId));
  }

  return NextResponse.json({
    hasCard: !!chat?.stripe_payment_method_id,
    verifyPopup: verifyPopupFromMetadata(ownerMeta),
    ppm: {
      enabled: ppm.enabled,
      priceCents: ppm.priceCents,
      freeMessages: ppm.freeMessages,
      accepted: !!chat?.ppm_accepted_at,
      messagesUsed: chat?.ppm_messages_used ?? 0,
      balanceCents: chat?.ppm_balance_cents ?? 0,
      declined: !!chat?.ppm_card_declined,
    },
  });
}
