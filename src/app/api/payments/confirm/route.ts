import { NextRequest, NextResponse } from "next/server";
import { guestOwnsChat } from "@/lib/guestAuth";
import { fulfillCheckout } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";

/**
 * Called when the fan returns from Stripe Checkout. Verifies the session was
 * paid and fulfills unlock/tip even if the webhook failed (e.g. host 308).
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { sessionId } = await req.json();
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const session = await stripe().checkout.sessions.retrieve(sessionId);
  const chatId = session.metadata?.chatId;
  if (!chatId || !(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await fulfillCheckout(session);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Payment not completed", status: session.payment_status },
      { status: 402 }
    );
  }

  return NextResponse.json({
    ok: true,
    kind: result.kind,
    messageId: result.messageId ?? null,
  });
}
