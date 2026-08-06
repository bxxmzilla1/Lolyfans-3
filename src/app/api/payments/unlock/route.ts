import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import {
  chargeChatDollars,
  recordUnlock,
  saveStripePaymentMethod,
} from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { visitorCountryCode } from "@/lib/geo";
import { ensureCpmMetering } from "@/lib/cpm";

/**
 * Unlock locked media for dollars via Stripe. One-tap with a saved card, or
 * return a client secret for the embedded card wizard. No token wallet.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const messageId = body.messageId as string | undefined;
  const paymentIntentId = body.paymentIntentId as string | undefined;
  if (!messageId) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

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

  const { data: existing } = await db
    .from("message_unlocks")
    .select("message_id")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();
  if (existing) {
    after(() => ensureCpmMetering(message.chat_id as string));
    return NextResponse.json({ ok: true, unlocked: true });
  }

  // Finish an embedded card payment the client already confirmed.
  if (paymentIntentId) {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
    if (
      pi.status !== "succeeded" ||
      pi.metadata?.kind !== "unlock" ||
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
    await recordUnlock({
      messageId: message.id,
      chatId: message.chat_id,
      priceCents: price,
    });
    after(() => ensureCpmMetering(message.chat_id as string));
    return NextResponse.json({ ok: true, unlocked: true });
  }

  const result = await chargeChatDollars({
    chatId: message.chat_id,
    amountCents: price,
    kind: "unlock",
    description: "Media unlock",
    metadata: { messageId: message.id },
  });

  if ("paid" in result && result.paid) {
    await recordUnlock({
      messageId: message.id,
      chatId: message.chat_id,
      priceCents: price,
    });
    after(() => ensureCpmMetering(message.chat_id as string));
    return NextResponse.json({ ok: true, unlocked: true });
  }

  if (!("clientSecret" in result)) {
    return NextResponse.json({ error: "Could not start payment" }, { status: 500 });
  }

  return NextResponse.json({
    clientSecret: result.clientSecret,
    amountCents: price,
    country: await visitorCountryCode(req.headers),
  });
}
