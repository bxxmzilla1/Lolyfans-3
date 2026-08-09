import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  creditTokens,
  fulfillCheckout,
  recordBlurDrainTap,
  recordLifetimeSubscription,
  recordUnlock,
  saveStripePaymentMethod,
  syncSubscription,
} from "@/lib/payments";
import { parseBlurDrainer } from "@/lib/blurDrainer";
import {
  fanChatForCard,
  getUnlock,
  markPaidAndDeliver,
} from "@/lib/telegramUnlock";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

export const runtime = "nodejs";
// Telegram unlock deliveries (videos) can take minutes.
export const maxDuration = 300;

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

    // Telegram-DM unlock: deliver the clear media (safety net for the
    // client-side complete call). May have no chatId when the fan paid with
    // a new card, so handle it before the chat-scoped branches below.
    if (pi.metadata?.kind === "tg-unlock" && pi.metadata.unlockId) {
      const unlock = await getUnlock(pi.metadata.unlockId);
      if (unlock) {
        // Register the card so double-tap works from the first payment —
        // even when the fan closed the tab before the complete call ran.
        // Unrecognised fans (paying on the pay-link domain) get a hidden
        // chat tied to their Telegram peer to hold the card.
        const pmId =
          typeof pi.payment_method === "string"
            ? pi.payment_method
            : pi.payment_method?.id ?? null;
        const custId = typeof pi.customer === "string" ? pi.customer : null;
        let tgChatId: string | null =
          pi.metadata.chatId ?? unlock.paid_chat_id ?? null;
        if (!tgChatId && custId && pmId) {
          tgChatId = await fanChatForCard({ unlock });
        }
        if (tgChatId) {
          await saveStripePaymentMethod(tgChatId, custId, pmId);
        }
        await markPaidAndDeliver({
          unlock,
          chatId: tgChatId,
          paymentIntentId: pi.id,
        });
      }
      return NextResponse.json({ received: true });
    }

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
