import { NextRequest, NextResponse } from "next/server";
import { guestOwnsChat } from "@/lib/guestAuth";
import { markPaidSubPaid, saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";

/**
 * Called after the embedded wizard confirms a PaidSub PaymentIntent: saves
 * the card and marks the chat paid so the blocking popup closes instantly.
 * markPaidSubPaid is idempotent, so double delivery with the webhook is safe.
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
  if (
    pi.metadata?.chatId !== chatId ||
    pi.metadata?.kind !== "paidsub" ||
    pi.status !== "succeeded"
  ) {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  const paymentMethodId =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id ?? null;
  const customerId = typeof pi.customer === "string" ? pi.customer : null;
  await saveStripePaymentMethod(chatId, customerId, paymentMethodId);

  await markPaidSubPaid(chatId);

  return NextResponse.json({ ok: true, paid: true });
}
