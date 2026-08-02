import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tgSessionFor, tgDeliverMedia } from "@/lib/telegram";

export type TelegramUnlock = {
  id: string;
  owner_id: string;
  media_path: string;
  media_type: "image" | "video";
  price_cents: number;
  tg_peer: string;
  status: string;
  paid_chat_id: string | null;
  stripe_payment_intent_id: string | null;
  delivered_at: string | null;
};

export async function getUnlock(id: string): Promise<TelegramUnlock | null> {
  const { data } = await supabaseAdmin()
    .from("telegram_unlocks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as TelegramUnlock | null) ?? null;
}

/**
 * Mark an unlock paid (idempotent) and deliver the clear media into the fan's
 * Telegram DM. Safe to call from the one-tap charge, the card-wizard complete
 * step, or the Stripe webhook — the `delivered_at` guard prevents double sends.
 */
export async function markPaidAndDeliver(opts: {
  unlock: TelegramUnlock;
  chatId?: string | null;
  paymentIntentId?: string | null;
}): Promise<void> {
  const db = supabaseAdmin();
  const { unlock } = opts;

  // Already delivered? Nothing to do.
  if (unlock.delivered_at) return;

  await db
    .from("telegram_unlocks")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_chat_id: opts.chatId ?? unlock.paid_chat_id ?? null,
      stripe_payment_intent_id:
        opts.paymentIntentId ?? unlock.stripe_payment_intent_id ?? null,
    })
    .eq("id", unlock.id);

  const session = await tgSessionFor(unlock.owner_id);
  if (!session) return; // Telegram got disconnected — payment still recorded.

  try {
    await tgDeliverMedia({
      session,
      peer: unlock.tg_peer,
      mediaPath: unlock.media_path,
      mediaType: unlock.media_type,
    });
    await db
      .from("telegram_unlocks")
      .update({ delivered_at: new Date().toISOString() })
      .eq("id", unlock.id);
  } catch {
    // Delivery failed (session dropped, peer unreachable). Payment stays
    // recorded; the creator can resend from the app.
  }
}
