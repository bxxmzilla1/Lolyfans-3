import { NextRequest, NextResponse } from "next/server";
import { guestOwnsChat } from "@/lib/guestAuth";
import { saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";

/**
 * Called after the embedded wizard confirms a verification SetupIntent:
 * stores the verified card on the chat (no charge was made), which also
 * enables one-tap purchases from now on.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { chatId, setupIntentId } = await req.json();
  if (!chatId || !setupIntentId || typeof setupIntentId !== "string") {
    return NextResponse.json(
      { error: "chatId and setupIntentId required" },
      { status: 400 }
    );
  }
  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const si = await stripe().setupIntents.retrieve(setupIntentId);
  if (
    si.metadata?.chatId !== chatId ||
    si.metadata?.kind !== "verify" ||
    si.status !== "succeeded"
  ) {
    return NextResponse.json({ error: "Verification not completed" }, { status: 402 });
  }

  const paymentMethodId =
    typeof si.payment_method === "string"
      ? si.payment_method
      : si.payment_method?.id ?? null;
  const customerId = typeof si.customer === "string" ? si.customer : null;
  await saveStripePaymentMethod(chatId, customerId, paymentMethodId);

  return NextResponse.json({ ok: true });
}
