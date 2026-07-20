import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { ensureStripeCustomer, recordUnlock } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { requestOrigin } from "@/lib/smsNotify";
import Stripe from "stripe";

/**
 * One-tap unlock with Stripe.
 *
 * - Already unlocked → free reveal.
 * - Saved card on file → off-session charge, unlock instantly.
 * - No card / bank asks for auth → Stripe Checkout (saves card for next time).
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { messageId } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, media_path, media_type, price_cents, locked")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const price = message.price_cents ?? 0;
  if (!message.locked || price <= 0) {
    return NextResponse.json({ error: "This message is not for sale" }, { status: 400 });
  }

  // Already unlocked?
  const { data: existing } = await db
    .from("message_unlocks")
    .select("message_id")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      ok: true,
      unlocked: true,
      media: { media_path: message.media_path, media_type: message.media_type },
    });
  }

  const { data: chat } = await db
    .from("chats")
    .select("id, stripe_customer_id, stripe_payment_method_id")
    .eq("id", message.chat_id)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const origin = requestOrigin(req.headers);
  const s = stripe();

  // Try one-tap charge when we already have a saved card.
  if (chat.stripe_customer_id && chat.stripe_payment_method_id) {
    try {
      await s.paymentIntents.create({
        amount: price,
        currency: "usd",
        customer: chat.stripe_customer_id,
        payment_method: chat.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: {
          chatId: message.chat_id,
          messageId: message.id,
          kind: "unlock",
        },
        description: `Unlock media · $${(price / 100).toFixed(2)}`,
      });
      await recordUnlock({
        messageId: message.id,
        chatId: message.chat_id,
        priceCents: price,
      });
      return NextResponse.json({
        ok: true,
        unlocked: true,
        media: { media_path: message.media_path, media_type: message.media_type },
      });
    } catch (err) {
      // Card needs authentication or was declined — fall through to Checkout.
      const code =
        err instanceof Stripe.errors.StripeCardError ||
        err instanceof Stripe.errors.StripeInvalidRequestError
          ? err.code
          : null;
      if (code !== "authentication_required" && !(err instanceof Stripe.errors.StripeCardError)) {
        // Unexpected Stripe error — still offer Checkout as a recovery path.
      }
    }
  }

  // First purchase (or retry): hosted Checkout that also saves the card.
  // The customer carries the fan's signup name/email so it's prefilled.
  const customerId = await ensureStripeCustomer(message.chat_id);

  const session = await s.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    client_reference_id: message.chat_id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: price,
          product_data: {
            name: "Unlock media",
            description: `One-time unlock · $${(price / 100).toFixed(2)}`,
          },
        },
      },
    ],
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: {
        chatId: message.chat_id,
        messageId: message.id,
        kind: "unlock",
      },
    },
    metadata: {
      chatId: message.chat_id,
      messageId: message.id,
      kind: "unlock",
    },
    // session_id lets /api/payments/confirm unlock even when the webhook
    // fails (common when the apex domain 308-redirects to www).
    success_url: `${origin}/chat?paid=${message.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/chat`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }

  return NextResponse.json({ checkoutUrl: session.url });
}
