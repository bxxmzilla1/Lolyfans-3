import { NextRequest, NextResponse } from "next/server";
import { guestChats } from "@/lib/guest";
import {
  recordLifetimeSubscription,
  saveStripePaymentMethod,
  syncSubscription,
} from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import type Stripe from "stripe";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Called after the Payment Element confirms on the client (or on return from
 * a 3-D Secure redirect): verifies the payment with Stripe, saves the card
 * for one-tap pays, and marks the fan subscribed. Idempotent — the webhook
 * covers the same ground as a safety net.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { ownerId, subscriptionId, paymentIntentId } = await req.json();
  if (!ownerId || typeof ownerId !== "string") {
    return NextResponse.json({ error: "ownerId required" }, { status: 400 });
  }

  const chats = await guestChats(req.headers);
  const chat = chats.find((c) => c.owner_id === ownerId);
  if (!chat) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const s = stripe();

  // Lifetime plan: verify the one-time PaymentIntent.
  if (paymentIntentId && typeof paymentIntentId === "string") {
    const pi = await s.paymentIntents.retrieve(paymentIntentId);
    if (
      pi.metadata?.chatId !== chat.id ||
      pi.metadata?.ownerId !== ownerId ||
      pi.metadata?.kind !== "subscription"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (pi.status !== "succeeded") {
      return NextResponse.json(
        { error: "Payment not completed", status: pi.status },
        { status: 402 }
      );
    }
    await saveStripePaymentMethod(
      chat.id,
      typeof pi.customer === "string" ? pi.customer : pi.customer?.id,
      typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id
    );
    await recordLifetimeSubscription({
      chatId: chat.id,
      ownerId,
      priceCents: pi.amount,
    });
    return NextResponse.json({ ok: true, subscribed: true });
  }

  if (!subscriptionId || typeof subscriptionId !== "string") {
    return NextResponse.json({ error: "subscriptionId required" }, { status: 400 });
  }

  // Recurring plan: the subscription flips to active moments after the
  // invoice payment confirms, so poll briefly before giving up.
  let sub: Stripe.Subscription | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    sub = await s.subscriptions.retrieve(subscriptionId, {
      expand: ["default_payment_method", "pending_setup_intent"],
    });
    if (sub.status === "active" || sub.status === "trialing") break;
    await sleep(1200);
  }
  if (!sub || sub.metadata?.chatId !== chat.id || sub.metadata?.ownerId !== ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sub.status !== "active" && sub.status !== "trialing") {
    return NextResponse.json(
      { error: "Payment not completed", status: sub.status },
      { status: 402 }
    );
  }

  let pmId =
    typeof sub.default_payment_method === "string"
      ? sub.default_payment_method
      : sub.default_payment_method?.id ?? null;
  if (!pmId) {
    const si = sub.pending_setup_intent as Stripe.SetupIntent | null;
    pmId =
      typeof si?.payment_method === "string"
        ? si.payment_method
        : si?.payment_method?.id ?? null;
  }
  await saveStripePaymentMethod(
    chat.id,
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    pmId
  );
  await syncSubscription(sub);
  return NextResponse.json({ ok: true, subscribed: true });
}
