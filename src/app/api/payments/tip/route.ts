import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { ensureStripeCustomer, postTipMessage, tipMessageContent } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { requestOrigin } from "@/lib/smsNotify";
import Stripe from "stripe";

/**
 * Fan tip: one-tap charge when a card is saved, otherwise Stripe Checkout.
 * On success a tip message (optional caption) is posted into the chat.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { chatId, amountCents, caption } = await req.json();
  if (!chatId || !Number.isFinite(amountCents)) {
    return NextResponse.json({ error: "chatId and amountCents required" }, { status: 400 });
  }
  const amount = Math.round(Number(amountCents));
  if (amount < 100 || amount > 500_000) {
    return NextResponse.json({ error: "Tip must be between $1 and $5000" }, { status: 400 });
  }
  const note = String(caption || "").trim().slice(0, 1000);

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id, stripe_customer_id, stripe_payment_method_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const origin = requestOrigin(req.headers);
  const s = stripe();
  const description = tipMessageContent(amount, note).split("\n")[0];

  // One-tap when we already have a saved card.
  if (chat.stripe_customer_id && chat.stripe_payment_method_id) {
    try {
      await s.paymentIntents.create({
        amount,
        currency: "usd",
        customer: chat.stripe_customer_id,
        payment_method: chat.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: {
          chatId,
          kind: "tip",
          amountCents: String(amount),
          caption: note.slice(0, 450),
        },
        description,
      });
      const message = await postTipMessage({
        chatId,
        amountCents: amount,
        caption: note,
        ownerId: chat.owner_id,
      });
      return NextResponse.json({ ok: true, tipped: true, message });
    } catch (err) {
      const needsCheckout =
        err instanceof Stripe.errors.StripeCardError ||
        (err instanceof Stripe.errors.StripeInvalidRequestError &&
          err.code === "authentication_required");
      if (!needsCheckout && !(err instanceof Stripe.errors.StripeCardError)) {
        // Fall through to Checkout as recovery.
      }
    }
  }

  // Customer carries the fan's signup name/email so Checkout is prefilled.
  const customerId = await ensureStripeCustomer(chatId);

  const session = await s.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    client_reference_id: chatId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          product_data: {
            name: "Tip",
            description,
          },
        },
      },
    ],
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: {
        chatId,
        kind: "tip",
        amountCents: String(amount),
        caption: note.slice(0, 450),
      },
    },
    metadata: {
      chatId,
      kind: "tip",
      amountCents: String(amount),
      caption: note.slice(0, 450),
    },
    success_url: `${origin}/chat?tipped=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/chat`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }
  return NextResponse.json({ checkoutUrl: session.url });
}
