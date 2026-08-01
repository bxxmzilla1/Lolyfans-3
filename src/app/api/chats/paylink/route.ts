import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { ensureStripeCustomer } from "@/lib/payments";
import { formatTokens } from "@/lib/tokens";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { requestOrigin } from "@/lib/smsNotify";

/**
 * Creator builds a custom Stripe payment link (hosted Checkout) for a fan:
 * any token amount at any price. Useful when the fan wants to pay with a
 * different card than the one saved for one-tap top-ups — Checkout accepts
 * whatever card they type. The session carries the same "topup" metadata as
 * regular top-ups, so the webhook / return-confirm credit the tokens (and
 * refresh the saved card) with the existing flow. Links expire after 24h.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId, tokens, priceCents } = await req.json();
  const tokensNum = Math.round(Number(tokens));
  const priceNum = Math.round(Number(priceCents));
  if (!chatId || !(tokensNum > 0) || !(priceNum >= 50)) {
    return NextResponse.json(
      { error: "chatId, tokens and a price of at least $0.50 required" },
      { status: 400 }
    );
  }

  const { data: chat } = await supabaseAdmin()
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const origin = requestOrigin(req.headers);
  const customerId = await ensureStripeCustomer(chatId);

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    client_reference_id: chatId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: priceNum,
          product_data: {
            name: formatTokens(tokensNum),
            description: "Token top-up",
          },
        },
      },
    ],
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: {
        chatId,
        kind: "topup",
        tokens: String(tokensNum),
        packId: "custom-link",
      },
    },
    metadata: {
      chatId,
      kind: "topup",
      tokens: String(tokensNum),
      packId: "custom-link",
    },
    success_url: `${origin}/chat?topup=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/chat`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Could not create the link" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, url: session.url });
}
