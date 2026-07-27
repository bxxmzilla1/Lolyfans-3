import { NextRequest, NextResponse } from "next/server";
import { guestOwnsChat } from "@/lib/guestAuth";
import { ensureStripeCustomer } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { visitorCountryCode } from "@/lib/geo";

/**
 * Card verification: a SetupIntent for the embedded 3-step card wizard.
 * Saves the fan's card WITHOUT charging anything — used by the "Verify"
 * popup to confirm the fan is a real adult cardholder.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { chatId } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customerId = await ensureStripeCustomer(chatId);
  const si = await stripe().setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: { chatId, kind: "verify" },
  });

  return NextResponse.json({
    clientSecret: si.client_secret,
    country: await visitorCountryCode(req.headers),
  });
}
