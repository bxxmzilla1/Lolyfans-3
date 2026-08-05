import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions, getGuestChatId } from "@/lib/session";
import { visitorCountryCode } from "@/lib/geo";
import { ipFromHeaders } from "@/lib/invites";
import { ensureStripeCustomer, saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import {
  CPM_PRICE_CENTS_PER_MIN,
  ownerIdForCpmCode,
  startCpmSession,
} from "@/lib/cpm";
import { broadcast } from "@/lib/realtime";

/**
 * Fan starts Chat-per-minute:
 *  - Already has a CPM chat + saved card for this creator → open chat and
 *    (re)start metering on their next message / immediately if they ask.
 *  - Otherwise → return a PaymentIntent client secret for the card wizard
 *    ($1 first minute). /complete creates the chat after payment.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { code } = await params;
  const ownerId = await ownerIdForCpmCode(code.trim());
  if (!ownerId) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const guestName = String(body.name || "").trim().slice(0, 40) || "Fan";

  const db = supabaseAdmin();
  const existingChatId = await getGuestChatId();
  if (existingChatId) {
    const { data: chat } = await db
      .from("chats")
      .select("id, owner_id, cpm, stripe_customer_id, stripe_payment_method_id")
      .eq("id", existingChatId)
      .maybeSingle();
    if (
      chat &&
      chat.owner_id === ownerId &&
      chat.cpm &&
      chat.stripe_customer_id &&
      chat.stripe_payment_method_id
    ) {
      // Returning fan — send them straight into chat. Metering restarts when
      // they send a message (see /api/messages).
      return NextResponse.json({ ok: true, chatId: chat.id, resume: true });
    }
  }

  // New fan (or no saved card): PaymentIntent for the first minute.
  // We create a pending chat up front so the PI metadata has a chatId to
  // attach the card to — revealed (pending=false) on successful payment.
  const ip = ipFromHeaders(req.headers);
  const country = await visitorCountryCode(req.headers);
  const { data: chat, error } = await db
    .from("chats")
    .insert({
      owner_id: ownerId,
      guest_name: guestName,
      guest_ip: ip,
      guest_country: country,
      cpm: true,
      pending: true,
    })
    .select("id")
    .single();
  if (error || !chat) {
    return NextResponse.json(
      { error: "Could not start (run the Chat per minute DB migration?)" },
      { status: 500 }
    );
  }

  const customerId = await ensureStripeCustomer(chat.id);
  const pi = await stripe().paymentIntents.create({
    amount: CPM_PRICE_CENTS_PER_MIN,
    currency: "usd",
    customer: customerId,
    payment_method_types: ["card"],
    setup_future_usage: "off_session",
    metadata: {
      kind: "cpm-start",
      chatId: chat.id,
      ownerId,
      code: code.trim(),
    },
    description: "Chat per minute — first minute",
  });
  await saveStripePaymentMethod(chat.id, customerId, null);

  return NextResponse.json({
    clientSecret: pi.client_secret,
    amountCents: CPM_PRICE_CENTS_PER_MIN,
    country,
    chatId: chat.id,
  });
}

/**
 * After the card wizard succeeds: save the card, reveal the chat, charge the
 * first minute via a new CPM session, set the guest cookie, open /chat.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { code } = await params;
  const ownerId = await ownerIdForCpmCode(code.trim());
  if (!ownerId) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const paymentIntentId = String(body.paymentIntentId || "").trim();
  const chatId = String(body.chatId || "").trim();
  if (!paymentIntentId || !chatId) {
    return NextResponse.json(
      { error: "paymentIntentId and chatId required" },
      { status: 400 }
    );
  }

  const pi = await stripe().paymentIntents.retrieve(paymentIntentId, {
    expand: ["payment_method"],
  });
  if (
    pi.metadata?.kind !== "cpm-start" ||
    pi.metadata?.chatId !== chatId ||
    pi.status !== "succeeded"
  ) {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id, pending")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat || chat.owner_id !== ownerId) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const paymentMethodId =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id ?? null;
  const customerId = typeof pi.customer === "string" ? pi.customer : null;
  await saveStripePaymentMethod(chatId, customerId, paymentMethodId);

  // Reveal + mark first minute as already paid (the PI we just confirmed).
  // The cardholder name from the card form becomes the fan's display name.
  const cardholderName =
    typeof pi.payment_method === "object" && pi.payment_method
      ? (pi.payment_method.billing_details?.name || "").trim().slice(0, 40)
      : "";
  await db
    .from("chats")
    .update({
      pending: false,
      ...(cardholderName ? { guest_name: cardholderName } : {}),
    })
    .eq("id", chatId);

  // Session with minutes_charged=1 already (PI paid for minute 1) — insert
  // directly so we don't double-charge via startCpmSession.
  const { data: session } = await db
    .from("cpm_sessions")
    .insert({
      chat_id: chatId,
      owner_id: ownerId,
      minutes_charged: 1,
    })
    .select("id")
    .single();
  if (!session) {
    // Fallback: try the helper (would charge again — only if insert failed).
    await startCpmSession({ chatId, ownerId });
  }

  await broadcast(`inbox:${ownerId}`, "new-chat", { chatId });

  const token = createToken({ chatId });
  const res = NextResponse.json({ ok: true, chatId });
  res.cookies.set(GUEST_COOKIE, token, cookieOptions);
  return res;
}
