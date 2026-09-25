import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { creditTokens, tokenBalance } from "@/lib/payments";
import { verifyUsdcPayment } from "@/lib/solana";
import { ownerSubPlan, recordSubscriptionPayment } from "@/lib/subscriptionAccess";
import { notifyCryptoPayment } from "@/lib/adminTelegram";

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,120}$/;

/**
 * The browser sends the transaction signature Phantom returned. We check the
 * payment on chain and fulfil it exactly once: tokens for packs/coupons, one
 * more period (or lifetime) for subscriptions. Returns 202 while the
 * transaction hasn't been indexed yet — the client polls.
 */
export async function POST(req: NextRequest) {
  const { reference, signature } = await req.json().catch(() => ({}));
  if (typeof reference !== "string" || !SIG_RE.test(String(signature || ""))) {
    return NextResponse.json({ error: "reference and signature required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: payment } = await db
    .from("crypto_topups")
    .select("id, chat_id, kind, owner_id, message_id, tokens, amount_micro, status, pack_id")
    .eq("reference", reference)
    .maybeSingle();
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (!(await guestOwnsChat(req.headers, payment.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chatId = payment.chat_id as string;
  const kind = (payment.kind as string) || "topup";
  const amountCents = Number(payment.amount_micro) / 10_000;
  const base = {
    ok: true,
    kind,
    tokens: payment.tokens as number,
    amountCents,
    packId: payment.pack_id as string,
  };

  if (payment.status === "paid") {
    return NextResponse.json({
      ...base,
      balance: await tokenBalance(chatId),
      alreadyCredited: true,
    });
  }

  const verified = await verifyUsdcPayment({
    signature,
    reference,
    amountMicro: Number(payment.amount_micro),
  });
  if (verified.status === "pending") {
    return NextResponse.json({ pending: true }, { status: 202 });
  }
  if (verified.status === "failed") {
    return NextResponse.json({ error: verified.reason }, { status: 402 });
  }

  // Claim the signature first: the unique column makes sure two confirms
  // for the same transaction can't both fulfil.
  const { data: claimed, error: claimError } = await db
    .from("crypto_topups")
    .update({
      status: "paid",
      signature,
      payer: verified.payer,
      paid_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .eq("status", "pending")
    .select("id");
  if (claimError) {
    return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
  }
  if (!claimed?.length) {
    return NextResponse.json({ ...base, balance: await tokenBalance(chatId), alreadyCredited: true });
  }

  let accessUntil: string | null = null;
  if (kind === "subscription" && payment.owner_id) {
    const ownerId = payment.owner_id as string;
    accessUntil = await recordSubscriptionPayment({
      chatId,
      ownerId,
      plan: await ownerSubPlan(ownerId),
      amountCents,
    });
  } else {
    await creditTokens({
      chatId,
      tokens: payment.tokens as number,
      paymentIntentId: `sol:${signature}`,
      messageId: (payment.message_id as string | null) ?? null,
    });
  }

  after(() => notifyCryptoPayment(chatId, amountCents, kind, payment.tokens as number));

  return NextResponse.json({
    ...base,
    accessUntil,
    balance: await tokenBalance(chatId),
  });
}
