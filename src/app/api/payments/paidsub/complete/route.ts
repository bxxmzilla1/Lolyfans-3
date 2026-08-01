import { NextRequest, NextResponse } from "next/server";
import { guestOwnsChat } from "@/lib/guestAuth";
import {
  creditTokens,
  markPaidSubPaid,
  saveStripePaymentMethod,
  tokenBalance,
} from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";

/**
 * After the embedded wizard confirms a PaidSub PaymentIntent: save the card,
 * credit the Token pack (first top-up), and mark unlimited messaging active.
 * Both creditTokens and markPaidSubPaid are idempotent with the webhook.
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

  const tokens = Math.max(0, Math.round(Number(pi.metadata?.tokens || 0)));
  let balance: number | null = null;
  if (tokens > 0) {
    balance = await creditTokens({
      chatId,
      tokens,
      paymentIntentId: pi.id,
    });
  }
  await markPaidSubPaid(chatId);

  return NextResponse.json({
    ok: true,
    paid: true,
    tokens,
    balance: balance ?? (await tokenBalance(chatId)),
  });
}
