import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { grantPpmTokens, tokenBalance } from "@/lib/payments";
import { broadcast } from "@/lib/realtime";
import { payPerMessageFromMetadata } from "@/lib/payPerMessage";
import { tokensForCents } from "@/lib/tokens";

/**
 * Pay per Message fan actions (token economy):
 *   accept — fan accepted the terms popup; free credit is granted as Tokens
 *            into their wallet
 */
export async function POST(req: NextRequest) {
  const { chatId, action } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  if (action === "accept") {
    const { data: chat } = await db
      .from("chats")
      .select(
        "ppm_accepted_at, owner_id, ppm_credit_granted, ppm_credit_cents"
      )
      .eq("id", chatId)
      .maybeSingle();
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    const { data: ownerUser } = await db.auth.admin.getUserById(chat.owner_id);
    const ppm = payPerMessageFromMetadata(ownerUser?.user?.user_metadata ?? {});

    const granted = await grantPpmTokens({
      chatId,
      freeCreditCents: ppm.freeCreditCents,
      chat,
      silentAccept: true,
    });

    const balance = granted.balance ?? (await tokenBalance(chatId));
    const freeTokens =
      ppm.freeCreditCents > 0 ? tokensForCents(ppm.freeCreditCents) : 0;

    await Promise.all([
      broadcast(`chat:${chatId}`, "ppm-accepted", { chatId }),
      broadcast(`inbox:${chat.owner_id}`, "ppm-accepted", { chatId }),
      broadcast(`chat:${chatId}`, "ppm-balance", {
        balance,
        freeTokens,
        declined: false,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      accepted: true,
      balance,
      freeTokens,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
