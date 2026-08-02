import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import {
  chargeChatDollars,
  ensureStripeCustomer,
  recordBlurDrainTap,
  saveStripePaymentMethod,
} from "@/lib/payments";
import { parseBlurDrainer } from "@/lib/blurDrainer";
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
 * POST: unblur one BlurDrainer layer. Paid drains charge dollars via Stripe
 * (one-tap with a saved card, or a client secret for the card wizard). Free
 * drains cost nothing but require a verified card (SetupIntent) first.
 */
export async function POST(req: NextRequest) {
  const { messageId, embedded, setupIntentId, paymentIntentId } = await req.json();
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

  // Finish an embedded card payment the client already confirmed.
  if (typeof paymentIntentId === "string" && paymentIntentId) {
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
    }
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
    if (
      pi.status !== "succeeded" ||
      pi.metadata?.kind !== "blur-drain" ||
      pi.metadata?.messageId !== messageId
    ) {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }
    const pmId =
      typeof pi.payment_method === "string"
        ? pi.payment_method
        : pi.payment_method?.id ?? null;
    const custId = typeof pi.customer === "string" ? pi.customer : null;
    await saveStripePaymentMethod(message.chat_id, custId, pmId);
    const layersCleared = await recordBlurDrainTap({
      messageId: message.id,
      chatId: message.chat_id,
      layers: cfg.layers,
      paymentIntentId: pi.id,
    });
    return NextResponse.json({
      ok: true,
      layersCleared,
      done: layersCleared >= cfg.layers,
    });
  }

  // Paid drain: charge dollars per tap (no token wallet).
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }
  const result = await chargeChatDollars({
    chatId: message.chat_id,
    amountCents: cfg.priceCents,
    kind: "blur-drain",
    description: "Blur drain tap",
    metadata: { messageId: message.id },
  });

  if ("paid" in result && result.paid) {
    const layersCleared = await recordBlurDrainTap({
      messageId: message.id,
      chatId: message.chat_id,
      layers: cfg.layers,
      paymentIntentId: result.paymentIntentId,
    });
    return NextResponse.json({
      ok: true,
      layersCleared,
      done: layersCleared >= cfg.layers,
    });
  }

  if (!("clientSecret" in result)) {
    return NextResponse.json({ error: "Could not start payment" }, { status: 500 });
  }

  return NextResponse.json({
    clientSecret: result.clientSecret,
    amountCents: cfg.priceCents,
    country: await visitorCountryCode(req.headers),
    needsCard: true,
  });
}
