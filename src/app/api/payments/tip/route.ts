import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import {
  postTipMessage,
  spendTokens,
  tokenBalance,
  tokenTipMessageContent,
} from "@/lib/payments";
import { MIN_TIP_TOKENS, MAX_TIP_TOKENS } from "@/lib/tokens";

/**
 * Fan tip, paid in wallet Tokens. Instant spend — the wallet is topped up
 * separately via Stripe (/api/payments/topup).
 */
export async function POST(req: NextRequest) {
  const { chatId, tokens: tokensRaw, caption } = await req.json();
  if (!chatId || !Number.isFinite(tokensRaw)) {
    return NextResponse.json({ error: "chatId and tokens required" }, { status: 400 });
  }
  const tokens = Math.round(Number(tokensRaw));
  if (tokens < MIN_TIP_TOKENS || tokens > MAX_TIP_TOKENS) {
    return NextResponse.json(
      { error: `Tip must be between ${MIN_TIP_TOKENS} and ${MAX_TIP_TOKENS} Tokens` },
      { status: 400 }
    );
  }
  const note = String(caption || "").trim().slice(0, 1000);

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

  const balance = await spendTokens({ chatId, tokens, kind: "tip" });
  if (balance === null) {
    return NextResponse.json(
      {
        error: "Not enough Tokens",
        needTokens: tokens,
        balance: await tokenBalance(chatId),
      },
      { status: 402 }
    );
  }

  const message = await postTipMessage({
    chatId,
    content: tokenTipMessageContent(tokens, note),
    ownerId: chat.owner_id,
  });
  return NextResponse.json({ ok: true, tipped: true, message, balance });
}
