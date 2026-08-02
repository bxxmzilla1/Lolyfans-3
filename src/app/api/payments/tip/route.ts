import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import {
  chargeChatDollars,
  postTipMessage,
  saveStripePaymentMethod,
  tipMessageContent,
} from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { visitorCountryCode } from "@/lib/geo";

const MIN_TIP_CENTS = 100; // $1
const MAX_TIP_CENTS = 500_000; // $5,000

/**
 * Fan tip in dollars via Stripe. One-tap with a saved card, or return a
 * client secret for the embedded card wizard. No token wallet.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const chatId = body.chatId as string | undefined;
  const paymentIntentId = body.paymentIntentId as string | undefined;
  // Accept cents directly, or legacy `tokens` (1 token = 10¢) for old clients.
  let amountCents = Math.round(Number(body.amountCents ?? body.cents ?? 0));
  if (!amountCents && Number.isFinite(body.tokens)) {
    amountCents = Math.round(Number(body.tokens) * 10);
  }
  const note = String(body.caption || "").trim().slice(0, 1000);

  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }
  if (amountCents < MIN_TIP_CENTS || amountCents > MAX_TIP_CENTS) {
    return NextResponse.json(
      { error: `Tip must be between $${(MIN_TIP_CENTS / 100).toFixed(0)} and $${(MAX_TIP_CENTS / 100).toFixed(0)}` },
      { status: 400 }
    );
  }

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  async function finish(piId: string) {
    const message = await postTipMessage({
      chatId: chat!.id,
      content: tipMessageContent(amountCents, note),
      ownerId: chat!.owner_id,
    });
    return NextResponse.json({
      ok: true,
      tipped: true,
      message,
      paymentIntentId: piId,
    });
  }

  if (paymentIntentId) {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
    if (
      pi.status !== "succeeded" ||
      pi.metadata?.kind !== "tip" ||
      pi.metadata?.chatId !== chatId
    ) {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }
    const pmId =
      typeof pi.payment_method === "string"
        ? pi.payment_method
        : pi.payment_method?.id ?? null;
    const custId = typeof pi.customer === "string" ? pi.customer : null;
    await saveStripePaymentMethod(chatId, custId, pmId);
    return finish(pi.id);
  }

  const result = await chargeChatDollars({
    chatId,
    amountCents,
    kind: "tip",
    description: "Tip",
  });

  if ("paid" in result && result.paid) {
    return finish(result.paymentIntentId);
  }

  if (!("clientSecret" in result)) {
    return NextResponse.json({ error: "Could not start payment" }, { status: 500 });
  }

  return NextResponse.json({
    clientSecret: result.clientSecret,
    amountCents,
    country: await visitorCountryCode(req.headers),
  });
}
