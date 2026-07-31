import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { ensureStripeCustomer } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { visitorCountryCode } from "@/lib/geo";
import { paidSubFromMetadata } from "@/lib/paidSub";

/**
 * PaidSub "Pay Now": a PaymentIntent for the one-time unlimited-messaging
 * price, confirmed in the embedded card wizard inside the blocking popup.
 * The card is saved for one-tap purchases afterwards.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { chatId } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("owner_id, paidsub_offer_at, paidsub_paid_at")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  if (chat.paidsub_paid_at) {
    return NextResponse.json({ ok: true, paid: true });
  }
  if (!chat.paidsub_offer_at) {
    return NextResponse.json({ error: "No active offer" }, { status: 400 });
  }

  const { data: ownerUser } = await db.auth.admin.getUserById(chat.owner_id);
  const cfg = paidSubFromMetadata(ownerUser?.user?.user_metadata ?? {});

  const customerId = await ensureStripeCustomer(chatId);
  const pi = await stripe().paymentIntents.create({
    amount: cfg.priceCents,
    currency: "usd",
    customer: customerId,
    payment_method_types: ["card"],
    setup_future_usage: "off_session",
    metadata: { chatId, kind: "paidsub" },
    description: "Unlimited messaging",
  });

  return NextResponse.json({
    clientSecret: pi.client_secret,
    amountCents: cfg.priceCents,
    country: await visitorCountryCode(req.headers),
  });
}
