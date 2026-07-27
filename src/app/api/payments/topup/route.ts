import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { creditTokens, ensureStripeCustomer, tokenBalance } from "@/lib/payments";
import {
  packById,
  packTotalTokens,
  formatTokens,
  FIRST_TOPUP_OFFER_PACK_ID,
} from "@/lib/tokens";
import { popupOfferFromMetadata, welcomeOfferFromMetadata } from "@/lib/popupOffer";
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

  const { chatId, packId, returnTo, claimOffer } = await req.json();
  if (!chatId || !packId) {
    return NextResponse.json({ error: "chatId and packId required" }, { status: 400 });
  }
  // Where Checkout drops the fan afterwards: the chat (default) or the Wallet tab.
  const returnPath = returnTo === "profile" ? "/profile" : "/chat";
  const pack = packById(String(packId));
  if (!pack) return NextResponse.json({ error: "Unknown pack" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id, stripe_customer_id, stripe_payment_method_id, custom_offer")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const origin = requestOrigin(req.headers);
  const s = stripe();

  // Creator-sent custom offer for this fan: priced from the stored offer,
  // regardless of any earlier top-ups. Cleared once the payment lands.
  const customOffer =
    claimOffer === "custom"
      ? (chat.custom_offer as {
          tokens?: number;
          priceCents?: number;
          originalCents?: number;
        } | null)
      : null;
  if (claimOffer === "custom" && !customOffer) {
    return NextResponse.json({ error: "This offer is no longer available" }, { status: 410 });
  }

  // First-ever top-up buying the VIP pack → the creator's one-time offer.
  // The check runs server-side so the discount can't be requested twice.
  const { count: topupCount } = await db
    .from("token_transactions")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", chatId)
    .eq("kind", "topup");
  let offerApplies =
    !customOffer &&
    claimOffer !== "welcome" &&
    (topupCount ?? 0) === 0 &&
    pack.id === FIRST_TOPUP_OFFER_PACK_ID;

  // Welcome offer (post-signup popup): only valid on the fan's very first
  // top-up, priced from the creator's Welcome offer settings server-side.
  let welcomeOffer = null;
  if (!customOffer && claimOffer === "welcome") {
    if ((topupCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "This offer is no longer available" },
        { status: 410 }
      );
    }
    const { data: ownerUser } = await db.auth.admin.getUserById(chat.owner_id);
    const wo = welcomeOfferFromMetadata(ownerUser?.user?.user_metadata ?? {});
    if (!wo.enabled) {
      return NextResponse.json(
        { error: "This offer is no longer available" },
        { status: 410 }
      );
    }
    welcomeOffer = wo;
  }

  let priceCents = pack.priceCents;
  let tokens = packTotalTokens(pack);
  let originalCents = pack.priceCents;
  if (customOffer) {
    priceCents = Math.max(1, Math.round(Number(customOffer.priceCents)));
    tokens = Math.max(1, Math.round(Number(customOffer.tokens)));
    originalCents = Math.max(1, Math.round(Number(customOffer.originalCents)));
  } else if (welcomeOffer) {
    priceCents = welcomeOffer.priceCents;
    tokens = welcomeOffer.tokens;
    originalCents = welcomeOffer.originalCents;
  } else if (offerApplies) {
    const { data: ownerUser } = await db.auth.admin.getUserById(chat.owner_id);
    const offer = popupOfferFromMetadata(ownerUser?.user?.user_metadata ?? {});
    // Creator switched the offer off everywhere → the pack sells at its
    // normal price.
    if (offer.packEnabled || offer.popupEnabled) {
      priceCents = offer.priceCents;
      tokens = offer.tokens;
      originalCents = offer.originalCents;
    } else {
      offerApplies = false;
    }
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
          packId: pack.id,
        },
        description: `Top up ${formatTokens(tokens)}`,
      });
      const balance = await creditTokens({ chatId, tokens, paymentIntentId: pi.id });
      if (customOffer) {
        await db.from("chats").update({ custom_offer: null }).eq("id", chatId);
      }
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
          unit_amount: priceCents,
          product_data: {
            name: formatTokens(tokens),
            description:
              customOffer || welcomeOffer || offerApplies
                ? `One-time offer — normally $${(originalCents / 100).toFixed(2)}`
                : pack.bonusTokens > 0
                  ? `${pack.tokens} Tokens + ${pack.bonusTokens} bonus`
                  : "Token top-up",
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
        packId: pack.id,
        ...(customOffer ? { customOffer: "1" } : {}),
      },
    },
    metadata: {
      chatId,
      kind: "topup",
      tokens: String(tokens),
      packId: pack.id,
      ...(customOffer ? { customOffer: "1" } : {}),
    },
    success_url: `${origin}${returnPath}?topup=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${returnPath}`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }
  return NextResponse.json({ checkoutUrl: session.url });
}
