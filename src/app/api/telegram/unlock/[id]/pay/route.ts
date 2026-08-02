import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { ensureStripeCustomer, saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { visitorCountryCode } from "@/lib/geo";
import { getUnlock, markPaidAndDeliver } from "@/lib/telegramUnlock";
import {
  ensureTgFanStripeCustomer,
  getTelegramFan,
  telegramFanRow,
} from "@/lib/telegramLogin";
import Stripe from "stripe";

/**
 * Fan pays to unlock a Telegram-DM teaser. We recognise them two ways:
 *  - Telegram Login Widget cookie (verified Telegram identity) with a card
 *    saved from a previous unlock, or
 *  - a Lolyfans guest session (cookie / IP / email) with a saved card.
 * Either gives a one-tap off-session charge; otherwise we hand back a client
 * secret for the embedded card wizard.
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

  const s = stripe();
  const db = supabaseAdmin();

  // Logged in with the Telegram widget? (their own verified identity)
  const tgFan = await getTelegramFan();
  const tgRow = tgFan ? await telegramFanRow(tgFan.id) : null;

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

  // One-tap: charge a saved card immediately, then deliver. The card saved
  // against their Telegram identity wins; a Lolyfans chat card is the backup.
  const oneTapSources: Array<{
    customer: string;
    pm: string;
    chatId: string | null;
    tgUserId: number | null;
  }> = [];
  if (tgRow?.stripe_customer_id && tgRow.stripe_payment_method_id) {
    oneTapSources.push({
      customer: tgRow.stripe_customer_id,
      pm: tgRow.stripe_payment_method_id,
      chatId: chat?.id ?? null,
      tgUserId: tgRow.tg_user_id,
    });
  }
  if (chat && savedCustomer && savedPm) {
    oneTapSources.push({
      customer: savedCustomer,
      pm: savedPm,
      chatId: chat.id,
      tgUserId: tgFan?.id ?? null,
    });
  }

  for (const source of oneTapSources) {
    try {
      const pi = await s.paymentIntents.create({
        amount: unlock.price_cents,
        currency: "usd",
        customer: source.customer,
        payment_method: source.pm,
        off_session: true,
        confirm: true,
        metadata: {
          kind: "tg-unlock",
          unlockId: unlock.id,
          ...(source.chatId ? { chatId: source.chatId } : {}),
          ...(source.tgUserId ? { tgUserId: String(source.tgUserId) } : {}),
        },
        description: "Telegram unlock",
      });
      if (pi.status === "succeeded") {
        await markPaidAndDeliver({
          unlock,
          chatId: source.chatId,
          tgUserId: source.tgUserId,
          paymentIntentId: pi.id,
        });
        return NextResponse.json({ ok: true, paid: true });
      }
    } catch (err) {
      const recoverable =
        err instanceof Stripe.errors.StripeCardError ||
        (err instanceof Stripe.errors.StripeInvalidRequestError &&
          err.code === "authentication_required");
      if (!recoverable) {
        // fall through to the next source / the wizard anyway
      }
    }
  }

  // Card wizard: a PaymentIntent the in-page Payment Element confirms. The
  // card is saved for one-tap next time — against their Telegram identity
  // when they're logged in with the widget, or their Lolyfans chat.
  const customerId = chat
    ? await ensureStripeCustomer(chat.id)
    : tgFan
      ? await ensureTgFanStripeCustomer(tgFan.id)
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
      ...(tgFan ? { tgUserId: String(tgFan.id) } : {}),
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
