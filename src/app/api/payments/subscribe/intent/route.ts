import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { ensureStripeCustomer } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { subPlanFromMetadata, SUB_INTERVAL_LABEL } from "@/lib/subscriptionPlan";
import type Stripe from "stripe";

const ACTIVE_STATUSES = ["trialing", "active", "past_due", "canceling"];

/**
 * In-page subscribe (Stripe Elements): creates the PaymentIntent (lifetime),
 * or the subscription in default_incomplete mode (recurring), and returns the
 * client secret the Payment Element confirms on the client — no redirect to
 * a Stripe-hosted page.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { ownerId } = await req.json();
  if (!ownerId || typeof ownerId !== "string") {
    return NextResponse.json({ error: "ownerId required" }, { status: 400 });
  }

  const chats = await guestChats(req.headers);
  const chat = chats.find((c) => c.owner_id === ownerId);
  if (!chat) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const s = stripe();

  const { data: existing } = await db
    .from("subscriptions")
    .select("status")
    .eq("chat_id", chat.id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (existing && ACTIVE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ alreadySubscribed: true });
  }

  const { data: ownerUser } = await db.auth.admin.getUserById(ownerId);
  if (!ownerUser?.user) {
    return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  }
  const meta = (ownerUser.user.user_metadata ?? {}) as Record<string, unknown>;
  const plan = subPlanFromMetadata(meta);
  if (plan.priceCents <= 0) return NextResponse.json({ free: true });

  const customerId = await ensureStripeCustomer(chat.id);
  const ownerName = (meta.display_name as string) || "Creator";

  // Lifetime: a single one-time charge whose card is saved for one-tap pays.
  if (plan.interval === "lifetime") {
    const pi = await s.paymentIntents.create({
      amount: plan.priceCents,
      currency: "usd",
      customer: customerId,
      setup_future_usage: "off_session",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: `${ownerName} — lifetime subscription`,
      metadata: {
        chatId: chat.id,
        ownerId,
        kind: "subscription",
        interval: "lifetime",
      },
    });
    return NextResponse.json({
      mode: "payment",
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
    });
  }

  // Recurring: prices are created ad hoc against one reusable product per
  // creator (cached in their auth metadata so the dashboard stays tidy).
  let productId = (meta.stripe_product_id as string) || "";
  if (!productId) {
    const product = await s.products.create({
      name: `${ownerName} — profile subscription`,
      metadata: { ownerId },
    });
    productId = product.id;
    await db.auth.admin.updateUserById(ownerId, {
      user_metadata: { ...meta, stripe_product_id: productId },
    });
  }

  let couponId: string | undefined;
  if (plan.discountPct > 0) {
    const coupon = await s.coupons.create({
      percent_off: plan.discountPct,
      duration: "once",
      name: `${plan.discountPct}% off first ${plan.interval}`,
    });
    couponId = coupon.id;
  }

  const sub = await s.subscriptions.create({
    customer: customerId,
    items: [
      {
        price_data: {
          currency: "usd",
          product: productId,
          unit_amount: plan.priceCents,
          recurring: { interval: plan.interval },
        },
      },
    ],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
    ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
    metadata: { chatId: chat.id, ownerId, kind: "subscription" },
    expand: ["latest_invoice.confirmation_secret", "pending_setup_intent"],
    description: `${ownerName} — ${SUB_INTERVAL_LABEL[plan.interval]} subscription`,
  });

  // Trial → nothing due today; the card is collected via a SetupIntent.
  const setupIntent = sub.pending_setup_intent as Stripe.SetupIntent | null;
  if (setupIntent?.client_secret) {
    return NextResponse.json({
      mode: "setup",
      clientSecret: setupIntent.client_secret,
      subscriptionId: sub.id,
    });
  }

  const invoice = sub.latest_invoice as
    | (Stripe.Invoice & { confirmation_secret?: { client_secret?: string } })
    | null;
  const clientSecret = invoice?.confirmation_secret?.client_secret;
  if (!clientSecret) {
    return NextResponse.json({ error: "Could not start payment" }, { status: 502 });
  }
  return NextResponse.json({
    mode: "payment",
    clientSecret,
    subscriptionId: sub.id,
  });
}
