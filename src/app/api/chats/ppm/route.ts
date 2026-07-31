import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { settlePpmBalance } from "@/lib/payments";
import { broadcast } from "@/lib/realtime";
import { payPerMessageFromMetadata } from "@/lib/payPerMessage";

/**
 * Pay per Message fan actions:
 *   accept — the fan accepted the terms popup; grants free credit to their
 *            balance and unblocks chatting (creator sees a purple shield)
 *   retry  — re-attempt the owed-balance charge (after a declined card)
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
      .select("ppm_accepted_at, owner_id, ppm_credit_granted")
      .eq("id", chatId)
      .maybeSingle();
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    const { data: ownerUser } = await db.auth.admin.getUserById(chat.owner_id);
    const ppm = payPerMessageFromMetadata(ownerUser?.user?.user_metadata ?? {});

    if (!chat.ppm_accepted_at) {
      await db
        .from("chats")
        .update({
          ppm_accepted_at: new Date().toISOString(),
          ppm_credit_cents: ppm.freeCreditCents,
          ppm_credit_granted: true,
        })
        .eq("id", chatId);
      await Promise.all([
        broadcast(`chat:${chatId}`, "ppm-accepted", { chatId }),
        broadcast(`inbox:${chat.owner_id}`, "ppm-accepted", { chatId }),
        broadcast(`chat:${chatId}`, "ppm-balance", {
          creditCents: ppm.freeCreditCents,
          balanceCents: 0,
          declined: false,
        }),
      ]);
    } else if (!chat.ppm_credit_granted) {
      // Already accepted under the old free-messages model — grant remaining
      // credit once so they aren't stranded at $0.
      const { data: row } = await db
        .from("chats")
        .select("ppm_messages_used")
        .eq("id", chatId)
        .maybeSingle();
      const usedCost = (row?.ppm_messages_used ?? 0) * ppm.priceCents;
      const credit = Math.max(0, ppm.freeCreditCents - usedCost);
      await db
        .from("chats")
        .update({ ppm_credit_cents: credit, ppm_credit_granted: true })
        .eq("id", chatId);
      await broadcast(`chat:${chatId}`, "ppm-balance", {
        creditCents: credit,
        declined: false,
      });
    }
    return NextResponse.json({
      ok: true,
      accepted: true,
      creditCents: ppm.freeCreditCents,
    });
  }

  if (action === "retry") {
    await settlePpmBalance(chatId, true);
    const { data: chat } = await db
      .from("chats")
      .select("ppm_balance_cents, ppm_credit_cents, ppm_card_declined")
      .eq("id", chatId)
      .maybeSingle();
    return NextResponse.json({
      ok: true,
      balanceCents: chat?.ppm_balance_cents ?? 0,
      creditCents: chat?.ppm_credit_cents ?? 0,
      declined: !!chat?.ppm_card_declined,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
