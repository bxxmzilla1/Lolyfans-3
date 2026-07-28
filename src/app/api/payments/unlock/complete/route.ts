import { NextRequest, NextResponse } from "next/server";
import { guestOwnsChat } from "@/lib/guestAuth";
import { recordUnlock, saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";

/**
 * Called right after the embedded card wizard confirms an unlock
 * PaymentIntent: saves the card (one-tap from now on) and records the
 * unlock so the media reveals instantly. recordUnlock is idempotent, so
 * double delivery with the webhook is safe.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { chatId, paymentIntentId } = await req.json();
  if (!chatId || !paymentIntentId || typeof paymentIntentId !== "string") {
    return NextResponse.json(
      { error: "chatId and paymentIntentId required" },
      { status: 400 }
    );
  }
  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
  const messageId = pi.metadata?.messageId;
  if (
    pi.metadata?.chatId !== chatId ||
    pi.metadata?.kind !== "unlock" ||
    !messageId ||
    pi.status !== "succeeded"
  ) {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  // Save the card for one-tap purchases from now on.
  const paymentMethodId =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id ?? null;
  const customerId = typeof pi.customer === "string" ? pi.customer : null;
  await saveStripePaymentMethod(chatId, customerId, paymentMethodId);

  await recordUnlock({ messageId, chatId, priceCents: pi.amount });

  return NextResponse.json({ ok: true, unlocked: true, messageId });
}
