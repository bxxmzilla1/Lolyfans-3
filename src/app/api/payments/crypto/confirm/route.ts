import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { creditTokens, tokenBalance } from "@/lib/payments";
import { verifyUsdcPayment } from "@/lib/solana";

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,120}$/;

/**
 * The browser sends the transaction signature Phantom returned. We check the
 * payment on chain and credit the tokens exactly once. Returns 202 while the
 * transaction hasn't been indexed yet — the client polls.
 */
export async function POST(req: NextRequest) {
  const { chatId, reference, signature } = await req.json().catch(() => ({}));
  if (!chatId || typeof reference !== "string" || !SIG_RE.test(String(signature || ""))) {
    return NextResponse.json({ error: "chatId, reference and signature required" }, { status: 400 });
  }
  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: topup } = await db
    .from("crypto_topups")
    .select("id, chat_id, tokens, amount_micro, status, signature, pack_id")
    .eq("reference", reference)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!topup) return NextResponse.json({ error: "Top-up not found" }, { status: 404 });

  if (topup.status === "paid") {
    return NextResponse.json({
      ok: true,
      tokens: topup.tokens,
      packId: topup.pack_id,
      balance: await tokenBalance(chatId),
      alreadyCredited: true,
    });
  }

  const verified = await verifyUsdcPayment({
    signature,
    reference,
    amountMicro: Number(topup.amount_micro),
  });
  if (verified.status === "pending") {
    return NextResponse.json({ pending: true }, { status: 202 });
  }
  if (verified.status === "failed") {
    return NextResponse.json({ error: verified.reason }, { status: 402 });
  }

  // Claim the signature first: the unique column makes sure two confirms
  // for the same transaction can't both credit.
  const { error: claimError } = await db
    .from("crypto_topups")
    .update({
      status: "paid",
      signature,
      payer: verified.payer,
      paid_at: new Date().toISOString(),
    })
    .eq("id", topup.id)
    .eq("status", "pending");
  if (claimError) {
    return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
  }

  const balance = await creditTokens({
    chatId,
    tokens: topup.tokens,
    paymentIntentId: `sol:${signature}`,
  });

  return NextResponse.json({
    ok: true,
    tokens: topup.tokens,
    amountCents: Number(topup.amount_micro) / 10_000,
    packId: topup.pack_id,
    balance: balance ?? (await tokenBalance(chatId)),
  });
}
