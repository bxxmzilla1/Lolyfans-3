import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  applyPpmSettlement,
  creditTokens,
  fulfillCheckout,
  markPaidSubPaid,
  recordBlurDrainTap,
  recordLifetimeSubscription,
  recordUnlock,
  saveStripePaymentMethod,
  syncSubscription,
} from "@/lib/payments";
import { parseBlurDrainer } from "@/lib/blurDrainer";
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

    if (pi.metadata?.kind === "topup") {
      // Token top-up (one-tap or Checkout). creditTokens is idempotent per
      // payment intent, so double delivery with /topup or /confirm is safe.
      const tokens = Math.max(0, Math.round(Number(pi.metadata.tokens || 0)));
      if (tokens > 0) {
        await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
        await creditTokens({ chatId, tokens, paymentIntentId: pi.id });
      }
    } else if (pi.metadata?.kind === "unlock" && pi.metadata.messageId) {
      await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
      await recordUnlock({
        messageId: pi.metadata.messageId,
        chatId,
        priceCents: pi.amount ?? 0,
      });
    } else if (pi.metadata?.kind === "paidsub") {
      // One-time unlimited-messaging purchase (idempotent with /complete).
      await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
      await markPaidSubPaid(chatId);
    } else if (pi.metadata?.kind === "blur-drain" && pi.metadata.messageId) {
      await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
      const { data: msg } = await supabaseAdmin()
        .from("messages")
        .select("blur_drainer")
        .eq("id", pi.metadata.messageId)
        .maybeSingle();
      const cfg = parseBlurDrainer(msg?.blur_drainer);
      if (cfg) {
        await recordBlurDrainTap({
          messageId: pi.metadata.messageId,
          chatId,
          layers: cfg.layers,
          paymentIntentId: pi.id,
        });
      }
    } else if (
      pi.metadata?.kind === "blur-drain-settle" &&
      pi.metadata.messageId
    ) {
      await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
      if (pi.metadata.refog === "1") {
        // Failed-settlement retry paid through the card sheet: restore every
        // layer the batch covered (idempotent with the client's completion
        // call via the tap ledger).
        const { data: msg } = await supabaseAdmin()
          .from("messages")
          .select("blur_drainer")
          .eq("id", pi.metadata.messageId)
          .maybeSingle();
        const cfg = parseBlurDrainer(msg?.blur_drainer);
        if (cfg) {
          await recordBlurDrainTap({
            messageId: pi.metadata.messageId,
            chatId,
            layers: cfg.layers,
            paymentIntentId: pi.id,
            count: Math.max(1, Math.round(Number(pi.metadata.layersCount)) || 1),
          });
        }
      } else {
        // Server-confirmed batch settlement: layers were already advanced at
        // tap time — just make sure the ledger row exists.
        await supabaseAdmin().from("message_blur_taps").upsert(
          {
            stripe_payment_intent_id: pi.id,
            message_id: pi.metadata.messageId,
            chat_id: chatId,
          },
          { onConflict: "stripe_payment_intent_id", ignoreDuplicates: true }
        );
      }
    } else if (pi.metadata?.kind === "ppm-settle") {
      // Hourly Pay per Message auto-charge: clear the billed amount from the
      // fan's balance (idempotent with the settle call that created the PI).
      await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
      const amount =
        Math.round(Number(pi.metadata.amountCents)) || pi.amount || 0;
      if (amount > 0) {
        await applyPpmSettlement({
          chatId,
          amountCents: amount,
          paymentIntentId: pi.id,
        });
      }
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
