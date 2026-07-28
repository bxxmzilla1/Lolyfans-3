import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { ensureStripeCustomer, recordUnlock } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { requestOrigin } from "@/lib/smsNotify";
import { visitorCountryCode } from "@/lib/geo";
import Stripe from "stripe";

/**
 * Unlock locked media with a direct card charge (no wallet). One-tap with a
 * saved card; otherwise the client shows the embedded 3-step card wizard
 * (which also saves the card so the next unlock is one tap), with hosted
 * Checkout as a last-resort fallback.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { messageId, embedded } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, media_path, media_type, media_items, price_cents, locked")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasMedia =
    !!message.media_path ||
    (Array.isArray(message.media_items) && message.media_items.length > 0);
  const price = message.price_cents ?? 0;
  if (!message.locked || price <= 0 || !hasMedia) {
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
    return NextResponse.json({ ok: true, unlocked: true });
  }

  const { data: chat } = await db
    .from("chats")
    .select("stripe_customer_id, stripe_payment_method_id")
    .eq("id", message.chat_id)
    .maybeSingle();

  const s = stripe();
  const metadata = {
    chatId: message.chat_id,
    kind: "unlock",
    messageId: message.id,
  };

  // One-tap when we already have a saved card.
  if (chat?.stripe_customer_id && chat?.stripe_payment_method_id) {
    try {
      await s.paymentIntents.create({
        amount: price,
        currency: "usd",
        customer: chat.stripe_customer_id,
        payment_method: chat.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata,
        description: "Unlock content",
      });
      await recordUnlock({
        messageId: message.id,
        chatId: message.chat_id,
        priceCents: price,
      });
      return NextResponse.json({ ok: true, unlocked: true });
    } catch (err) {
      // Card declined / needs authentication — fall through so the fan can
      // enter a card in the wizard (or Checkout) instead.
      const recoverable =
        err instanceof Stripe.errors.StripeCardError ||
        (err instanceof Stripe.errors.StripeInvalidRequestError &&
          err.code === "authentication_required");
      if (!recoverable) {
        // Unexpected Stripe error — still offer the card entry recovery path.
      }
    }
  }

  // First purchase (or card retry): the fan enters their card. Embedded mode
  // keeps them in the chat; the card is saved for one-tap next time.
  const customerId = await ensureStripeCustomer(message.chat_id);

  if (embedded === true) {
    const pi = await s.paymentIntents.create({
      amount: price,
      currency: "usd",
      customer: customerId,
      payment_method_types: ["card"],
      setup_future_usage: "off_session",
      metadata,
      description: "Unlock content",
    });
    return NextResponse.json({
      clientSecret: pi.client_secret,
      amountCents: price,
      country: await visitorCountryCode(req.headers),
    });
  }

  const origin = requestOrigin(req.headers);
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
          product_data: { name: "Unlock content" },
        },
      },
    ],
    payment_intent_data: { setup_future_usage: "off_session", metadata },
    metadata,
    success_url: `${origin}/chat?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/chat`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }
  return NextResponse.json({ checkoutUrl: session.url });
}
