import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/wallet";

/**
 * One-click unlock: reveal a locked, priced media message for this fan by
 * debiting their wallet. Idempotent — re-unlocking an already unlocked message
 * costs nothing. Returns the new balance and (on success) the media so the
 * bubble can reveal instantly.
 */
export async function POST(req: NextRequest) {
  const { messageId } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, media_path, media_type, price_cents, locked")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Already unlocked? Return the media without charging again.
  const { data: existing } = await db
    .from("message_unlocks")
    .select("message_id")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();
  const { data: chat } = await db
    .from("chats")
    .select("wallet_balance_cents")
    .eq("id", message.chat_id)
    .maybeSingle();
  const balance = chat?.wallet_balance_cents ?? 0;

  if (existing) {
    return NextResponse.json({
      ok: true,
      balanceCents: balance,
      media: { media_path: message.media_path, media_type: message.media_type },
    });
  }

  const price = message.price_cents ?? 0;
  if (!message.locked || price <= 0) {
    return NextResponse.json({ error: "This message is not for sale" }, { status: 400 });
  }
  if (balance < price) {
    return NextResponse.json(
      { error: "Insufficient balance", balanceCents: balance, priceCents: price },
      { status: 402 }
    );
  }

  // Debit then record the unlock. Guard the debit on the balance we read so two
  // simultaneous taps can't spend the same funds twice.
  const next = balance - price;
  const { data: debited } = await db
    .from("chats")
    .update({ wallet_balance_cents: next })
    .eq("id", message.chat_id)
    .eq("wallet_balance_cents", balance)
    .select("id")
    .maybeSingle();
  if (!debited) {
    return NextResponse.json({ error: "Please try again" }, { status: 409 });
  }

  await db
    .from("message_unlocks")
    .insert({ message_id: messageId, chat_id: message.chat_id, price_cents: price });

  return NextResponse.json({
    ok: true,
    balanceCents: next,
    media: { media_path: message.media_path, media_type: message.media_type },
  });
}
