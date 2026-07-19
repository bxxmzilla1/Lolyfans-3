import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { requestOrigin } from "@/lib/smsNotify";
import {
  subPlanFromMetadata,
  SUB_INTERVAL_LABEL,
} from "@/lib/subscriptionPlan";

const ACTIVE_STATUSES = ["trialing", "active", "past_due", "canceling"];

/**
 * Fan profile subscription. POST { ownerId } starts a Stripe subscription
 * Checkout using the plan the creator configured in Settings → Subscriptions;
 * POST { ownerId, action: "cancel" } stops it at the period end.
 * The subscription's card is saved for one-tap unlocks and tips.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { ownerId, action } = await req.json();
  if (!ownerId || typeof ownerId !== "string") {
    return NextResponse.json({ error: "ownerId required" }, { status: 400 });
  }

  const chats = await guestChats(req.headers);
  const chat = chats.find((c) => c.owner_id === ownerId);
  if (!chat) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const s = stripe();

  const { data: existing } = await db
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("chat_id", chat.id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (action === "cancel") {
    if (!existing?.stripe_subscription_id || !ACTIVE_STATUSES.includes(existing.status)) {
      return NextResponse.json({ error: "No active subscription" }, { status: 404 });
    }
    await s.subscriptions.update(existing.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    await db
      .from("subscriptions")
      .update({ status: "canceling" })
      .eq("chat_id", chat.id)
      .eq("owner_id", ownerId);
    return NextResponse.json({ ok: true, canceled: true });
  }

  const { data: ownerUser } = await db.auth.admin.getUserById(ownerId);
  if (!ownerUser?.user) {
    return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  }
  const meta = (ownerUser.user.user_metadata ?? {}) as Record<string, unknown>;
  const plan = subPlanFromMetadata(meta);

  // Free profile → plain follow, no payment.
  if (plan.priceCents <= 0) {
    return NextResponse.json({ free: true });
  }

  if (existing && ACTIVE_STATUSES.includes(existing.status)) {
    // Un-cancel instead of double-subscribing when they resubscribe mid-period.
    if (existing.status === "canceling" && existing.stripe_subscription_id) {
      await s.subscriptions.update(existing.stripe_subscription_id, {
        cancel_at_period_end: false,
      });
      await db
        .from("subscriptions")
        .update({ status: "active" })
        .eq("chat_id", chat.id)
        .eq("owner_id", ownerId);
    }
    return NextResponse.json({ ok: true, alreadySubscribed: true });
  }

  let customerId = (
    await db.from("chats").select("stripe_customer_id").eq("id", chat.id).maybeSingle()
  ).data?.stripe_customer_id as string | null | undefined;
  if (!customerId) {
    const customer = await s.customers.create({ metadata: { chatId: chat.id } });
    customerId = customer.id;
    await db.from("chats").update({ stripe_customer_id: customerId }).eq("id", chat.id);
  }

  const ownerName = (meta.display_name as string) || "Creator";
  const origin = requestOrigin(req.headers);

  // First-period percentage discount rides along as a one-time coupon.
  let couponId: string | undefined;
  if (plan.discountPct > 0) {
    const coupon = await s.coupons.create({
      percent_off: plan.discountPct,
      duration: "once",
      name: `${plan.discountPct}% off first ${plan.interval}`,
    });
    couponId = coupon.id;
  }

  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: chat.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: plan.priceCents,
          recurring: { interval: plan.interval },
          product_data: {
            name: `${ownerName} — ${SUB_INTERVAL_LABEL[plan.interval]} subscription`,
          },
        },
      },
    ],
    subscription_data: {
      ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
      metadata: { chatId: chat.id, ownerId, kind: "subscription" },
    },
    ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
    metadata: { chatId: chat.id, ownerId, kind: "subscription" },
    success_url: `${origin}/p/${ownerId}?subscribed=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/p/${ownerId}`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }
  return NextResponse.json({ checkoutUrl: session.url });
}
