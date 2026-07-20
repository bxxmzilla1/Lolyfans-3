import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fulfillCheckout,
  recordLifetimeSubscription,
  recordUnlock,
  saveStripePaymentMethod,
  syncSubscription,
} from "@/lib/payments";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

export const runtime = "nodejs";

/**
 * Stripe webhook. Must be pointed at the *canonical* host that does not 308
 * redirect (e.g. https://www.lolyfans.com/... if apex redirects to www).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    await fulfillCheckout(event.data.object as Stripe.Checkout.Session);
  }

  // Profile subscriptions: renewals, trial → active, cancellations, failures.
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await syncSubscription(event.data.object as Stripe.Subscription);
  }

  // Off-session unlocks and Elements lifetime purchases. Tip messages are
  // posted by /api/payments/tip directly; tip Checkout via session.completed.
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const chatId = pi.metadata?.chatId;
    if (!chatId) return NextResponse.json({ received: true });

    const paymentMethodId =
      typeof pi.payment_method === "string"
        ? pi.payment_method
        : pi.payment_method?.id ?? null;
    const customerId = typeof pi.customer === "string" ? pi.customer : null;

    if (pi.metadata?.kind === "unlock" && pi.metadata.messageId) {
      await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
      await recordUnlock({
        messageId: pi.metadata.messageId,
        chatId,
        priceCents: pi.amount ?? 0,
      });
    } else if (
      pi.metadata?.kind === "subscription" &&
      pi.metadata?.interval === "lifetime" &&
      pi.metadata.ownerId
    ) {
      await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
      await recordLifetimeSubscription({
        chatId,
        ownerId: pi.metadata.ownerId,
        priceCents: pi.amount ?? 0,
      });
    }
  }

  return NextResponse.json({ received: true });
}
