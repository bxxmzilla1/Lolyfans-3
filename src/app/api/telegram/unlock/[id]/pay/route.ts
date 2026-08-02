import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { ensureStripeCustomer, saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { visitorCountryCode } from "@/lib/geo";
import { getUnlock, markPaidAndDeliver } from "@/lib/telegramUnlock";
import Stripe from "stripe";

/**
 * Fan pays to unlock a Telegram-DM teaser. If we recognise them (they signed
 * up with this creator and saved a card) it's a one-tap off-session charge;
 * otherwise we hand back a client secret for the embedded card wizard.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { id } = await params;
  const unlock = await getUnlock(id);
  if (!unlock) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (unlock.status === "paid" || unlock.delivered_at) {
    return NextResponse.json({ ok: true, alreadyUnlocked: true });
  }
  // A reaction charge is being processed right now — never start a second
  // payment for the same PPV.
  if (unlock.status === "charging") {
    return NextResponse.json({ ok: true, alreadyUnlocked: true });
  }

  const s = stripe();
  const db = supabaseAdmin();

  // Do we recognise this fan? (cookie / IP / email match to a chat with this creator)
  const chats = await guestChats(req.headers);
  const chat = chats.find((c) => c.owner_id === unlock.owner_id) ?? null;

  let savedCustomer: string | null = null;
  let savedPm: string | null = null;
  if (chat) {
    const { data } = await db
      .from("chats")
      .select("stripe_customer_id, stripe_payment_method_id")
      .eq("id", chat.id)
      .maybeSingle();
    savedCustomer = (data?.stripe_customer_id as string | null) ?? null;
    savedPm = (data?.stripe_payment_method_id as string | null) ?? null;
  }

  // One-tap: charge the saved card immediately, then deliver. The atomic
  // status claim below means the reaction charger and this route can never
  // both charge the same PPV — whoever claims first wins.
  if (chat && savedCustomer && savedPm) {
    const { data: claimed } = await db
      .from("telegram_unlocks")
      .update({ status: "charging" })
      .eq("id", unlock.id)
      .in("status", ["pending", "react_failed"])
      .select("id");
    if (!claimed?.length) {
      // Someone else (a reaction) is already charging or has paid it.
      return NextResponse.json({ ok: true, alreadyUnlocked: true });
    }
    try {
      const pi = await s.paymentIntents.create({
        amount: unlock.price_cents,
        currency: "usd",
        customer: savedCustomer,
        payment_method: savedPm,
        off_session: true,
        confirm: true,
        metadata: { kind: "tg-unlock", unlockId: unlock.id, chatId: chat.id },
        description: "Telegram unlock",
      });
      if (pi.status === "succeeded") {
        await markPaidAndDeliver({ unlock, chatId: chat.id, paymentIntentId: pi.id });
        return NextResponse.json({ ok: true, paid: true });
      }
    } catch (err) {
      const recoverable =
        err instanceof Stripe.errors.StripeCardError ||
        (err instanceof Stripe.errors.StripeInvalidRequestError &&
          err.code === "authentication_required");
      if (!recoverable) {
        // fall through to the wizard anyway
      }
    }
    // Charge didn't go through — release the claim so the card wizard
    // (below) or a later attempt can take over.
    await db
      .from("telegram_unlocks")
      .update({ status: "pending" })
      .eq("id", unlock.id)
      .eq("status", "charging");
  }

  // Card wizard: a PaymentIntent the in-page Payment Element confirms. Save
  // the card for one-tap next time when we have a chat to attach it to.
  const customerId = chat
    ? await ensureStripeCustomer(chat.id)
    : (await s.customers.create({ metadata: { unlockId: unlock.id } })).id;

  const pi = await s.paymentIntents.create({
    amount: unlock.price_cents,
    currency: "usd",
    customer: customerId,
    payment_method_types: ["card"],
    setup_future_usage: "off_session",
    metadata: {
      kind: "tg-unlock",
      unlockId: unlock.id,
      ...(chat ? { chatId: chat.id } : {}),
    },
    description: "Telegram unlock",
  });

  // Remember the customer on a chat so the webhook can re-save the card later.
  if (chat) await saveStripePaymentMethod(chat.id, customerId, null);

  return NextResponse.json({
    clientSecret: pi.client_secret,
    amountCents: unlock.price_cents,
    country: await visitorCountryCode(req.headers),
  });
}
