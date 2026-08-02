import { NextRequest, NextResponse } from "next/server";
import { saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { getUnlock, markPaidAndDeliver } from "@/lib/telegramUnlock";
import { saveTgFanPaymentMethod } from "@/lib/telegramLogin";

/**
 * Called after the card wizard confirms the unlock PaymentIntent: verifies it
 * with Stripe, saves the card (against the Telegram identity and/or chat),
 * marks the unlock paid and delivers the media into the fan's Telegram DM.
 * Idempotent.
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

  const chatId = pi.metadata?.chatId ?? unlock.paid_chat_id ?? null;
  const tgUserId = Number(pi.metadata?.tgUserId) || null;
  const paymentMethodId =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id ?? null;
  const customerId = typeof pi.customer === "string" ? pi.customer : null;

  if (chatId) await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
  // Logged in with the Telegram widget → their next unlock is one tap,
  // on any device, without a Lolyfans account.
  if (tgUserId) await saveTgFanPaymentMethod(tgUserId, customerId, paymentMethodId);

  await markPaidAndDeliver({ unlock, chatId, tgUserId, paymentIntentId: pi.id });
  return NextResponse.json({ ok: true, paid: true });
}
