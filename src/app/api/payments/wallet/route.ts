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

  const db = supabaseAdmin();
  const [balance, { data: chat }] = await Promise.all([
    tokenBalance(chatId),
    db
      .from("chats")
      .select("stripe_payment_method_id")
      .eq("id", chatId)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    balance,
    packs: TOKEN_PACKS,
    hasCard: !!chat?.stripe_payment_method_id,
  });
}
