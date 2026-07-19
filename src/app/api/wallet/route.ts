import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/wallet";
import { nowpaymentsConfigured } from "@/lib/nowpayments";

/** Current wallet balance for a fan's chat. */
export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });
  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: chat } = await supabaseAdmin()
    .from("chats")
    .select("wallet_balance_cents")
    .eq("id", chatId)
    .maybeSingle();
  return NextResponse.json({
    balanceCents: chat?.wallet_balance_cents ?? 0,
    topupEnabled: nowpaymentsConfigured(),
  });
}
