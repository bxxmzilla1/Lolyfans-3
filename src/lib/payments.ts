import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

/** Record that a fan unlocked a message (idempotent) and notify the chat. */
export async function recordUnlock(opts: {
  messageId: string;
  chatId: string;
  priceCents: number;
}) {
  const db = supabaseAdmin();
  await db.from("message_unlocks").upsert(
    {
      message_id: opts.messageId,
      chat_id: opts.chatId,
      price_cents: opts.priceCents,
    },
    { onConflict: "message_id,chat_id", ignoreDuplicates: true }
  );
  await broadcast(`chat:${opts.chatId}`, "message-unlocked", {
    messageId: opts.messageId,
  });
}

/**
 * After a paid Checkout session: save the card for one-tap unlocks and mark
 * the media unlocked. Safe to call from the webhook or from the return URL.
 */
export async function fulfillUnlockCheckout(session: Stripe.Checkout.Session) {
  if (session.metadata?.kind !== "unlock") return false;
  if (session.payment_status !== "paid" && session.status !== "complete") {
    return false;
  }

  const chatId = session.metadata.chatId;
  const messageId = session.metadata.messageId;
  if (!chatId || !messageId) return false;

  const db = supabaseAdmin();
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  let paymentMethodId: string | null = null;
  if (paymentIntentId) {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
    paymentMethodId =
      typeof pi.payment_method === "string"
        ? pi.payment_method
        : pi.payment_method?.id ?? null;
  }

  const patch: Record<string, string> = {};
  if (customerId) patch.stripe_customer_id = customerId;
  if (paymentMethodId) patch.stripe_payment_method_id = paymentMethodId;
  if (Object.keys(patch).length) {
    await db.from("chats").update(patch).eq("id", chatId);
  }

  const { data: message } = await db
    .from("messages")
    .select("price_cents")
    .eq("id", messageId)
    .maybeSingle();

  await recordUnlock({
    messageId,
    chatId,
    priceCents: message?.price_cents ?? session.amount_total ?? 0,
  });
  return true;
}
