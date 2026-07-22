import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { recordUnlock, spendTokens, tokenBalance } from "@/lib/payments";
import { tokensForCents } from "@/lib/tokens";

/**
 * Unlock locked media with wallet Tokens. The fan tops up their wallet via
 * Stripe (see /api/payments/topup); unlocking itself is an instant token
 * spend — no card round-trip, no payment sheet.
 */
export async function POST(req: NextRequest) {
  const { messageId } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, media_path, media_type, media_items, price_cents, locked")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasMedia =
    !!message.media_path ||
    (Array.isArray(message.media_items) && message.media_items.length > 0);
  const price = message.price_cents ?? 0;
  if (!message.locked || price <= 0 || !hasMedia) {
    return NextResponse.json({ error: "This message is not for sale" }, { status: 400 });
  }

  // Already unlocked?
  const { data: existing } = await db
    .from("message_unlocks")
    .select("message_id")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      ok: true,
      unlocked: true,
      balance: await tokenBalance(message.chat_id),
    });
  }

  const tokens = tokensForCents(price);
  const balance = await spendTokens({
    chatId: message.chat_id,
    tokens,
    kind: "unlock",
    messageId: message.id,
  });

  if (balance === null) {
    // Not enough tokens — the client opens the top-up sheet.
    return NextResponse.json(
      {
        error: "Not enough Tokens",
        needTokens: tokens,
        balance: await tokenBalance(message.chat_id),
      },
      { status: 402 }
    );
  }

  await recordUnlock({
    messageId: message.id,
    chatId: message.chat_id,
    priceCents: price,
  });

  return NextResponse.json({ ok: true, unlocked: true, tokens, balance });
}
