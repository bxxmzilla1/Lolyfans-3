import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

/**
 * Live fan wallet state for the creator's chat header: current token balance
 * and whether the fan has a card on file. Polled every second while the
 * creator has the chat open, so top-ups and card registrations show
 * immediately.
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  const { data: chat } = await supabaseAdmin()
    .from("chats")
    .select("token_balance, stripe_payment_method_id")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  return NextResponse.json({
    balance: (chat.token_balance as number | null) ?? 0,
    hasCard: !!chat.stripe_payment_method_id,
  });
}
