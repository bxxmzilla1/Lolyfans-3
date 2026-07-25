import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { guestChats } from "@/lib/guest";
import { TOKEN_PACKS, packTotalTokens } from "@/lib/tokens";

export type WalletHistoryEntry = {
  id: string;
  /** Positive = tokens credited (top-up), negative = tokens spent. */
  amount: number;
  kind: "topup" | "unlock" | "tip";
  createdAt: string;
  /** Real money paid, only on top-ups (matched back to the pack). */
  priceCents: number | null;
};

/**
 * Fan Wallet tab: token balance plus the full purchase/spend history for the
 * guest's primary chat — the same chat the fan shell profile resolves to.
 */
export async function GET(req: NextRequest) {
  const chats = await guestChats(req.headers);
  if (!chats.length) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieChatId = await getGuestChatId();
  const chat = chats.find((c) => c.id === cookieChatId) ?? chats[0];

  const db = supabaseAdmin();
  const [{ data: row }, { data: txs }] = await Promise.all([
    db.from("chats").select("token_balance").eq("id", chat.id).maybeSingle(),
    db
      .from("token_transactions")
      .select("id, amount, kind, created_at")
      .eq("chat_id", chat.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  // Top-up rows carry the dollar price of the matching pack, so a fan can
  // self-serve "what was that $24.99 charge?" instead of calling their bank.
  const history: WalletHistoryEntry[] = (txs ?? []).map((t) => {
    const pack =
      t.kind === "topup"
        ? TOKEN_PACKS.find((p) => packTotalTokens(p) === t.amount) ?? null
        : null;
    return {
      id: t.id,
      amount: t.amount,
      kind: t.kind as WalletHistoryEntry["kind"],
      createdAt: t.created_at,
      priceCents: pack?.priceCents ?? null,
    };
  });

  return NextResponse.json({
    chatId: chat.id,
    balance: row?.token_balance ?? 0,
    history,
  });
}
