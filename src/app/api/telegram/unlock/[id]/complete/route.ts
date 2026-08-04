import { NextRequest, NextResponse } from "next/server";
import { visitorCountryCode } from "@/lib/geo";
import { ipFromHeaders } from "@/lib/invites";
import { saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import {
  fanChatForCard,
  getUnlock,
  markPaidAndDeliver,
} from "@/lib/telegramUnlock";

// Delivering a paid video into Telegram can take minutes.
export const maxDuration = 300;

/**
 * Called after the card wizard confirms the unlock PaymentIntent: verifies it
 * with Stripe, saves the card (when tied to a chat), marks the unlock paid and
 * delivers the media into the fan's Telegram DM. Idempotent.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { id } = await params;
  const { paymentIntentId } = await req.json().catch(() => ({}));
  if (!paymentIntentId || typeof paymentIntentId !== "string") {
    return NextResponse.json({ error: "paymentIntentId required" }, { status: 400 });
  }

  const unlock = await getUnlock(id);
  if (!unlock) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (unlock.delivered_at) return NextResponse.json({ ok: true, alreadyUnlocked: true });

  const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
  if (
    pi.metadata?.kind !== "tg-unlock" ||
    pi.metadata?.unlockId !== unlock.id ||
    pi.status !== "succeeded"
  ) {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  const paymentMethodId =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id ?? null;
  const customerId = typeof pi.customer === "string" ? pi.customer : null;

  // Save the card so this fan can double-tap future PPVs. Fans paying on
  // the dedicated pay domain aren't recognised as Lolyfans guests (no
  // cookie there), so when no chat was matched at pay time, give the card
  // a home: a hidden chat tied to this Telegram peer.
  let chatId: string | null = pi.metadata?.chatId ?? unlock.paid_chat_id ?? null;
  if (!chatId && customerId && paymentMethodId) {
    chatId = await fanChatForCard({
      unlock,
      ip: ipFromHeaders(req.headers),
      country: await visitorCountryCode(req.headers),
    });
  }
  if (chatId) {
    await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
  }

  await markPaidAndDeliver({ unlock, chatId, paymentIntentId: pi.id });
  return NextResponse.json({ ok: true, paid: true });
}
