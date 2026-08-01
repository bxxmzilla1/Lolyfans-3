import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import {
  creditTokens,
  saveStripePaymentMethod,
  tokenBalance,
} from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";

/**
 * Called right after the embedded card wizard confirms a top-up
 * PaymentIntent, so the fan sees their tokens instantly instead of waiting
 * for the webhook. creditTokens is idempotent per payment intent, so double
 * delivery with the webhook is safe.
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
    pi.metadata?.kind !== "topup" ||
    pi.status !== "succeeded"
  ) {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  const tokens = Math.max(0, Math.round(Number(pi.metadata.tokens || 0)));
  if (!tokens) {
    return NextResponse.json({ error: "Nothing to credit" }, { status: 400 });
  }

  // Save the card for one-tap purchases from now on.
  const paymentMethodId =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id ?? null;
  const customerId = typeof pi.customer === "string" ? pi.customer : null;
  await saveStripePaymentMethod(chatId, customerId, paymentMethodId);

  const couponMessageId =
    typeof pi.metadata?.couponMessageId === "string"
      ? pi.metadata.couponMessageId
      : null;
  const balance = await creditTokens({
    chatId,
    tokens,
    paymentIntentId: pi.id,
    messageId: couponMessageId,
  });

  // A claimed creator-sent offer is single-use: clear it once paid.
  if (pi.metadata?.customOffer === "1") {
    await supabaseAdmin().from("chats").update({ custom_offer: null }).eq("id", chatId);
  }

  return NextResponse.json({
    ok: true,
    tokens,
    balance: balance ?? (await tokenBalance(chatId)),
  });
}
