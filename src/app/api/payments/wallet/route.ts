import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { tokenBalance } from "@/lib/payments";
import { TOKEN_PACKS } from "@/lib/tokens";

/** Fan wallet: current token balance + the top-up packs on offer. */
export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Never topped up → the one-time first-purchase offer is still available.
  const [balance, { count: topupCount }] = await Promise.all([
    tokenBalance(chatId),
    supabaseAdmin()
      .from("token_transactions")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chatId)
      .eq("kind", "topup"),
  ]);
  return NextResponse.json({
    balance,
    packs: TOKEN_PACKS,
    firstTopupOffer: (topupCount ?? 0) === 0,
  });
}
