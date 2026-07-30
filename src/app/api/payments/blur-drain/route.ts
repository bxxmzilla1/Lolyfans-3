import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import {
  ensureStripeCustomer,
  recordBlurDrainTap,
  saveStripePaymentMethod,
} from "@/lib/payments";
import { parseBlurDrainer } from "@/lib/blurDrainer";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { visitorCountryCode } from "@/lib/geo";
import Stripe from "stripe";

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
 * POST: charge one BlurDrainer tap (one layer). One-tap with a saved card;
 * otherwise returns an embedded PaymentIntent client secret.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { messageId, embedded, paymentIntentId } = await req.json();
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

  // Completing an embedded PaymentIntent after the wizard succeeds.
  if (typeof paymentIntentId === "string" && paymentIntentId) {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== "succeeded") {
      return NextResponse.json({ error: "Payment not complete" }, { status: 400 });
    }
    if (pi.metadata?.kind !== "blur-drain" || pi.metadata.messageId !== messageId) {
      return NextResponse.json({ error: "Invalid payment" }, { status: 400 });
    }
    const customerId =
      typeof pi.customer === "string" ? pi.customer : pi.customer?.id ?? null;
    const pmId =
      typeof pi.payment_method === "string"
        ? pi.payment_method
        : pi.payment_method?.id ?? null;
    await saveStripePaymentMethod(message.chat_id, customerId, pmId);
    const layersCleared = await recordBlurDrainTap({
      messageId,
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

  const { data: chat } = await db
    .from("chats")
    .select("stripe_customer_id, stripe_payment_method_id")
    .eq("id", message.chat_id)
    .maybeSingle();

  const s = stripe();
  const metadata = {
    chatId: message.chat_id,
    kind: "blur-drain",
    messageId: message.id,
  };
  const price = cfg.priceCents;

  if (chat?.stripe_customer_id && chat?.stripe_payment_method_id) {
    try {
      const pi = await s.paymentIntents.create({
        amount: price,
        currency: "usd",
        customer: chat.stripe_customer_id,
        payment_method: chat.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata,
        description: "BlurDrainer tap",
      });
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
    } catch (err) {
      void err;
      // Card declined / needs auth — fall through to embedded card entry.
    }
  }

  const hadCard = !!(chat?.stripe_customer_id && chat?.stripe_payment_method_id);
  const customerId = await ensureStripeCustomer(message.chat_id);
  if (embedded === true) {
    const pi = await s.paymentIntents.create({
      amount: price,
      currency: "usd",
      customer: customerId,
      payment_method_types: ["card"],
      setup_future_usage: "off_session",
      metadata,
      description: "BlurDrainer tap",
    });
    return NextResponse.json({
      clientSecret: pi.client_secret,
      amountCents: price,
      country: await visitorCountryCode(req.headers),
      // True when the fan has never saved a card — player shows a softer prompt.
      needsCard: !hadCard,
    });
  }

  return NextResponse.json(
    { error: "Add a card to continue unblurring" },
    { status: 402 }
  );
}
