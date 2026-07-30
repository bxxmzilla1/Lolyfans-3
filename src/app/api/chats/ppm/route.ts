import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { settlePpmBalance } from "@/lib/payments";

/**
 * Pay per Message fan actions:
 *   accept — the fan accepted the terms popup (unblocks chatting; the
 *            creator sees a checkmark next to their name)
 *   retry  — re-attempt the balance charge right away (after the fan added
 *            a new card following a decline)
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
      .select("ppm_accepted_at")
      .eq("id", chatId)
      .maybeSingle();
    if (!chat?.ppm_accepted_at) {
      await db
        .from("chats")
        .update({ ppm_accepted_at: new Date().toISOString() })
        .eq("id", chatId);
    }
    return NextResponse.json({ ok: true, accepted: true });
  }

  if (action === "retry") {
    await settlePpmBalance(chatId, true);
    const { data: chat } = await db
      .from("chats")
      .select("ppm_balance_cents, ppm_card_declined")
      .eq("id", chatId)
      .maybeSingle();
    return NextResponse.json({
      ok: true,
      balanceCents: chat?.ppm_balance_cents ?? 0,
      declined: !!chat?.ppm_card_declined,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
