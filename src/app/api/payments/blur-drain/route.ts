import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import {
  autoRefillTokens,
  ensureStripeCustomer,
  maybeAutoRefillLowBalance,
  recordBlurDrainTap,
  saveStripePaymentMethod,
  spendTokens,
  tokenBalance,
} from "@/lib/payments";
import { parseBlurDrainer } from "@/lib/blurDrainer";
import { tokensForCents } from "@/lib/tokens";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { visitorCountryCode } from "@/lib/geo";

/** GET: current progress for this fan + message. */
export async function GET(req: NextRequest) {
  const messageId = req.nextUrl.searchParams.get("messageId");
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, blur_drainer")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = parseBlurDrainer(message.blur_drainer);
  if (!cfg) return NextResponse.json({ error: "Not a BlurDrainer message" }, { status: 400 });

  const { data: prog } = await db
    .from("message_blur_progress")
    .select("layers_cleared")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();

  return NextResponse.json({
    config: cfg,
    layersCleared: prog?.layers_cleared ?? 0,
  });
}

/**
 * POST: unblur one BlurDrainer layer. Paid drains spend Tokens from the
 * fan's wallet (instant, no card round-trip); an empty wallet returns 402 so
 * the client opens the top-up sheet. Free drains cost nothing but require a
 * verified card (SetupIntent) first.
 */
export async function POST(req: NextRequest) {
  const { messageId, embedded, setupIntentId } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, blur_drainer")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = parseBlurDrainer(message.blur_drainer);
  if (!cfg) return NextResponse.json({ error: "Not a BlurDrainer message" }, { status: 400 });

  const { data: prog } = await db
    .from("message_blur_progress")
    .select("layers_cleared")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();
  const cleared = prog?.layers_cleared ?? 0;

  if (cleared >= cfg.layers) {
    return NextResponse.json({ ok: true, layersCleared: cleared, done: true });
  }

  // Free BlurDrainer: completing the card-verification SetupIntent unlocks
  // the tapped layer without any charge.
  if (typeof setupIntentId === "string" && setupIntentId) {
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
    }
    const si = await stripe().setupIntents.retrieve(setupIntentId);
    if (si.status !== "succeeded") {
      return NextResponse.json({ error: "Verification not complete" }, { status: 400 });
    }
    if (si.metadata?.kind !== "blur-drain-verify" || si.metadata.messageId !== messageId) {
      return NextResponse.json({ error: "Invalid verification" }, { status: 400 });
    }
    const customerId =
      typeof si.customer === "string" ? si.customer : si.customer?.id ?? null;
    const pmId =
      typeof si.payment_method === "string"
        ? si.payment_method
        : si.payment_method?.id ?? null;
    await saveStripePaymentMethod(message.chat_id, customerId, pmId);
    const layersCleared = await recordBlurDrainTap({
      messageId,
      chatId: message.chat_id,
      layers: cfg.layers,
      paymentIntentId: `free_${si.id}`,
    });
    return NextResponse.json({
      ok: true,
      layersCleared,
      done: layersCleared >= cfg.layers,
    });
  }

  // Free BlurDrainer: no charge per tap, but the fan needs a verified card.
  if (cfg.priceCents <= 0) {
    const { data: chat } = await db
      .from("chats")
      .select("stripe_customer_id, stripe_payment_method_id")
      .eq("id", message.chat_id)
      .maybeSingle();
    if (chat?.stripe_customer_id && chat?.stripe_payment_method_id) {
      const layersCleared = await recordBlurDrainTap({
        messageId: message.id,
        chatId: message.chat_id,
        layers: cfg.layers,
        paymentIntentId: `free_${message.id}_${cleared + 1}`,
      });
      return NextResponse.json({
        ok: true,
        layersCleared,
        done: layersCleared >= cfg.layers,
      });
    }
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
    }
    if (embedded === true) {
      const customerId = await ensureStripeCustomer(message.chat_id);
      const si = await stripe().setupIntents.create({
        customer: customerId,
        payment_method_types: ["card"],
        usage: "off_session",
        metadata: {
          chatId: message.chat_id,
          kind: "blur-drain-verify",
          messageId: message.id,
        },
      });
      return NextResponse.json({
        setupClientSecret: si.client_secret,
        country: await visitorCountryCode(req.headers),
        needsCard: true,
      });
    }
    return NextResponse.json(
      { error: "Verify your card to continue unblurring" },
      { status: 402 }
    );
  }

  // Paid drain: one tap = one instant token spend from the wallet.
  const tokens = tokensForCents(cfg.priceCents);
  let balance = await spendTokens({
    chatId: message.chat_id,
    tokens,
    kind: "unlock",
    messageId: message.id,
  });
  // Auto refill (default on): saved card silently rebuys the last pack.
  if (balance === null) {
    const current = await tokenBalance(message.chat_id);
    const refilled = await autoRefillTokens(message.chat_id, tokens - current);
    if (refilled !== null) {
      balance = await spendTokens({
        chatId: message.chat_id,
        tokens,
        kind: "unlock",
        messageId: message.id,
      });
    }
  }
  if (balance === null) {
    return NextResponse.json(
      {
        error: "Not enough Tokens",
        needTokens: tokens,
        balance: await tokenBalance(message.chat_id),
      },
      { status: 402 }
    );
  }
  const layersCleared = await recordBlurDrainTap({
    messageId: message.id,
    chatId: message.chat_id,
    layers: cfg.layers,
    paymentIntentId: `tokens_${message.id}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  });

  // Wallet running low (≤10 Tokens)? Refill in the background.
  const newBalance = balance;
  after(() => maybeAutoRefillLowBalance(message.chat_id, newBalance));

  return NextResponse.json({
    ok: true,
    layersCleared,
    balance,
    done: layersCleared >= cfg.layers,
  });
}
