import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";

/**
 * Creator gifts free tokens straight into a fan's wallet — no charge, no
 * Stripe. Credited atomically and broadcast so the fan's balance (and a
 * little "gift" banner) updates live in their open chat.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId, tokens } = await req.json();
  const amount = Math.round(Number(tokens));
  if (!chatId || !(amount > 0) || amount > 1_000_000) {
    return NextResponse.json(
      { error: "chatId and a token amount (1+) required" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const { error: ledgerError } = await db.from("token_transactions").insert({
    chat_id: chatId,
    amount,
    kind: "gift",
  });
  if (ledgerError) {
    return NextResponse.json({ error: ledgerError.message }, { status: 500 });
  }

  const { data: balance, error } = await db.rpc("credit_tokens", {
    p_chat_id: chatId,
    p_amount: amount,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcast(`chat:${chatId}`, "tokens-gifted", { tokens: amount, balance });

  return NextResponse.json({ ok: true, tokens: amount, balance });
}
