import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { ensureStripeCustomer, saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";

/**
 * Card-on-file for FREE signups: a plain SetupIntent (nothing is charged)
 * that saves the fan's card so one-tap top-ups work from day one.
 *
 * POST { ownerId }                 → { clientSecret } (or { saved: true })
 * POST { ownerId, setupIntentId }  → verifies + stores the card → { ok: true }
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { ownerId, setupIntentId } = await req.json();
  if (!ownerId || typeof ownerId !== "string") {
    return NextResponse.json({ error: "ownerId required" }, { status: 400 });
  }

  const chats = await guestChats(req.headers);
  const chat = chats.find((c) => c.owner_id === ownerId);
  if (!chat) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const s = stripe();

  // Step 2: the Payment Element confirmed the SetupIntent — persist the card.
  if (setupIntentId && typeof setupIntentId === "string") {
    const si = await s.setupIntents.retrieve(setupIntentId);
    if (si.metadata?.chatId !== chat.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (si.status !== "succeeded" || !si.payment_method) {
      return NextResponse.json({ error: "Card was not saved" }, { status: 400 });
    }
    await saveStripePaymentMethod(
      chat.id,
      typeof si.customer === "string" ? si.customer : si.customer?.id,
      typeof si.payment_method === "string" ? si.payment_method : si.payment_method.id
    );
    return NextResponse.json({ ok: true });
  }

  // Returning fan who already has a card on file — nothing to collect.
  const { data: cardRow } = await supabaseAdmin()
    .from("chats")
    .select("stripe_customer_id, stripe_payment_method_id")
    .eq("id", chat.id)
    .maybeSingle();
  if (cardRow?.stripe_customer_id && cardRow?.stripe_payment_method_id) {
    return NextResponse.json({ saved: true });
  }

  const customerId = await ensureStripeCustomer(chat.id);
  // Card only — no Link, wallets or redirects, so the fan types plain card
  // details once and never sees a Link login.
  const si = await s.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: { chatId: chat.id, ownerId, kind: "signup-card" },
  });
  return NextResponse.json({ clientSecret: si.client_secret });
}
