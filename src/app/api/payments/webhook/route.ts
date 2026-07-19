import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fulfillUnlockCheckout, recordUnlock } from "@/lib/payments";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

export const runtime = "nodejs";

/**
 * Stripe webhook. Must be pointed at the *canonical* host that does not 308
 * redirect (e.g. https://www.lolyfans.com/... if apex redirects to www).
 * Stripe does not follow redirects — a 308 means the unlock never runs.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    await fulfillUnlockCheckout(event.data.object as Stripe.Checkout.Session);
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.kind !== "unlock") return NextResponse.json({ ok: true });
    const chatId = pi.metadata.chatId;
    const messageId = pi.metadata.messageId;
    if (!chatId || !messageId) return NextResponse.json({ ok: true });

    const paymentMethodId =
      typeof pi.payment_method === "string"
        ? pi.payment_method
        : pi.payment_method?.id ?? null;
    if (paymentMethodId && typeof pi.customer === "string") {
      await supabaseAdmin()
        .from("chats")
        .update({
          stripe_customer_id: pi.customer,
          stripe_payment_method_id: paymentMethodId,
        })
        .eq("id", chatId);
    }

    await recordUnlock({
      messageId,
      chatId,
      priceCents: pi.amount ?? 0,
    });
  }

  return NextResponse.json({ received: true });
}
