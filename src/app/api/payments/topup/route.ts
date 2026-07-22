import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { creditTokens, ensureStripeCustomer, tokenBalance } from "@/lib/payments";
import { packById, packTotalTokens, formatTokens } from "@/lib/tokens";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { requestOrigin } from "@/lib/smsNotify";
import Stripe from "stripe";

/**
 * Token top-up. One-tap: with a saved card the pack is charged off-session
 * and credited instantly. First purchase goes through Stripe Checkout, which
 * saves the card so every later top-up is one tap.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { chatId, packId } = await req.json();
  if (!chatId || !packId) {
    return NextResponse.json({ error: "chatId and packId required" }, { status: 400 });
  }
  const pack = packById(String(packId));
  if (!pack) return NextResponse.json({ error: "Unknown pack" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, stripe_customer_id, stripe_payment_method_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const tokens = packTotalTokens(pack);
  const origin = requestOrigin(req.headers);
  const s = stripe();

  // One-tap when we already have a saved card.
  if (chat.stripe_customer_id && chat.stripe_payment_method_id) {
    try {
      const pi = await s.paymentIntents.create({
        amount: pack.priceCents,
        currency: "usd",
        customer: chat.stripe_customer_id,
        payment_method: chat.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: {
          chatId,
          kind: "topup",
          tokens: String(tokens),
          packId: pack.id,
        },
        description: `Top up ${formatTokens(tokens)}`,
      });
      const balance = await creditTokens({ chatId, tokens, paymentIntentId: pi.id });
      return NextResponse.json({
        ok: true,
        topped: true,
        tokens,
        balance: balance ?? (await tokenBalance(chatId)),
      });
    } catch (err) {
      // Card declined / needs authentication — fall through to Checkout.
      const recoverable =
        err instanceof Stripe.errors.StripeCardError ||
        (err instanceof Stripe.errors.StripeInvalidRequestError &&
          err.code === "authentication_required");
      if (!recoverable) {
        // Unexpected Stripe error — still offer Checkout as a recovery path.
      }
    }
  }

  // First purchase (or card retry): hosted Checkout that also saves the card.
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
          unit_amount: pack.priceCents,
          product_data: {
            name: formatTokens(tokens),
            description:
              pack.bonusTokens > 0
                ? `${pack.tokens} Tokens + ${pack.bonusTokens} bonus`
                : "Token top-up",
          },
        },
      },
    ],
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: { chatId, kind: "topup", tokens: String(tokens), packId: pack.id },
    },
    metadata: { chatId, kind: "topup", tokens: String(tokens), packId: pack.id },
    success_url: `${origin}/chat?topup=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/chat`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }
  return NextResponse.json({ checkoutUrl: session.url });
}
