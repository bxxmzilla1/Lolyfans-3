import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { packById, packTotalTokens } from "@/lib/tokens";
import {
  USDC_MINT,
  centsToMicroUsdc,
  cryptoConfigured,
  cryptoReceiver,
  newReference,
} from "@/lib/solana";

/**
 * Start a USDC top-up: records the attempt and hands the browser everything
 * it needs to build the Phantom transaction (receiver, amount, reference).
 */
export async function POST(req: NextRequest) {
  if (!cryptoConfigured()) {
    return NextResponse.json({ error: "Crypto payments are not available" }, { status: 503 });
  }
  const { chatId, packId } = await req.json().catch(() => ({}));
  const pack = packById(String(packId || ""));
  if (!chatId || !pack) {
    return NextResponse.json({ error: "chatId and packId required" }, { status: 400 });
  }
  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = packTotalTokens(pack);
  const amountMicro = centsToMicroUsdc(pack.priceCents);
  const reference = newReference();
  const { error } = await supabaseAdmin().from("crypto_topups").insert({
    chat_id: chatId,
    pack_id: pack.id,
    tokens,
    amount_micro: amountMicro,
    reference,
  });
  if (error) {
    const msg = /crypto_topups/i.test(error.message)
      ? "Run supabase/migration-crypto-topups.sql to enable crypto payments"
      : error.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({
    reference,
    receiver: cryptoReceiver(),
    mint: USDC_MINT,
    amountMicro,
    amountCents: pack.priceCents,
    tokens,
    packId: pack.id,
  });
}
