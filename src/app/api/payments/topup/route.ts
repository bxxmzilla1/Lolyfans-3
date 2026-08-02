import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { creditTokens, ensureStripeCustomer, tokenBalance } from "@/lib/payments";
import { packById, packTotalTokens, formatTokens } from "@/lib/tokens";
import { parseCouponMessage } from "@/lib/coupon";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { requestOrigin } from "@/lib/smsNotify";
import { visitorCountryCode } from "@/lib/geo";
import Stripe from "stripe";

/**
 * Token top-up. One-tap: with a saved card the pack is charged off-session
 * and credited instantly. First purchase goes through Stripe Checkout, which
 * saves the card so every later top-up is one tap. Also redeems creator-sent
 * coupon messages (couponMessageId) as a one-time discounted pack.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { chatId, packId, returnTo, embedded, couponMessageId } = await req.json();
  if (!chatId || (!packId && !couponMessageId)) {
    return NextResponse.json(
      { error: "chatId and packId (or couponMessageId) required" },
      { status: 400 }
    );
  }
  // Where Checkout drops the fan afterwards: the chat (default) or the Wallet tab.
  const returnPath = returnTo === "profile" ? "/profile" : "/chat";

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

  // Chat coupon bubble: one-time claim priced from the message body.
  let couponMsgId: string | null = null;
  let couponTokens = 0;
  let couponPrice = 0;
  let couponOriginal = 0;
  if (couponMessageId) {
    const { data: msg } = await db
      .from("messages")
      .select("id, chat_id, sender, content")
      .eq("id", couponMessageId)
      .eq("chat_id", chatId)
      .maybeSingle();
    const coupon = parseCouponMessage(msg?.content);
    if (!msg || msg.sender !== "owner" || !coupon) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }
    const { count: redeemed } = await db
      .from("token_transactions")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chatId)
      .eq("message_id", msg.id)
      .eq("kind", "topup");
    if ((redeemed ?? 0) > 0) {
      return NextResponse.json(
        { error: "This coupon has already been used" },
        { status: 410 }
      );
    }
    couponMsgId = msg.id;
    couponTokens = coupon.tokens;
    couponPrice = coupon.priceCents;
    couponOriginal = coupon.originalCents;
  }

  const pack = couponMsgId ? null : packById(String(packId));
  if (!couponMsgId && !pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 400 });
  }

  let priceCents = pack?.priceCents ?? 0;
  let tokens = pack ? packTotalTokens(pack) : 0;
  let originalCents = pack?.priceCents ?? 0;
  if (couponMsgId) {
    priceCents = couponPrice;
    tokens = couponTokens;
    originalCents = couponOriginal;
  }

  // One-tap when we already have a saved card.
  if (chat.stripe_customer_id && chat.stripe_payment_method_id) {
    try {
      const pi = await s.paymentIntents.create({
        amount: priceCents,
        currency: "usd",
        customer: chat.stripe_customer_id,
        payment_method: chat.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: {
          chatId,
          kind: "topup",
          tokens: String(tokens),
          packId: pack?.id ?? "coupon",
          ...(couponMsgId ? { couponMessageId: couponMsgId } : {}),
        },
        description: `Top up ${formatTokens(tokens)}`,
      });
      const balance = await creditTokens({
        chatId,
        tokens,
        paymentIntentId: pi.id,
        messageId: couponMsgId,
      });
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

  // First purchase (or card retry): the fan enters their card. Embedded mode
  // keeps them in the chat — a PaymentIntent confirmed by the in-page 3-step
  // card wizard (the webhook + /topup/complete credit the tokens). Otherwise
  // fall back to hosted Checkout. Both save the card for one-tap next time.
  const customerId = await ensureStripeCustomer(chatId);

  const packMeta = pack?.id ?? "coupon";
  const offerDesc = couponMsgId
    ? `One-time offer — normally $${(originalCents / 100).toFixed(2)}`
    : pack && pack.bonusTokens > 0
      ? `${pack.tokens} Tokens + ${pack.bonusTokens} bonus`
      : "Token top-up";

  if (embedded === true) {
    const pi = await s.paymentIntents.create({
      amount: priceCents,
      currency: "usd",
      customer: customerId,
      payment_method_types: ["card"],
      setup_future_usage: "off_session",
      metadata: {
        chatId,
        kind: "topup",
        tokens: String(tokens),
        packId: packMeta,
        ...(couponMsgId ? { couponMessageId: couponMsgId } : {}),
      },
      description: `Top up ${formatTokens(tokens)}`,
    });
    return NextResponse.json({
      clientSecret: pi.client_secret,
      amountCents: priceCents,
      tokens,
      country: await visitorCountryCode(req.headers),
    });
  }
  const session = await s.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    client_reference_id: chatId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: priceCents,
          product_data: {
            name: formatTokens(tokens),
            description: offerDesc,
          },
        },
      },
    ],
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: {
        chatId,
        kind: "topup",
        tokens: String(tokens),
        packId: packMeta,
        ...(couponMsgId ? { couponMessageId: couponMsgId } : {}),
      },
    },
    metadata: {
      chatId,
      kind: "topup",
      tokens: String(tokens),
      packId: packMeta,
      ...(couponMsgId ? { couponMessageId: couponMsgId } : {}),
    },
    success_url: `${origin}${returnPath}?topup=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${returnPath}`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }
  return NextResponse.json({ checkoutUrl: session.url });
}
