import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordUnlock } from "@/lib/payments";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * Stripe webhook: after Checkout completes, save the card for one-tap unlocks
 * and mark the media as unlocked for that fan.
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
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind !== "unlock") {
      return NextResponse.json({ ok: true });
    }
    const chatId = session.metadata.chatId;
    const messageId = session.metadata.messageId;
    if (!chatId || !messageId) return NextResponse.json({ ok: true });

    const db = supabaseAdmin();
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;

    let paymentMethodId: string | null = null;
    if (paymentIntentId) {
      const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
      paymentMethodId =
        typeof pi.payment_method === "string"
          ? pi.payment_method
          : pi.payment_method?.id ?? null;
    }

    const patch: Record<string, string> = {};
    if (customerId) patch.stripe_customer_id = customerId;
    if (paymentMethodId) patch.stripe_payment_method_id = paymentMethodId;
    if (Object.keys(patch).length) {
      await db.from("chats").update(patch).eq("id", chatId);
    }

    const { data: message } = await db
      .from("messages")
      .select("price_cents")
      .eq("id", messageId)
      .maybeSingle();

    await recordUnlock({
      messageId,
      chatId,
      priceCents: message?.price_cents ?? session.amount_total ?? 0,
    });
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

  return NextResponse.json({ ok: true });
}
